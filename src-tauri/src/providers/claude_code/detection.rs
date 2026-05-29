//! Claude Code CLI detection.

use serde::Serialize;
use tauri::AppHandle;

use crate::providers::types::DetectionResult;

/// Struct for frontend compatibility (matches TS ClaudeInfo type).
#[derive(Serialize)]
pub(crate) struct ClaudeInfo {
    pub available: bool,
    pub version: Option<String>,
}

pub(crate) async fn detect_claude_cli(app: &AppHandle, cli_path: Option<&str>) -> DetectionResult {
    use tauri_plugin_shell::ShellExt;
    let shell = app.shell();
    let command = cli_path
        .filter(|path| !path.trim().is_empty())
        .unwrap_or("claude");
    match shell.command(command).args(["--version"]).output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            DetectionResult {
                available: matches!(output.status.code(), Some(0)),
                version: if stdout.is_empty() {
                    None
                } else {
                    Some(stdout)
                },
            }
        }
        Err(_) => DetectionResult {
            available: false,
            version: None,
        },
    }
}
