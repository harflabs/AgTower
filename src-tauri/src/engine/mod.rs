//! Engine — the central coordinator for all application state.
//!
//! Owns sessions, repos, settings, and database access.
//! TypeScript sends user intents via Tauri commands; the engine
//! processes them and pushes state updates back via events.

pub(crate) mod computation;
pub(crate) mod database;
pub(crate) mod repo_store;
pub(crate) mod session_store;

use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use database::Database;
use repo_store::RepoStore;
use session_store::SessionStore;

use crate::providers::ProviderRegistry;

/// Current time as milliseconds since Unix epoch. Consistent with JS `Date.now()`.
pub(crate) fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ---------------------------------------------------------------------------
// Engine settings (synced from frontend, stored in SQLite)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineSettings {
    pub notifications_enabled: bool,
    pub notification_sound: bool,
    pub archive_after_days: u32,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            notification_sound: true,
            archive_after_days: 7,
        }
    }
}

// ---------------------------------------------------------------------------
// Engine — the central coordinator
// ---------------------------------------------------------------------------

pub(crate) struct Engine {
    pub sessions: Arc<SessionStore>,
    pub repos: Arc<RepoStore>,
    pub db: Arc<Database>,
    pub settings: Arc<RwLock<EngineSettings>>,
    /// Provider registry for metadata recovery and session-file checks.
    pub provider_registry: ProviderRegistry,
}

impl Engine {
    /// Create a new Engine. Call `startup()` after construction.
    pub(crate) fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        let db = Arc::new(Database::open(&app_data_dir)?);

        let sessions = Arc::new(SessionStore::new(db.clone(), app_handle.clone()));
        let repos = Arc::new(RepoStore::new(db.clone(), app_handle.clone()));

        // Load settings from DB
        let settings = Arc::new(RwLock::new(Self::load_settings(&db)));

        let provider_registry = ProviderRegistry::new();

        Ok(Self {
            sessions,
            repos,
            db,
            settings,
            provider_registry,
        })
    }

    /// Initialize engine state from the database.
    /// Call this once during app startup.
    ///
    /// **Order matters:**
    /// 1. Load from DB (populates memory)
    /// 2. Recover stale sessions (PID-liveness check)
    /// 3. Auto-archive stale closed sessions
    pub(crate) fn startup(&self) -> Result<(), String> {
        // Load repos first (sessions reference repo_id)
        self.repos.load_from_db()?;

        // Load sessions
        self.sessions.load_from_db()?;

        // PID-liveness reconciliation: flip any DB session marked active whose
        // stored PID is no longer alive to `closed`.
        self.sessions.recover_sessions();

        // Auto-archive stale closed sessions
        let archive_days = self.settings.read().archive_after_days;
        self.sessions.auto_archive_stale(archive_days);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    fn load_settings(db: &Database) -> EngineSettings {
        let mut settings = EngineSettings::default();

        if let Ok(pairs) = db.load_all_settings() {
            for (key, value) in pairs {
                match key.as_str() {
                    "notificationsEnabled" => {
                        settings.notifications_enabled = value == "true";
                    }
                    "notificationSound" => {
                        settings.notification_sound = value == "true";
                    }
                    "archiveAfterDays" => {
                        if let Ok(days) = value.parse::<u32>() {
                            settings.archive_after_days = days;
                        }
                    }
                    _ => {}
                }
            }
        }

        settings
    }

    pub(crate) fn get_settings(&self) -> EngineSettings {
        self.settings.read().clone()
    }

    pub(crate) fn update_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.db.set_setting(key, value).map_err(|e| e.to_string())?;

        // Update in-memory cache
        let mut settings = self.settings.write();
        match key {
            "notificationsEnabled" => settings.notifications_enabled = value == "true",
            "notificationSound" => settings.notification_sound = value == "true",
            "archiveAfterDays" => {
                if let Ok(days) = value.parse::<u32>() {
                    settings.archive_after_days = days;
                }
            }
            _ => {}
        }

        Ok(())
    }

    pub(crate) fn clear_settings(&self) -> Result<(), String> {
        self.db.clear_settings().map_err(|e| e.to_string())?;
        *self.settings.write() = EngineSettings::default();
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Workspace state (pass-through to DB)
    // -----------------------------------------------------------------------

    pub(crate) fn save_workspace_state(&self, key: &str, value: &str) -> Result<(), String> {
        self.db
            .save_workspace_state(key, value)
            .map_err(|e| e.to_string())
    }

    pub(crate) fn load_workspace_state(&self, key: &str) -> Result<Option<String>, String> {
        self.db.load_workspace_state(key).map_err(|e| e.to_string())
    }

    pub(crate) fn clear_workspace_state(&self) -> Result<(), String> {
        self.db.clear_workspace_state().map_err(|e| e.to_string())
    }
}
