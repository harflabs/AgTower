//! Backend provider discovery layer.
//!
//! Each AI coding assistant (Claude Code, Codex, etc.) implements `Provider`
//! so persisted sessions can recover provider-specific metadata and verify
//! whether their backing session files still exist.

pub(crate) mod claude_code;
pub(crate) mod codex;
pub(crate) mod types;

use std::collections::HashMap;

use types::SessionMetadata;

/// A provider implementation. Each provider bundles discovery capabilities.
pub(crate) trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn discovery(&self) -> &dyn ProviderDiscovery;
}

/// Discover existing sessions and extract metadata from provider session files.
pub(crate) trait ProviderDiscovery: Send + Sync {
    fn extract_metadata(
        &self,
        repo_path: &str,
        provider_data: &serde_json::Value,
        session_created_at: Option<i64>,
    ) -> Result<SessionMetadata, String>;

    /// Check whether the provider's backing session file still exists on disk.
    /// Returns true when the file is present OR when there is no provider
    /// identifier to check against (so sessions without backing state pass
    /// through to the launcher, which falls back to a fresh conversation).
    /// Returns false only when a concrete identifier points at a missing file.
    fn session_file_exists(&self, repo_path: &str, provider_data: &serde_json::Value) -> bool;
}

pub(crate) struct ProviderRegistry {
    providers: HashMap<String, Box<dyn Provider>>,
}

impl ProviderRegistry {
    pub(crate) fn new() -> Self {
        let mut registry = Self {
            providers: HashMap::new(),
        };
        registry.register(Box::new(claude_code::ClaudeCodeProvider::new()));
        registry.register(Box::new(codex::CodexProvider::new()));
        registry
    }

    pub(crate) fn register(&mut self, provider: Box<dyn Provider>) {
        self.providers.insert(provider.id().to_string(), provider);
    }

    pub(crate) fn get(&self, id: &str) -> Option<&dyn Provider> {
        self.providers.get(id).map(|p| p.as_ref())
    }
}
