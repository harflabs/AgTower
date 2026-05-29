use std::process::Command;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_state::{AppState, SessionEvent};
use crate::engine::session_store::{SessionStatus, SessionUpdate};
use crate::engine::Engine;
use crate::pty_manager::{PtyLaunchSpec, PtyOwnerLease, PtyPreviewBootstrap, PtyStateSnapshot};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TmuxAvailability {
    pub available: bool,
    pub version: Option<String>,
}

fn emit_preview_state(app: &AppHandle, state: &AppState, session_id: &str) {
    if let Some(snapshot) = state.pty.get_state(session_id) {
        let _ = app.emit(&format!("pty-state-broadcast:{}", session_id), &snapshot);
    }
}

/// Check whether `tmux` is on PATH and return its version string.
///
/// Used by the Settings page to validate the "Launch sessions in tmux"
/// toggle before enabling it — we don't bundle tmux, the user is expected
/// to install it themselves (e.g. `brew install tmux`).
#[tauri::command]
pub(crate) fn check_tmux_available() -> TmuxAvailability {
    let output = Command::new("tmux").arg("-V").output();
    match output {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            TmuxAvailability {
                available: true,
                version: if version.is_empty() {
                    None
                } else {
                    Some(version)
                },
            }
        }
        _ => TmuxAvailability {
            available: false,
            version: None,
        },
    }
}

#[tauri::command]
pub(crate) fn claim_pty_owner(
    state: State<'_, AppState>,
    session_id: String,
    owner_token: String,
) -> PtyOwnerLease {
    state.pty.claim_owner(&session_id, &owner_token)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_pty_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    repo_path: String,
    launch: PtyLaunchSpec,
    owner_token: String,
    owner_generation: u64,
    cols: u16,
    rows: u16,
    on_event: Channel<SessionEvent>,
    launch_in_tmux: Option<bool>,
) -> Result<(), String> {
    state.pty.create_session(
        &session_id,
        &repo_path,
        &launch,
        &owner_token,
        owner_generation,
        cols,
        rows,
        on_event,
        app.clone(),
        launch_in_tmux.unwrap_or(false),
    )?;
    emit_preview_state(&app, &state, &session_id);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn attach_pty_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
    on_event: Channel<SessionEvent>,
    owner_token: String,
    owner_generation: u64,
    replay_snapshot: bool,
) -> Result<(), String> {
    state.pty.attach_session(
        &session_id,
        cols,
        rows,
        on_event,
        &owner_token,
        owner_generation,
        replay_snapshot,
    )?;
    emit_preview_state(&app, &state, &session_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn park_pty_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    owner_token: Option<String>,
    owner_generation: Option<u64>,
) -> Result<(), String> {
    state
        .pty
        .park_session(&session_id, owner_token.as_deref(), owner_generation)?;
    emit_preview_state(&app, &state, &session_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_pty_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Option<PtyStateSnapshot> {
    state.pty.get_state(&session_id)
}

#[tauri::command]
pub(crate) fn get_pty_preview_bootstrap(
    state: State<'_, AppState>,
    session_id: String,
) -> Option<PtyPreviewBootstrap> {
    state.pty.get_preview_bootstrap(&session_id)
}

#[tauri::command]
pub(crate) fn write_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.pty.write(&session_id, &data)?;

    // Pushing the session back to Running on user submission is the only
    // "user just asked the agent to do something" signal we have for
    // providers that don't push Running via a hook (Codex in particular —
    // its `notify` field only fires on turn-complete). Claude Code has its
    // own `UserPromptSubmit` hook that gets here first in practice, but
    // this write_terminal path is a harmless no-op for it either way.
    //
    // Heuristic: only flip on writes containing `\r`/`\n` (Enter) and never
    // on ESC-prefixed writes (mouse, focus reporting, arrow keys, function
    // keys — all start with `\x1b[` and don't carry a newline).
    let has_submission = data.contains(&b'\r') || data.contains(&b'\n');
    let starts_with_esc = matches!(data.first(), Some(&0x1B));
    if !has_submission || starts_with_esc {
        return Ok(());
    }

    if let Some(engine) = app.try_state::<Arc<Engine>>() {
        if let Some(session) = engine.sessions.get(&session_id) {
            if matches!(
                session.status,
                SessionStatus::Idle | SessionStatus::NeedsAttention
            ) && matches!(session.provider.as_str(), "claude-code" | "codex")
            {
                let _ = engine.sessions.update(
                    &session_id,
                    SessionUpdate {
                        status: Some(SessionStatus::Running),
                        ..Default::default()
                    },
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn resize_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&session_id, cols, rows)?;
    emit_preview_state(&app, &state, &session_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn kill_pty_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.pty.kill_session(&session_id)
}

/// Pause PTY reading for a session (frontend backpressure).
#[tauri::command]
pub(crate) fn pause_pty_reading(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.pty.pause_reading(&session_id)
}

/// Resume PTY reading for a session.
#[tauri::command]
pub(crate) fn resume_pty_reading(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.pty.resume_reading(&session_id)
}

/// Inform the backend that a session's terminal view has gained or lost focus.
///
/// Writes an xterm focus-reporting CSI sequence (`\x1b[I` / `\x1b[O`) into the
/// PTY so focus-gated providers (notably Codex) can correctly emit BEL / OSC-9
/// notifications when the user isn't looking at the terminal.
///
/// Idempotent: safe to call from any frontend lifecycle (mount, unmount,
/// window blur/focus, tab switch).
#[tauri::command]
pub(crate) fn set_session_focused(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    focused: bool,
) -> Result<(), String> {
    // 1. Tell Codex about the terminal's focus state so its own notification
    //    gate opens when the user isn't looking.
    state.pty.send_focus_event(&session_id, focused)?;

    // 2. Treat "the user focused this session" as an implicit acknowledgment
    //    of any outstanding NeedsAttention. If they open the session and don't
    //    reply, we transition to Idle so the sidebar badge clears. If they
    //    actually reply, the provider's `UserPromptSubmit` hook (Claude) or
    //    the Enter-driven flip in `write_terminal` (Codex) will push Running.
    if focused {
        if let Some(engine) = app.try_state::<Arc<Engine>>() {
            if let Some(session) = engine.sessions.get(&session_id) {
                if session.status == SessionStatus::NeedsAttention {
                    let _ = engine.sessions.update(
                        &session_id,
                        SessionUpdate {
                            status: Some(SessionStatus::Idle),
                            ..Default::default()
                        },
                    );
                }
            }
        }
    }

    Ok(())
}
