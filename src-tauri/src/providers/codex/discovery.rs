//! Codex session discovery and metadata extraction.
//!
//! Scans `~/.codex/sessions/` for rollout JSONL files and extracts session metadata.
//! Supplements with data from the Codex SQLite database.

use serde::Serialize;
use std::cmp::Reverse;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::providers::types::SessionMetadata;

// ---------------------------------------------------------------------------
// Shared rollout parser (incremental + one-shot)
// ---------------------------------------------------------------------------

/// Snapshot of cumulative token-count fields extracted from a `token_count` event.
///
/// Codex's `token_count` events always report **cumulative** totals for the
/// session (not per-turn deltas), so callers should treat each new snapshot as
/// a replacement for the previous totals rather than additive.
#[derive(Debug, Clone, Default)]
pub(crate) struct TokenCountSnapshot {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
}

/// Parse a cumulative-token snapshot from an `event_msg.type == token_count` payload.
///
/// Handles both the nested `info.total_token_usage` schema (richer, newer Codex
/// versions) and the flat-field fallback. Returns `None` if the line is not a
/// valid token_count event.
fn parse_token_count_payload(payload: &serde_json::Value) -> Option<TokenCountSnapshot> {
    let mut snap = TokenCountSnapshot::default();

    let total_usage = payload.get("info").and_then(|i| i.get("total_token_usage"));

    if let Some(usage) = total_usage {
        if let Some(v) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
            snap.input_tokens = v;
        }
        if let Some(v) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
            snap.output_tokens = v;
        }
        if let Some(v) = usage.get("cached_input_tokens").and_then(|v| v.as_u64()) {
            snap.cache_read_tokens = v;
        }
    } else {
        if let Some(v) = payload.get("input_tokens").and_then(|v| v.as_u64()) {
            snap.input_tokens = v;
        }
        if let Some(v) = payload.get("output_tokens").and_then(|v| v.as_u64()) {
            snap.output_tokens = v;
        }
        if let Some(v) = payload.get("cached_input_tokens").and_then(|v| v.as_u64()) {
            snap.cache_read_tokens = v;
        }
    }

    Some(snap)
}

/// A discovered Codex CLI session (returned to the frontend).
#[derive(Debug, Clone, Serialize)]
pub(crate) struct DiscoveredCodexSession {
    pub thread_id: String,
    pub project_path: String,
    pub title: String,
    pub git_branch: Option<String>,
    pub model: Option<String>,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub message_count: u32,
    pub rollout_path: String,
    pub is_active: bool,
}

/// Scan `~/.codex/sessions/` for rollout JSONL files.
#[tauri::command]
pub(crate) async fn scan_codex_sessions() -> Result<Vec<DiscoveredCodexSession>, String> {
    tauri::async_runtime::spawn_blocking(scan_codex_sessions_sync)
        .await
        .map_err(|e| format!("Scan task failed: {}", e))?
}

pub(crate) fn scan_codex_sessions_sync() -> Result<Vec<DiscoveredCodexSession>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let sessions_dir = home.join(".codex").join("sessions");

    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut rollout_files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    // Codex organizes rollouts into date subdirectories: sessions/YYYY/MM/DD/rollout-*.jsonl
    collect_rollout_files(&sessions_dir, &mut rollout_files);

    // Sort by modification time, most recent first
    rollout_files.sort_by_key(|(_, mtime)| Reverse(*mtime));

    let mut results = Vec::new();
    for (path, mtime) in rollout_files {
        if let Some(session) = extract_discovered_session(&path, &mtime) {
            results.push(session);
        }
    }

    Ok(results)
}

/// Extract a discovered session from a rollout JSONL file.
/// Recursively collect rollout-*.jsonl files from a directory tree.
/// Codex stores rollouts in date-based subdirectories: sessions/YYYY/MM/DD/rollout-*.jsonl
fn collect_rollout_files(dir: &Path, out: &mut Vec<(PathBuf, std::time::SystemTime)>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollout_files(&path, out);
        } else {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                let mtime = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::UNIX_EPOCH);
                out.push((path, mtime));
            }
        }
    }
}

fn extract_discovered_session(
    path: &Path,
    mtime: &std::time::SystemTime,
) -> Option<DiscoveredCodexSession> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut thread_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut model_provider: Option<String> = None;
    let mut message_count: u32 = 0;
    let mut created_at: Option<i64> = None;
    let model: Option<String> = None;

    // Parse first ~200 lines for metadata
    for (i, line) in reader.lines().enumerate() {
        if i > 200 {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match entry_type {
            "session_meta" => {
                let payload = parsed.get("payload").unwrap_or(&parsed);
                thread_id = payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                cwd = payload
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                model_provider = payload
                    .get("model_provider")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(ts) = payload.get("timestamp").and_then(|v| v.as_str()) {
                    created_at = chrono::DateTime::parse_from_rfc3339(ts)
                        .ok()
                        .map(|dt| dt.timestamp_millis());
                }
            }
            "event_msg" => {
                let payload = parsed.get("payload").unwrap_or(&parsed);
                let msg_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match msg_type {
                    "user_message" | "task_started" | "turn_started" | "agent_message"
                    | "task_complete" | "turn_complete" => {
                        message_count += 1;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let thread_id = thread_id?;

    let file_name = path.file_name()?.to_str()?;
    let title = file_name.to_string();
    let git_branch: Option<String> = None;

    let last_activity_at = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Some(DiscoveredCodexSession {
        thread_id,
        project_path: cwd.unwrap_or_default(),
        title,
        git_branch,
        model: model.or(model_provider),
        created_at: created_at.unwrap_or(last_activity_at),
        last_activity_at,
        message_count,
        rollout_path: path.to_string_lossy().to_string(),
        // Consider active if rollout file modified within the last 60 seconds
        is_active: std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|elapsed| elapsed < std::time::Duration::from_secs(60)),
    })
}

/// Extract metadata from a Codex session (called by ProviderDiscovery trait).
pub(crate) fn extract_codex_metadata_sync(
    _thread_id: Option<&str>,
    rollout_path: Option<&str>,
) -> Result<SessionMetadata, String> {
    let mut metadata = SessionMetadata::default();

    // Parse rollout JSONL for detailed token counts and turn info
    if let Some(rp) = rollout_path {
        let path = Path::new(rp);
        if path.is_file() {
            if let Ok(file) = std::fs::File::open(path) {
                let reader = BufReader::new(file);
                let mut num_turns: u32 = 0;
                let mut input_tokens: u64 = 0;
                let mut output_tokens: u64 = 0;
                let mut cache_read_tokens: u64 = 0;

                for line in reader.lines().map_while(Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let parsed: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let entry_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if entry_type == "event_msg" {
                        let payload = parsed.get("payload").unwrap_or(&parsed);
                        let msg_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match msg_type {
                            "token_count" => {
                                if let Some(snap) = parse_token_count_payload(payload) {
                                    input_tokens = snap.input_tokens;
                                    output_tokens = snap.output_tokens;
                                    cache_read_tokens = snap.cache_read_tokens;
                                }
                            }
                            "task_complete" | "turn_complete" => {
                                num_turns += 1;
                            }
                            _ => {}
                        }
                    }

                    // Check for model in session_meta
                    if entry_type == "session_meta" {
                        let payload = parsed.get("payload").unwrap_or(&parsed);
                        if metadata.model.is_none() {
                            metadata.model = payload
                                .get("model_provider")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                        }
                        if metadata.provider_session_id.is_none() {
                            metadata.provider_session_id = payload
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                        }
                    }
                }

                metadata.num_turns = num_turns;
                if input_tokens > 0 {
                    metadata.total_input_tokens = input_tokens;
                }
                metadata.total_output_tokens = output_tokens;
                metadata.total_cache_read_tokens = cache_read_tokens;
                metadata.provider_file_path = Some(rp.to_string());
            }
        }
    }

    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn token_count_prefers_nested_total_usage_over_flat_fields() {
        let payload = json!({
            "info": {
                "total_token_usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cached_input_tokens": 30
                }
            },
            // Flat fields must be ignored when the nested schema is present.
            "input_tokens": 999,
            "output_tokens": 999,
            "cached_input_tokens": 999
        });
        let snap = parse_token_count_payload(&payload).expect("parses");
        assert_eq!(snap.input_tokens, 100);
        assert_eq!(snap.output_tokens, 50);
        assert_eq!(snap.cache_read_tokens, 30);
    }

    #[test]
    fn token_count_falls_back_to_flat_fields() {
        let payload = json!({
            "input_tokens": 12,
            "output_tokens": 7,
            "cached_input_tokens": 3
        });
        let snap = parse_token_count_payload(&payload).expect("parses");
        assert_eq!(snap.input_tokens, 12);
        assert_eq!(snap.output_tokens, 7);
        assert_eq!(snap.cache_read_tokens, 3);
    }

    #[test]
    fn token_count_defaults_missing_fields_to_zero() {
        let snap = parse_token_count_payload(&json!({})).expect("parses to defaults");
        assert_eq!(snap.input_tokens, 0);
        assert_eq!(snap.output_tokens, 0);
        assert_eq!(snap.cache_read_tokens, 0);
    }

    #[test]
    fn extract_discovered_session_parses_meta_and_counts_messages() {
        let path = std::env::temp_dir().join("agtower_codex_extract_session_test.jsonl");
        let contents = concat!(
            r#"{"type":"session_meta","payload":{"id":"thread-123","cwd":"/work/proj","model_provider":"openai","timestamp":"2026-01-02T03:04:05Z"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"user_message"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"agent_message"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count"}}"#,
            "\n",
            "not valid json\n",
        );
        std::fs::write(&path, contents).expect("write fixture");

        let mtime = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        let session = extract_discovered_session(&path, &mtime).expect("session parsed");
        let _ = std::fs::remove_file(&path);

        assert_eq!(session.thread_id, "thread-123");
        assert_eq!(session.project_path, "/work/proj");
        assert_eq!(session.model.as_deref(), Some("openai"));
        assert_eq!(
            session.message_count, 2,
            "only user_message + agent_message are counted; token_count and malformed lines are not"
        );
        assert!(
            session.created_at > 0,
            "created_at parsed from the rfc3339 timestamp"
        );
    }

    #[test]
    fn extract_discovered_session_requires_a_thread_id() {
        let path = std::env::temp_dir().join("agtower_codex_no_thread_test.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"event_msg","payload":{"type":"user_message"}}"#,
        )
        .expect("write fixture");

        let mtime = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        let result = extract_discovered_session(&path, &mtime);
        let _ = std::fs::remove_file(&path);
        assert!(
            result.is_none(),
            "no session_meta id => no discovered session"
        );
    }
}
