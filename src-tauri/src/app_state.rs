//! Universal application state and PTY event types.
//!
//! Provider-agnostic — used by all providers for PTY communication.

use serde::Serialize;

use crate::pty_manager::PtyManager;

// --- Event type sent to frontend via Channel ---

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub(crate) enum SessionEvent {
    /// Base64-encoded raw PTY output bytes.
    PtyOutput { data: String },
    Terminated {
        code: Option<i32>,
        signal: Option<String>,
    },
}

// --- App state (managed by Tauri) ---

pub(crate) struct AppState {
    pub pty: PtyManager,
}
