//! Provider commands.
//!
//! Re-exports provider functions as Tauri commands.

pub(crate) use crate::providers::claude_code::discovery::*;

use crate::providers::claude_code::detection::{detect_claude_cli, ClaudeInfo};

#[tauri::command]
pub(crate) async fn detect_claude(
    app: tauri::AppHandle,
    cli_path: Option<String>,
) -> Result<ClaudeInfo, String> {
    let result = detect_claude_cli(&app, cli_path.as_deref()).await;
    Ok(ClaudeInfo {
        available: result.available,
        version: result.version,
    })
}

use crate::providers::codex::detection::{detect_codex_cli, CodexInfo};

#[tauri::command]
pub(crate) async fn detect_codex(
    app: tauri::AppHandle,
    cli_path: Option<String>,
) -> Result<CodexInfo, String> {
    let result = detect_codex_cli(&app, cli_path.as_deref()).await;
    Ok(CodexInfo {
        available: result.available,
        version: result.version,
    })
}

use crate::providers::codex::discovery::extract_codex_metadata_sync;
use crate::providers::types::SessionMetadata;

#[tauri::command]
pub(crate) async fn extract_codex_metadata(
    thread_id: Option<String>,
    rollout_path: Option<String>,
) -> Result<SessionMetadata, String> {
    extract_codex_metadata_sync(thread_id.as_deref(), rollout_path.as_deref())
}
