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
}
