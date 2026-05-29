pub(crate) mod detection;
pub(crate) mod discovery;

use crate::providers::types::SessionMetadata;
use crate::providers::{Provider, ProviderDiscovery};

pub(crate) struct CodexProvider;

impl CodexProvider {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl Provider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn discovery(&self) -> &dyn ProviderDiscovery {
        &CodexDiscovery
    }
}

struct CodexDiscovery;
impl ProviderDiscovery for CodexDiscovery {
    fn extract_metadata(
        &self,
        _repo_path: &str,
        provider_data: &serde_json::Value,
        _session_created_at: Option<i64>,
    ) -> Result<SessionMetadata, String> {
        let thread_id = provider_data.get("threadId").and_then(|v| v.as_str());
        let rollout_path = provider_data.get("rolloutPath").and_then(|v| v.as_str());
        discovery::extract_codex_metadata_sync(thread_id, rollout_path)
    }

    fn session_file_exists(&self, _repo_path: &str, provider_data: &serde_json::Value) -> bool {
        match provider_data.get("rolloutPath").and_then(|v| v.as_str()) {
            Some(path) => std::path::Path::new(path).is_file(),
            None => true,
        }
    }
}
