//! Unix-domain control socket that CLIs (and their hooks) use to push state
//! updates into the engine.
//!
//! Each spawned PTY gets `AGTOWER_SOCKET_PATH` pointing at this socket and
//! `AGTOWER_SESSION_ID` identifying the session. Our `agtower-hook` helper
//! script (bundled under `resources/bin/`) writes newline-delimited JSON to
//! the socket:
//!
//! ```json
//! {"action":"set-status","sessionId":"<uuid>","status":"running|idle|needsAttention|closed"}
//! {"action":"notify","sessionId":"<uuid>","title":"...","body":"..."}
//! ```
//!
//! The listener decodes each line and mutates `engine.sessions`. The existing
//! `session:updated` event pipeline carries the change to the frontend, so
//! sidebar state flips in the same tick as the hook fires — no byte-sniffing,
//! no polling, no silence heuristics.
//!
//! The socket path is `<app_data_dir>/control.sock`. On startup we delete any
//! stale socket from a previous run before binding. The listener lives for the
//! lifetime of the app; individual connections are handled on short-lived
//! threads and close after each command (fire-and-forget from the hook's
//! perspective).

use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::engine::session_store::{SessionStatus, SessionUpdate};

const SOCKET_FILENAME: &str = "control.sock";

/// Hook invocations are fire-and-forget single-line writes. Any client that
/// takes longer than this is either stuck or misbehaving; we drop the
/// connection so it can't tie up a worker thread.
const CLIENT_READ_TIMEOUT: Duration = Duration::from_secs(2);

/// Cap the per-line size we'll accept. Well-formed set-status / notify lines
/// are <200 bytes; anything bigger is either a bug or an attacker.
const MAX_LINE_BYTES: u64 = 16 * 1024;

/// Cap on concurrently-handled control connections. The hook protocol is
/// fire-and-forget single-line writes, so a small pool is plenty; this bounds
/// thread spawn from a runaway/buggy local hook that opens connections faster
/// than they drain.
const MAX_INFLIGHT_CLIENTS: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum ControlCommand {
    #[serde(rename = "set-status", rename_all = "camelCase")]
    SetStatus { session_id: String, status: String },
    /// Codex pushes a notify on every turn-complete event. Any extra payload
    /// fields (title, body, …) are silently dropped — serde's default
    /// behaviour is permissive, so future hook payloads don't get rejected.
    #[serde(rename = "notify", rename_all = "camelCase")]
    Notify { session_id: String },
}

fn control_socket_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join(SOCKET_FILENAME))
}

/// Spin up the control socket listener on a dedicated thread. Returns the
/// socket path so it can be exported to spawned PTYs via `AGTOWER_SOCKET_PATH`.
pub(crate) fn start(app_handle: AppHandle) -> Result<PathBuf, String> {
    let socket_path = control_socket_path(&app_handle)?;

    // Stale socket from a previous run will refuse to bind; unlink first.
    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path)
        .map_err(|e| format!("bind control socket at {}: {e}", socket_path.display()))?;
    // Best-effort: restrict to owner. Ignore failure on exotic filesystems.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&socket_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&socket_path, perms);
        }
    }

    let accept_app = app_handle.clone();
    std::thread::Builder::new()
        .name("agtower-control-accept".into())
        .spawn(move || accept_loop(listener, accept_app))
        .map_err(|e| format!("spawn control-accept thread: {e}"))?;

    Ok(socket_path)
}

fn accept_loop(listener: UnixListener, app_handle: AppHandle) {
    let inflight = Arc::new(AtomicUsize::new(0));
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                if inflight.load(Ordering::Acquire) >= MAX_INFLIGHT_CLIENTS {
                    // Backpressure: drop this connection rather than spawn an
                    // unbounded thread. The hook retries on its next event.
                    eprintln!(
                        "[control-socket] dropping connection: {MAX_INFLIGHT_CLIENTS} already in flight"
                    );
                    drop(stream);
                    continue;
                }
                inflight.fetch_add(1, Ordering::AcqRel);
                let app = app_handle.clone();
                let inflight_for_client = Arc::clone(&inflight);
                let spawned = std::thread::Builder::new()
                    .name("agtower-control-client".into())
                    .spawn(move || {
                        handle_client(stream, app);
                        inflight_for_client.fetch_sub(1, Ordering::AcqRel);
                    });
                if spawned.is_err() {
                    inflight.fetch_sub(1, Ordering::AcqRel);
                    eprintln!("[control-socket] failed to spawn client thread");
                }
            }
            Err(error) => {
                eprintln!("[control-socket] accept failed: {error}");
            }
        }
    }
}

fn handle_client(stream: UnixStream, app_handle: AppHandle) {
    let _ = stream.set_read_timeout(Some(CLIENT_READ_TIMEOUT));
    let peer = stream
        .try_clone()
        .ok()
        .and_then(|s| s.peer_addr().ok())
        .and_then(|addr| addr.as_pathname().map(|p| p.to_path_buf()));

    // One command per connection. Hooks are fire-and-forget — if an agent
    // has more state to push, it dials a fresh socket. Closing after the
    // first line prevents a stuck client from holding a worker thread
    // indefinitely even if the read timeout above somehow doesn't trip.
    //
    // The `.take(MAX_LINE_BYTES)` cap guards against a client that never
    // sends a newline; `read_to_string` bounds I/O to a fixed buffer size.
    use std::io::Read;
    let mut bounded = stream.take(MAX_LINE_BYTES);
    let mut raw = String::new();
    match bounded.read_to_string(&mut raw) {
        Ok(_) => {
            // Only honour the first line — extra lines (if any) are ignored.
            let first = raw.lines().next().unwrap_or("").trim();
            if !first.is_empty() {
                if let Err(error) = process_line(first, &app_handle) {
                    eprintln!(
                        "[control-socket] line rejected ({} chars, peer={:?}): {error}",
                        first.len(),
                        peer
                    );
                }
            }
        }
        Err(error) => {
            eprintln!("[control-socket] read failed (peer={peer:?}): {error}");
        }
    }
}

fn process_line(line: &str, app_handle: &AppHandle) -> Result<(), String> {
    let command: ControlCommand =
        serde_json::from_str(line).map_err(|e| format!("invalid JSON: {e}"))?;
    match command {
        ControlCommand::SetStatus { session_id, status } => {
            let parsed =
                parse_status(&status).ok_or_else(|| format!("unknown status value: {status:?}"))?;
            apply_status(app_handle, &session_id, parsed)
        }
        ControlCommand::Notify { session_id } => {
            apply_status(app_handle, &session_id, SessionStatus::NeedsAttention)
        }
    }
}

fn parse_status(raw: &str) -> Option<SessionStatus> {
    match raw.to_ascii_lowercase().as_str() {
        "running" => Some(SessionStatus::Running),
        "idle" => Some(SessionStatus::Idle),
        "needsattention" | "needs_attention" | "needs-attention" | "attention" => {
            Some(SessionStatus::NeedsAttention)
        }
        "closed" | "done" | "complete" => Some(SessionStatus::Closed),
        _ => None,
    }
}

fn apply_status(
    app_handle: &AppHandle,
    session_id: &str,
    status: SessionStatus,
) -> Result<(), String> {
    let engine = app_handle
        .try_state::<Arc<crate::engine::Engine>>()
        .ok_or_else(|| "engine not ready".to_string())?;
    let session = engine
        .sessions
        .get(session_id)
        .ok_or_else(|| format!("unknown session {session_id}"))?;
    let Some(next) = next_status_update(session.status, &session.provider, status) else {
        return Ok(());
    };
    if next == session.status {
        // Idempotent (e.g. a repeated Closed) — nothing to persist.
        return Ok(());
    }

    let mut update = SessionUpdate {
        status: Some(next),
        ..Default::default()
    };
    if matches!(next, SessionStatus::Closed) {
        update.ended_at = Some(Some(crate::engine::epoch_ms()));
    }

    engine
        .sessions
        .update(session_id, update)
        .map_err(|e| format!("update {session_id}: {e}"))
}

/// Pure transition decision for an incoming hook status. Returns the status to
/// apply, or None to ignore the push. These guards prevent a late-firing
/// Stop/Notify hook from resurrecting a finished session:
/// - Only claude-code / codex sessions are affected.
/// - Archived is strictly terminal — never flipped, not even to Closed.
/// - A Closed session only accepts Closed again; never running/idle/attention.
fn next_status_update(
    current: SessionStatus,
    provider: &str,
    incoming: SessionStatus,
) -> Option<SessionStatus> {
    if !matches!(provider, "claude-code" | "codex") {
        return None;
    }
    if current == SessionStatus::Archived {
        return None;
    }
    if current == SessionStatus::Closed && !matches!(incoming, SessionStatus::Closed) {
        return None;
    }
    Some(incoming)
}

/// Invoked during app shutdown to clean up the socket file.
pub(crate) fn cleanup(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_canonical_names() {
        assert_eq!(parse_status("running"), Some(SessionStatus::Running));
        assert_eq!(parse_status("idle"), Some(SessionStatus::Idle));
        assert_eq!(
            parse_status("needsAttention"),
            Some(SessionStatus::NeedsAttention)
        );
        assert_eq!(parse_status("closed"), Some(SessionStatus::Closed));
    }

    #[test]
    fn parse_status_aliases() {
        assert_eq!(
            parse_status("needs-attention"),
            Some(SessionStatus::NeedsAttention)
        );
        assert_eq!(
            parse_status("needs_attention"),
            Some(SessionStatus::NeedsAttention)
        );
        assert_eq!(
            parse_status("attention"),
            Some(SessionStatus::NeedsAttention)
        );
        assert_eq!(parse_status("done"), Some(SessionStatus::Closed));
        assert_eq!(parse_status("complete"), Some(SessionStatus::Closed));
    }

    #[test]
    fn parse_status_is_case_insensitive() {
        assert_eq!(parse_status("RUNNING"), Some(SessionStatus::Running));
        assert_eq!(
            parse_status("NeedsAttention"),
            Some(SessionStatus::NeedsAttention)
        );
    }

    #[test]
    fn parse_status_rejects_unknown() {
        assert_eq!(parse_status(""), None);
        assert_eq!(parse_status("archived"), None);
        assert_eq!(parse_status("garbage"), None);
    }

    #[test]
    fn set_status_deserializes_camel_case_field_names() {
        // Agent hooks write `sessionId` (camelCase). This test guards against
        // accidentally reintroducing the bug where serde's `rename_all` on the
        // enum failed to cascade into struct variants.
        let raw = r#"{"action":"set-status","sessionId":"abc","status":"running"}"#;
        let cmd: ControlCommand = serde_json::from_str(raw).unwrap();
        match cmd {
            ControlCommand::SetStatus { session_id, status } => {
                assert_eq!(session_id, "abc");
                assert_eq!(status, "running");
            }
            other => panic!("expected SetStatus, got {other:?}"),
        }
    }

    #[test]
    fn notify_parses_with_extra_fields() {
        // The hook may add fields in the future; serde should ignore unknown
        // keys silently rather than reject the line.
        let raw = r#"{"action":"notify","sessionId":"s1","title":"x","body":"y"}"#;
        let cmd: ControlCommand = serde_json::from_str(raw).unwrap();
        match cmd {
            ControlCommand::Notify { session_id } => {
                assert_eq!(session_id, "s1");
            }
            other => panic!("expected Notify, got {other:?}"),
        }
    }

    #[test]
    fn unknown_action_tag_rejected() {
        let raw = r#"{"action":"do-nothing","sessionId":"s1"}"#;
        let result: Result<ControlCommand, _> = serde_json::from_str(raw);
        assert!(result.is_err());
    }

    #[test]
    fn next_status_archived_is_terminal() {
        for incoming in [
            SessionStatus::Running,
            SessionStatus::Idle,
            SessionStatus::NeedsAttention,
            SessionStatus::Closed,
        ] {
            assert_eq!(
                next_status_update(SessionStatus::Archived, "codex", incoming),
                None,
                "archived must never be flipped out, not even to closed"
            );
        }
    }

    #[test]
    fn next_status_closed_only_accepts_closed() {
        assert_eq!(
            next_status_update(SessionStatus::Closed, "claude-code", SessionStatus::Closed),
            Some(SessionStatus::Closed),
            "idempotent closed is allowed"
        );
        for incoming in [
            SessionStatus::Running,
            SessionStatus::Idle,
            SessionStatus::NeedsAttention,
        ] {
            assert_eq!(
                next_status_update(SessionStatus::Closed, "claude-code", incoming),
                None,
                "a closed session must not be resurrected by a late hook"
            );
        }
    }

    #[test]
    fn next_status_ignores_unsupported_providers() {
        assert_eq!(
            next_status_update(SessionStatus::Running, "gemini", SessionStatus::Idle),
            None
        );
        assert_eq!(
            next_status_update(SessionStatus::Running, "", SessionStatus::Closed),
            None
        );
    }

    #[test]
    fn next_status_allows_normal_transitions_for_supported_providers() {
        assert_eq!(
            next_status_update(SessionStatus::Idle, "codex", SessionStatus::NeedsAttention),
            Some(SessionStatus::NeedsAttention)
        );
        assert_eq!(
            next_status_update(SessionStatus::Running, "claude-code", SessionStatus::Idle),
            Some(SessionStatus::Idle)
        );
    }
}
