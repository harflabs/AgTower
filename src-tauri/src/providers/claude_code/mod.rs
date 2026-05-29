pub(crate) mod detection;
pub(crate) mod discovery;

use crate::providers::types::SessionMetadata;
use crate::providers::{Provider, ProviderDiscovery};

pub(crate) struct ClaudeCodeProvider;

impl ClaudeCodeProvider {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl Provider for ClaudeCodeProvider {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn discovery(&self) -> &dyn ProviderDiscovery {
        &ClaudeCodeDiscovery
    }
}

struct ClaudeCodeDiscovery;
impl ProviderDiscovery for ClaudeCodeDiscovery {
    fn extract_metadata(
        &self,
        repo_path: &str,
        provider_data: &serde_json::Value,
        session_created_at: Option<i64>,
    ) -> Result<SessionMetadata, String> {
        let psid = provider_data.get("sessionId").and_then(|v| v.as_str());
        discovery::extract_session_metadata_sync(repo_path, psid, session_created_at)
    }

    fn session_file_exists(&self, repo_path: &str, provider_data: &serde_json::Value) -> bool {
        let sid = provider_data.get("sessionId").and_then(|v| v.as_str());
        discovery::claude_session_file_exists(repo_path, sid)
    }
}
