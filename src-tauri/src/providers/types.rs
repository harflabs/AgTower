//! Shared types used across providers.

use serde::Serialize;

/// Result of detecting whether a provider's CLI is available.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct DetectionResult {
    pub available: bool,
    pub version: Option<String>,
}

/// Metadata extracted from a provider's session file.
#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct SessionMetadata {
    pub model: Option<String>,
    pub num_turns: u32,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cache_write_tokens: u64,
    pub provider_session_id: Option<String>,
    pub provider_file_path: Option<String>,
    pub slug: Option<String>,
    /// Exact title set by an explicit user `/rename` in the provider CLI.
    /// Distinct from `slug` (auto-derived): an explicit rename is a deliberate
    /// user action and should override an auto-generated AgTower title.
    pub custom_title: Option<String>,
    /// Epoch-ms timestamp of the `custom-title` entry (when the `/rename` ran).
    /// Compared against a sidebar rename's `titleSetAt` so a stale CLI rename
    /// can't clobber a newer sidebar rename. `None` if the entry had no usable
    /// timestamp, in which case the CLI rename is treated as "not provably
    /// newer" and a user sidebar title is preserved.
    pub custom_title_at: Option<i64>,
}
