//! In-memory session store backed by SQLite.
//!
//! DB writes happen synchronously on every mutation (no debounce — Rust
//! writes take <1ms). Per-mutation `session:*` events fire immediately so
//! the Zustand frontend store stays in sync; a 16ms-debounced
//! `engine:views-dirty` event coalesces rapid changes for views that
//! recompute over the full session set.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::database::{Database, SessionRow};

/// All valid session lifecycle states.
/// Serialises to/from lowercase strings for JSON and SQLite compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SessionStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "needsAttention")]
    NeedsAttention,
    #[serde(rename = "closed")]
    Closed,
    #[serde(rename = "archived")]
    Archived,
}

impl SessionStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Idle => "idle",
            Self::NeedsAttention => "needsAttention",
            Self::Closed => "closed",
            Self::Archived => "archived",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "running" => Self::Running,
            "idle" => Self::Idle,
            "needsAttention" | "waiting" | "errored" => Self::NeedsAttention,
            "closed" | "completed" | "stopped" => Self::Closed,
            "archived" | "done" => Self::Archived,
            _ => {
                eprintln!(
                    "[engine] Unknown session status {:?}, defaulting to \"closed\"",
                    s
                );
                Self::Closed
            }
        }
    }

    /// Session is actively doing something (running, idle between turns, or needs user action).
    pub(crate) fn is_active(self) -> bool {
        matches!(self, Self::Running | Self::Idle | Self::NeedsAttention)
    }

    /// Session has reached a terminal state.
    fn is_terminal(self) -> bool {
        matches!(self, Self::Closed | Self::Archived)
    }
}

/// Whether a title looks auto-generated (a placeholder AgTower assigned), as
/// opposed to a title the user typed in the sidebar. Auto titles may be
/// freely overwritten by a provider-derived slug; user titles must not.
fn is_auto_generated_title(title: &str) -> bool {
    title.starts_with("New Session")
        || title.starts_with("Session ")
        || title == "Untitled CLI session"
        || (title.contains('<') && title.contains('>'))
}

/// Decide whether a provider re-extraction should change the session title,
/// and to what. Returns `None` to leave the title unchanged (a no-op).
///
/// Precedence:
///  1. An explicit `/rename` (`custom_title`, non-empty) is a deliberate user
///     action. It overrides an auto-generated title unconditionally. Against a
///     user-set *sidebar* title it only wins when the CLI rename is provably
///     newer (`custom_title_at` > `user_title_set_at`) — otherwise we'd let a
///     stale `custom-title` still sitting in the JSONL revert a sidebar rename
///     the user made afterwards (`rename_session` is DB-only and never rewrites
///     the JSONL). If `custom_title` already equals the current title, no-op.
///  2. Otherwise a provider `slug` only overwrites an AUTO-generated title.
///     This protects a manual sidebar rename from being clobbered by an
///     auto-derived slug.
///  3. Otherwise leave the title as-is.
///
/// `custom_title_at` / `user_title_set_at` are epoch-ms; either may be `None`.
/// When the CLI rename's recency can't be established but a sidebar rename
/// exists, the sidebar title is preserved.
fn select_extracted_title(
    current_title: &str,
    custom_title: Option<&str>,
    custom_title_at: Option<i64>,
    slug: Option<&str>,
    user_title_set_at: Option<i64>,
) -> Option<String> {
    if let Some(t) = custom_title {
        let t = t.trim();
        if !t.is_empty() {
            if t == current_title {
                return None;
            }
            // Auto titles always yield to an explicit rename. A user's sidebar
            // title only yields when the CLI rename is provably newer than it.
            let cli_wins = is_auto_generated_title(current_title)
                || match (custom_title_at, user_title_set_at) {
                    (_, None) => true,
                    (Some(cli), Some(user)) => cli > user,
                    (None, Some(_)) => false,
                };
            if cli_wins {
                return Some(t.to_string());
            }
            // A newer sidebar rename — don't clobber it; fall through (the slug
            // branch won't touch a non-auto title either).
        }
    }
    if let Some(s) = slug {
        if is_auto_generated_title(current_title) && s != current_title {
            return Some(s.to_string());
        }
    }
    None
}

/// Whether a session should receive a one-time `titleSetAt` backfill: it has a
/// user-meaningful (non-auto) title but no `titleSetAt` stamp.
///
/// Stamping marks the existing title as user-owned as of now, so a stale
/// `custom-title` in a provider log can't revert it on the next re-extraction,
/// while a genuinely newer `/rename` still wins on recency.
fn needs_title_set_at_backfill(title: &str, provider_data: &Value) -> bool {
    !is_auto_generated_title(title)
        && provider_data
            .get("titleSetAt")
            .and_then(|v| v.as_i64())
            .is_none()
}

#[cfg(test)]
mod tests {
    use super::{
        apply_updates, duplicate_session_ids, is_auto_generated_title, select_extracted_title,
        Session, SessionStatus, SessionUpdate,
    };
    use serde_json::json;
    use std::collections::HashMap;

    fn sample_session(id: &str, created_at: i64, provider_session_id: Option<&str>) -> Session {
        Session {
            id: id.to_string(),
            repo_id: "repo".to_string(),
            repo_path: "/tmp/repo".to_string(),
            repo_name: "repo".to_string(),
            prompt: String::new(),
            title: "Title".to_string(),
            status: SessionStatus::Running,
            pid: None,
            model: None,
            created_at,
            ended_at: None,
            result: None,
            duration_ms: None,
            num_turns: None,
            exit_code: None,
            error: None,
            base_commit_sha: None,
            pty_active: false,
            total_input_tokens: None,
            total_output_tokens: None,
            total_cache_read_tokens: None,
            total_cache_write_tokens: None,
            git_branch: None,
            stop_reason: None,
            provider: "codex".to_string(),
            provider_data: match provider_session_id {
                Some(sid) => json!({ "sessionId": sid }),
                None => json!({}),
            },
            live_provider_data: json!({}),
        }
    }

    #[test]
    fn apply_updates_transient_only_is_not_persistent() {
        let mut s = sample_session("s1", 1, None);
        let updates = SessionUpdate {
            pty_active: Some(true),
            live_provider_data: Some(json!({ "tool": "edit" })),
            ..Default::default()
        };
        let persistent = apply_updates(&mut s, &updates);
        assert!(
            !persistent,
            "pty_active + live_provider_data must not trigger a DB write"
        );
        assert!(s.pty_active);
        assert_eq!(s.live_provider_data["tool"], json!("edit"));
        assert_eq!(
            s.status,
            SessionStatus::Running,
            "persistent fields untouched"
        );
    }

    #[test]
    fn apply_updates_status_change_is_persistent() {
        let mut s = sample_session("s1", 1, None);
        let updates = SessionUpdate {
            status: Some(SessionStatus::Closed),
            ..Default::default()
        };
        assert!(apply_updates(&mut s, &updates));
        assert_eq!(s.status, SessionStatus::Closed);
    }

    #[test]
    fn apply_updates_merges_provider_data_preserving_untouched_keys() {
        let mut s = sample_session("s1", 1, Some("abc"));
        let updates = SessionUpdate {
            provider_data: Some(json!({ "model": "gpt-5" })),
            ..Default::default()
        };
        assert!(
            apply_updates(&mut s, &updates),
            "provider_data update is persistent"
        );
        assert_eq!(
            s.provider_data["sessionId"],
            json!("abc"),
            "existing key preserved"
        );
        assert_eq!(
            s.provider_data["model"],
            json!("gpt-5"),
            "incoming key merged"
        );
    }

    #[test]
    fn apply_updates_non_object_provider_data_replaces_blob() {
        let mut s = sample_session("s1", 1, Some("abc"));
        let updates = SessionUpdate {
            provider_data: Some(json!("scalar")),
            ..Default::default()
        };
        assert!(apply_updates(&mut s, &updates));
        assert_eq!(s.provider_data, json!("scalar"));
    }

    #[test]
    fn apply_updates_live_provider_data_merges_but_is_not_persistent() {
        let mut s = sample_session("s1", 1, None);
        s.live_provider_data = json!({ "a": 1 });
        let updates = SessionUpdate {
            live_provider_data: Some(json!({ "b": 2 })),
            ..Default::default()
        };
        assert!(!apply_updates(&mut s, &updates));
        assert_eq!(s.live_provider_data["a"], json!(1));
        assert_eq!(s.live_provider_data["b"], json!(2));
    }

    #[test]
    fn duplicate_session_ids_keeps_oldest_removes_newer() {
        let mut map: HashMap<String, Session> = HashMap::new();
        map.insert("old".into(), sample_session("old", 100, Some("dup")));
        map.insert("new".into(), sample_session("new", 200, Some("dup")));
        map.insert("solo".into(), sample_session("solo", 150, Some("unique")));
        map.insert("none".into(), sample_session("none", 50, None));
        let remove = duplicate_session_ids(&map);
        assert_eq!(
            remove,
            vec!["new".to_string()],
            "only the newer of the same-sessionId pair is removed"
        );
    }

    #[test]
    fn duplicate_session_ids_ignores_sessions_without_provider_session_id() {
        let mut map: HashMap<String, Session> = HashMap::new();
        map.insert("a".into(), sample_session("a", 1, None));
        map.insert("b".into(), sample_session("b", 2, None));
        assert!(duplicate_session_ids(&map).is_empty());
    }

    #[test]
    fn as_str_returns_expected_values() {
        assert_eq!(SessionStatus::Running.as_str(), "running");
        assert_eq!(SessionStatus::Idle.as_str(), "idle");
        assert_eq!(SessionStatus::NeedsAttention.as_str(), "needsAttention");
        assert_eq!(SessionStatus::Closed.as_str(), "closed");
        assert_eq!(SessionStatus::Archived.as_str(), "archived");
    }

    #[test]
    fn from_str_round_trips_with_as_str() {
        for status in [
            SessionStatus::Running,
            SessionStatus::Idle,
            SessionStatus::NeedsAttention,
            SessionStatus::Closed,
            SessionStatus::Archived,
        ] {
            assert_eq!(SessionStatus::from_str(status.as_str()), status);
        }
    }

    #[test]
    fn from_str_maps_attention_aliases() {
        assert_eq!(
            SessionStatus::from_str("waiting"),
            SessionStatus::NeedsAttention
        );
        assert_eq!(
            SessionStatus::from_str("errored"),
            SessionStatus::NeedsAttention
        );
    }

    #[test]
    fn from_str_maps_closed_aliases() {
        assert_eq!(SessionStatus::from_str("completed"), SessionStatus::Closed);
        assert_eq!(SessionStatus::from_str("stopped"), SessionStatus::Closed);
    }

    #[test]
    fn from_str_maps_archived_aliases() {
        assert_eq!(SessionStatus::from_str("done"), SessionStatus::Archived);
    }

    #[test]
    fn from_str_unknown_defaults_to_closed() {
        assert_eq!(SessionStatus::from_str("garbage"), SessionStatus::Closed);
        assert_eq!(SessionStatus::from_str(""), SessionStatus::Closed);
    }

    #[test]
    fn active_statuses() {
        assert!(SessionStatus::Running.is_active());
        assert!(SessionStatus::Idle.is_active());
        assert!(SessionStatus::NeedsAttention.is_active());
        assert!(!SessionStatus::Closed.is_active());
        assert!(!SessionStatus::Archived.is_active());
    }

    #[test]
    fn terminal_statuses() {
        assert!(!SessionStatus::Running.is_terminal());
        assert!(!SessionStatus::Idle.is_terminal());
        assert!(!SessionStatus::NeedsAttention.is_terminal());
        assert!(SessionStatus::Closed.is_terminal());
        assert!(SessionStatus::Archived.is_terminal());
    }

    #[test]
    fn active_and_terminal_are_complementary() {
        for status in [
            SessionStatus::Running,
            SessionStatus::Idle,
            SessionStatus::NeedsAttention,
            SessionStatus::Closed,
            SessionStatus::Archived,
        ] {
            assert_ne!(
                status.is_active(),
                status.is_terminal(),
                "{} should be exactly one of active or terminal",
                status.as_str()
            );
        }
    }

    #[test]
    fn serde_json_round_trip() {
        for status in [
            SessionStatus::Running,
            SessionStatus::Idle,
            SessionStatus::NeedsAttention,
            SessionStatus::Closed,
            SessionStatus::Archived,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let back: SessionStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, status);
        }
    }

    #[test]
    fn serde_deserializes_expected_strings() {
        assert_eq!(
            serde_json::from_str::<SessionStatus>(r#""running""#).unwrap(),
            SessionStatus::Running
        );
        assert_eq!(
            serde_json::from_str::<SessionStatus>(r#""needsAttention""#).unwrap(),
            SessionStatus::NeedsAttention
        );
    }

    // -- title precedence (CLI /rename -> sidebar) ---------------------------

    #[test]
    fn is_auto_generated_title_recognizes_placeholders() {
        assert!(is_auto_generated_title("New Session"));
        assert!(is_auto_generated_title("New Session 3"));
        assert!(is_auto_generated_title("Session abc123"));
        assert!(is_auto_generated_title("Untitled CLI session"));
        assert!(is_auto_generated_title("<some prompt fragment>"));
        // A real user title is not auto-generated.
        assert!(!is_auto_generated_title("Fix the login bug"));
        assert!(!is_auto_generated_title("my-feature-branch"));
    }

    #[test]
    fn custom_title_overrides_auto_title() {
        // (a) An explicit /rename replaces an auto-generated title. No competing
        // sidebar rename, so timestamps don't matter.
        let chosen = select_extracted_title(
            "New Session",
            Some("Refactor auth"),
            Some(100),
            Some("some-slug"),
            None,
        );
        assert_eq!(chosen, Some("Refactor auth".to_string()));
    }

    #[test]
    fn cli_rename_overrides_older_sidebar_rename() {
        // A CLI /rename wins over a user sidebar title when it is newer.
        let chosen = select_extracted_title(
            "Set in sidebar",
            Some("Renamed in CLI"),
            Some(300),
            Some("ignored-slug"),
            Some(200),
        );
        assert_eq!(chosen, Some("Renamed in CLI".to_string()));
    }

    #[test]
    fn newer_sidebar_rename_is_not_clobbered_by_stale_cli_rename() {
        // Regression guard: a stale custom-title left in the JSONL must NOT
        // revert a sidebar rename the user made afterwards.
        let chosen = select_extracted_title(
            "Set in sidebar",
            Some("Old CLI title"),
            Some(100),
            Some("foo-slug"),
            Some(200),
        );
        assert_eq!(chosen, None);
    }

    #[test]
    fn cli_rename_wins_when_no_sidebar_stamp() {
        // A non-auto title with no sidebar stamp (e.g. it came from an earlier
        // CLI rename) yields to a newer CLI rename.
        let chosen = select_extracted_title(
            "Earlier CLI title",
            Some("Newer CLI title"),
            None,
            None,
            None,
        );
        assert_eq!(chosen, Some("Newer CLI title".to_string()));
    }

    #[test]
    fn cli_rename_without_timestamp_preserves_user_title() {
        // If we can't prove the CLI rename is newer than the sidebar rename,
        // preserve the user's sidebar title.
        let chosen = select_extracted_title(
            "Set in sidebar",
            Some("Untimestamped CLI title"),
            None,
            None,
            Some(200),
        );
        assert_eq!(chosen, None);
    }

    #[test]
    fn custom_title_equal_to_current_is_a_noop() {
        // No-op when the explicit rename already matches the current title.
        let chosen =
            select_extracted_title("Same Title", Some("Same Title"), Some(100), None, None);
        assert_eq!(chosen, None);
    }

    #[test]
    fn empty_custom_title_falls_back_to_slug_rules() {
        // An empty/whitespace custom_title is ignored; slug rules apply instead.
        let chosen =
            select_extracted_title("New Session", Some("   "), None, Some("derived-slug"), None);
        assert_eq!(chosen, Some("derived-slug".to_string()));
    }

    #[test]
    fn slug_only_overrides_when_title_is_auto() {
        // (c) With no custom_title, slug overwrites ONLY an auto-generated title.
        let from_auto = select_extracted_title("New Session", None, None, Some("real-slug"), None);
        assert_eq!(from_auto, Some("real-slug".to_string()));

        // (d) A user-set (non-auto) title is preserved against a slug-only update.
        let from_user =
            select_extracted_title("My Manual Title", None, None, Some("real-slug"), Some(200));
        assert_eq!(from_user, None);
    }

    #[test]
    fn slug_equal_to_current_auto_title_is_a_noop() {
        // Auto title that already equals the slug should not re-emit a change.
        let chosen = select_extracted_title("real-slug", None, None, Some("real-slug"), None);
        assert_eq!(chosen, None);
    }

    #[test]
    fn no_signals_leaves_title_unchanged() {
        let chosen = select_extracted_title("Whatever", None, None, None, None);
        assert_eq!(chosen, None);
    }

    // -- title-provenance backfill -------------------------------------------

    #[test]
    fn backfill_targets_only_unstamped_non_auto_titles() {
        use super::needs_title_set_at_backfill;
        // Non-auto title with no stamp -> needs backfill (incl. when other
        // provider_data keys like slug are present).
        assert!(needs_title_set_at_backfill("Fix the login bug", &json!({})));
        assert!(needs_title_set_at_backfill(
            "Fix the login bug",
            &json!({ "slug": "fix-login" })
        ));
        // Already stamped -> skip.
        assert!(!needs_title_set_at_backfill(
            "Fix the login bug",
            &json!({ "titleSetAt": 1_700_000_000_000_i64 })
        ));
        // Auto-generated titles are never user-owned -> skip.
        assert!(!needs_title_set_at_backfill("New Session", &json!({})));
        assert!(!needs_title_set_at_backfill(
            "Untitled CLI session",
            &json!({})
        ));
        // A non-integer / null stamp is treated as missing.
        assert!(needs_title_set_at_backfill(
            "Fix the login bug",
            &json!({ "titleSetAt": null })
        ));
    }
}

/// Persistent session data — mirrored to SQLite on every mutation.
/// Field names use camelCase for direct JSON serialisation to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Session {
    pub id: String,
    pub repo_id: String,
    pub repo_path: String,
    pub repo_name: String,
    pub prompt: String,
    pub title: String,
    pub status: SessionStatus,
    pub pid: Option<i64>,
    pub model: Option<String>,
    pub created_at: i64,
    pub ended_at: Option<i64>,
    pub result: Option<String>,
    pub duration_ms: Option<i64>,
    pub num_turns: Option<i64>,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub base_commit_sha: Option<String>,
    pub pty_active: bool,
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
    pub total_cache_read_tokens: Option<i64>,
    pub total_cache_write_tokens: Option<i64>,
    pub git_branch: Option<String>,
    pub stop_reason: Option<String>,
    pub provider: String,
    /// Provider-specific data stored as a JSON blob (persisted to DB).
    /// Key names are provider-defined (e.g. sessionId, filePath, slug).
    pub provider_data: Value,
    /// Provider-specific transient live state (never persisted to DB).
    /// Deep-merged on updates, same as provider_data.
    pub live_provider_data: Value,
}

impl Session {
    fn pd_session_id(&self) -> Option<&str> {
        self.provider_data.get("sessionId").and_then(|v| v.as_str())
    }
}

/// Partial update — only the fields that are `Some` will be applied.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SessionUpdate {
    pub repo_id: Option<String>,
    pub repo_path: Option<String>,
    pub repo_name: Option<String>,
    pub title: Option<String>,
    pub status: Option<SessionStatus>,
    pub pid: Option<Option<i64>>,
    pub model: Option<Option<String>>,
    pub ended_at: Option<Option<i64>>,
    pub result: Option<Option<String>>,
    pub duration_ms: Option<Option<i64>>,
    pub num_turns: Option<Option<i64>>,
    pub exit_code: Option<Option<i64>>,
    pub error: Option<Option<String>>,
    pub base_commit_sha: Option<Option<String>>,
    pub pty_active: Option<bool>,
    pub total_input_tokens: Option<Option<i64>>,
    pub total_output_tokens: Option<Option<i64>>,
    pub total_cache_read_tokens: Option<Option<i64>>,
    pub total_cache_write_tokens: Option<Option<i64>>,
    pub git_branch: Option<Option<String>>,
    pub stop_reason: Option<Option<String>>,
    /// Provider-specific data update. Deep-merged into existing provider_data
    /// (individual keys updated, not full replacement).
    pub provider_data: Option<Value>,
    /// Provider-specific transient live state update. Deep-merged.
    pub live_provider_data: Option<Value>,
}

/// Keys that are transient and should never trigger a DB save.
/// Field names must stay snake_case to match stringify!($field) output from the macros.
const TRANSIENT_KEYS: &[&str] = &["pty_active", "live_provider_data"];

pub(crate) struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
    db: Arc<Database>,
    app_handle: AppHandle,
    views_dirty: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
}

impl SessionStore {
    pub(crate) fn new(db: Arc<Database>, app_handle: AppHandle) -> Self {
        let views_dirty = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));

        // Background task: check every 16ms if views are dirty, emit event if so.
        // Exits when shutdown flag is set (on app exit).
        let dirty_flag = views_dirty.clone();
        let shutdown_flag = shutdown.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            while !shutdown_flag.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(16));
                if dirty_flag.swap(false, Ordering::Relaxed) {
                    if let Err(e) = handle.emit("engine:views-dirty", ()) {
                        eprintln!("[engine] Failed to emit views-dirty: {}", e);
                    }
                }
            }
        });

        Self {
            sessions: RwLock::new(HashMap::new()),
            db,
            app_handle,
            views_dirty,
            shutdown,
        }
    }

    /// Emit a Tauri event, logging any failure.
    fn emit<S: serde::Serialize + Clone>(&self, event: &str, payload: &S) {
        if let Err(e) = self.app_handle.emit(event, payload) {
            eprintln!("[engine] Failed to emit {}: {}", event, e);
        }
    }

    /// Signal the background thread to stop. Called on app exit.
    pub(crate) fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }

    /// Mark views as needing recomputation. Debounced to 16ms.
    fn mark_views_dirty(&self) {
        self.views_dirty.store(true, Ordering::Relaxed);
    }

    /// Load all sessions from SQLite into memory.
    pub(crate) fn load_from_db(&self) -> Result<(), String> {
        let rows = self.db.load_all_sessions().map_err(|e| e.to_string())?;
        let mut sessions = self.sessions.write();
        sessions.clear();
        for row in rows {
            let session = session_from_row(row);
            sessions.insert(session.id.clone(), session);
        }
        Ok(())
    }

    /// Startup recovery. AgTower never re-adopts a PTY across a restart — the
    /// PtyManager starts empty and orphaned `agtower-*` tmux sessions are cleaned
    /// up — so any session still marked active in the DB necessarily has a dead
    /// PTY. Flip them all to Closed. We deliberately do NOT consult the stored
    /// PID: after a reboot the OS can reuse it for an unrelated live process,
    /// which previously left a session looking active but un-attachable.
    pub(crate) fn recover_sessions(&self) {
        let now = epoch_ms();

        let to_recover: Vec<(String, Option<i64>)> = {
            let sessions = self.sessions.read();
            sessions
                .values()
                .filter(|s| s.status.is_active())
                .map(|s| (s.id.clone(), s.ended_at))
                .collect()
        };

        for (id, ended_at) in to_recover {
            if let Err(e) = self.update(
                &id,
                SessionUpdate {
                    status: Some(SessionStatus::Closed),
                    ended_at: Some(Some(ended_at.unwrap_or(now))),
                    pty_active: Some(false),
                    ..Default::default()
                },
            ) {
                eprintln!("[engine] Failed to recover session {}: {}", id, e);
            }
        }
    }

    /// Deduplicate sessions by provider_data.sessionId.
    /// On duplicate, keep the older one (lower created_at).
    fn dedup_sessions(&self) {
        // Identify duplicates under a read lock before mutating memory or disk.
        let to_remove = {
            let sessions = self.sessions.read();
            duplicate_session_ids(&sessions)
        }; // read lock released

        if to_remove.is_empty() {
            return;
        }

        // Remove duplicates from memory first under a brief write lock.
        {
            let mut sessions = self.sessions.write();
            for id in &to_remove {
                sessions.remove(id);
            }
        } // write lock released

        // Delete from DB and emit removal events.
        for id in &to_remove {
            let _ = self.db.delete_session(id);
            self.emit("session:removed", &serde_json::json!({ "id": id }));
        }
        self.mark_views_dirty();
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    pub(crate) fn get_all(&self) -> HashMap<String, Session> {
        self.sessions.read().clone()
    }

    /// Stamp `titleSetAt = now_ms` on every session that has a user-meaningful
    /// (non-auto) title but no stamp yet, treating it as user-owned as of now,
    /// so a stale `custom-title` in a provider log can't revert such a title on
    /// the next re-extraction. Already-stamped and auto-titled sessions are left
    /// untouched. The caller guards this to run exactly once, so freshly
    /// imported sessions (whose `/rename` must still win) are never re-stamped.
    /// Returns the count stamped.
    pub(crate) fn backfill_title_set_at(&self, now_ms: i64) -> usize {
        // Collect targets under a read lock, then update() each without holding
        // it (update() takes the write lock itself).
        let targets: Vec<String> = {
            let sessions = self.sessions.read();
            sessions
                .values()
                .filter(|s| needs_title_set_at_backfill(&s.title, &s.provider_data))
                .map(|s| s.id.clone())
                .collect()
        };
        let mut stamped = 0;
        for id in &targets {
            let update = SessionUpdate {
                provider_data: Some(serde_json::json!({ "titleSetAt": now_ms })),
                ..Default::default()
            };
            if self.update(id, update).is_ok() {
                stamped += 1;
            }
        }
        stamped
    }

    pub(crate) fn get(&self, id: &str) -> Option<Session> {
        self.sessions.read().get(id).cloned()
    }

    pub(crate) fn add(&self, session: Session) -> Result<(), String> {
        // Atomic dedup + insert under a single write lock.
        // Prevents the TOCTOU race where two threads both pass the dedup check
        // and insert duplicate sessions with the same provider_data.sessionId.
        let mut sessions = self.sessions.write();

        if let Some(psid) = session.pd_session_id() {
            let dup = sessions
                .values()
                .any(|s| s.pd_session_id() == Some(psid) && s.id != session.id);
            if dup {
                return Ok(()); // Silently skip — not an error, just a race
            }
        }

        self.db
            .save_session(&session_to_row(&session))
            .map_err(|e| e.to_string())?;

        sessions.insert(session.id.clone(), session.clone());
        drop(sessions); // Release before emitting events
        self.emit("session:added", &session);
        self.mark_views_dirty();
        Ok(())
    }

    pub(crate) fn update(&self, id: &str, updates: SessionUpdate) -> Result<(), String> {
        let provider_session_id_touched = updates
            .provider_data
            .as_ref()
            .and_then(|v| v.get("sessionId"))
            .and_then(|v| v.as_str())
            .is_some();

        let mut sessions = self.sessions.write();
        let session = sessions.get_mut(id).ok_or("Session not found")?;

        let old_status = session.status;

        // Snapshot for rollback: apply_updates mutates in place, but the DB write
        // can fail (locked DB, disk full). Without rollback, memory would hold the
        // new value while SQLite keeps the old one and the frontend never hears
        // about it — a three-way divergence that silently reverts on restart.
        let rollback = session.clone();
        let has_persistent = apply_updates(session, &updates);

        if has_persistent {
            if let Err(e) = self.db.save_session(&session_to_row(session)) {
                *session = rollback;
                return Err(e.to_string());
            }
        }

        let updated = session.clone();
        let new_status = session.status;
        drop(sessions);

        self.emit("session:updated", &updated);

        if provider_session_id_touched {
            self.dedup_sessions();
        }

        // Auto-update tray badge when attention state changes
        let was_attention = old_status == SessionStatus::NeedsAttention;
        let is_attention = new_status == SessionStatus::NeedsAttention;
        if was_attention != is_attention {
            self.update_tray_badge();
            // Emit notification event when a session newly needs attention
            if is_attention && !was_attention {
                self.emit("notification:attention", &updated);
            }
        }

        // Auto-extract provider metadata. Two triggers, two scopes:
        //
        //  - TERMINAL (running/idle/needsAttention -> closed/archived): the
        //    full pack — tokens, turns, model, provider_data, and title. Token
        //    aggregation is only meaningful once the session is done.
        //
        //  - STOP (running -> idle/needsAttention): a LIGHT, title-only pass so
        //    that a CLI `/rename` lands in the sidebar LIVE, without waiting for
        //    the session to terminate. We deliberately skip token aggregation
        //    here so the broadened trigger can't regress live token/model state,
        //    and to keep the per-turn cost down (this fires on every Stop hook).
        //    Gated to Claude Code: it is the only provider that records a
        //    `/rename` on disk (`custom-title`), so re-extracting Codex on every
        //    turn boundary would parse its rollout for a title that can't change.
        //
        // Both reuse the same background extraction thread (a pure read), so
        // neither blocks the status update. The Stop trigger is gated on an
        // actual status change (running -> non-running-active) so a repeated
        // same-status update is a no-op.
        let was_running = old_status.is_active();
        let is_done = new_status.is_terminal();
        let terminal_extract = was_running && is_done;
        let stop_extract = old_status == SessionStatus::Running
            && matches!(
                new_status,
                SessionStatus::Idle | SessionStatus::NeedsAttention
            )
            && updated.provider == "claude-code";
        if terminal_extract || stop_extract {
            let session_id = updated.id.clone();
            let provider_id = updated.provider.clone();
            let repo_path = updated.repo_path.clone();
            let provider_data = updated.provider_data.clone();
            let created_at = updated.created_at;
            let app = self.app_handle.clone();
            // On the Stop (non-terminal) trigger, restrict to title + slug +
            // provider identity; leave token aggregation to the terminal path.
            let title_only = stop_extract && !terminal_extract;
            std::thread::spawn(move || {
                let Some(engine) = app.try_state::<Arc<crate::engine::Engine>>() else {
                    return;
                };
                let Some(provider) = engine.provider_registry.get(&provider_id) else {
                    return;
                };
                let Ok(metadata) = provider.discovery().extract_metadata(
                    &repo_path,
                    &provider_data,
                    Some(created_at),
                ) else {
                    return;
                };

                let mut updates = SessionUpdate::default();
                if !title_only {
                    if metadata.model.is_some() {
                        updates.model = Some(metadata.model);
                    }
                    if metadata.num_turns > 0 {
                        updates.num_turns = Some(Some(metadata.num_turns as i64));
                    }
                    if metadata.total_input_tokens > 0 {
                        updates.total_input_tokens = Some(Some(metadata.total_input_tokens as i64));
                    }
                    if metadata.total_output_tokens > 0 {
                        updates.total_output_tokens =
                            Some(Some(metadata.total_output_tokens as i64));
                    }
                    if metadata.total_cache_read_tokens > 0 {
                        updates.total_cache_read_tokens =
                            Some(Some(metadata.total_cache_read_tokens as i64));
                    }
                    if metadata.total_cache_write_tokens > 0 {
                        updates.total_cache_write_tokens =
                            Some(Some(metadata.total_cache_write_tokens as i64));
                    }
                }
                // Pack provider-specific metadata into provider_data
                let mut pd = serde_json::Map::new();
                if let Some(ref psid) = metadata.provider_session_id {
                    pd.insert("sessionId".into(), Value::String(psid.clone()));
                }
                if let Some(ref fp) = metadata.provider_file_path {
                    pd.insert("filePath".into(), Value::String(fp.clone()));
                }
                if let Some(ref slug) = metadata.slug {
                    pd.insert("slug".into(), Value::String(slug.clone()));
                }
                // Title precedence: an explicit CLI /rename overrides an auto
                // title (and a sidebar title only if it's newer); a slug only
                // overrides an auto title. See select_extracted_title.
                if let Some(session) = engine.sessions.get(&session_id) {
                    let user_title_set_at = session
                        .provider_data
                        .get("titleSetAt")
                        .and_then(|v| v.as_i64());
                    if let Some(new_title) = select_extracted_title(
                        &session.title,
                        metadata.custom_title.as_deref(),
                        metadata.custom_title_at,
                        metadata.slug.as_deref(),
                        user_title_set_at,
                    ) {
                        updates.title = Some(new_title);
                    }
                }
                if !pd.is_empty() {
                    updates.provider_data = Some(Value::Object(pd));
                }
                let _ = engine.sessions.update(&session_id, updates);
            });
        }

        // Auto-prune sessions whose backing CLI file is gone. Claude/Codex
        // delete their JSONL/rollout when the user exits without sending a
        // prompt; pruning here keeps the sidebar in sync without the user
        // having to click the dead row to discover it.
        if was_running && new_status == SessionStatus::Closed {
            let session_id = updated.id.clone();
            let app = self.app_handle.clone();
            std::thread::spawn(move || {
                // Wait for the CLI's own exit cleanup to settle. Without this
                // we race the agent's exit handler and may read a JSONL
                // that's about to be deleted, or miss a rolloutPath that's
                // about to be assigned.
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let Some(engine) = app.try_state::<Arc<crate::engine::Engine>>() else {
                    return;
                };
                // Re-fetch — the parallel metadata extraction thread may
                // have just enriched provider_data, and the user may have
                // re-opened the session during the delay window.
                let Some(session) = engine.sessions.get(&session_id) else {
                    return;
                };
                if session.status != SessionStatus::Closed {
                    return;
                }
                let Some(provider) = engine.provider_registry.get(&session.provider) else {
                    return;
                };
                // Empty signal varies by provider:
                //  - Claude deletes the JSONL on empty exit → file_exists is false
                //  - Codex never assigns a rolloutPath when no rollout was
                //    written, or the rollout file is missing from disk
                let is_orphaned = match session.provider.as_str() {
                    "claude-code" => !provider
                        .discovery()
                        .session_file_exists(&session.repo_path, &session.provider_data),
                    "codex" => session
                        .provider_data
                        .get("rolloutPath")
                        .and_then(|v| v.as_str())
                        .is_none_or(|path| !std::path::Path::new(path).is_file()),
                    _ => false,
                };
                if is_orphaned {
                    let _ = engine.sessions.remove(&session_id);
                }
            });
        }

        self.mark_views_dirty();
        Ok(())
    }

    pub(crate) fn remove(&self, id: &str) -> Result<(), String> {
        self.db.delete_session(id).map_err(|e| e.to_string())?;
        self.sessions.write().remove(id);
        self.emit("session:removed", &serde_json::json!({ "id": id }));
        self.mark_views_dirty();
        Ok(())
    }

    pub(crate) fn clear_all(&self) -> Result<(), String> {
        if self.sessions.read().is_empty() {
            return Ok(());
        }

        self.db.delete_all_sessions().map_err(|e| e.to_string())?;
        self.sessions.write().clear();
        self.emit("sessions:cleared", &serde_json::json!({}));
        self.mark_views_dirty();
        Ok(())
    }

    pub(crate) fn archive_session(&self, id: &str) -> Result<(), String> {
        self.update(
            id,
            SessionUpdate {
                status: Some(SessionStatus::Archived),
                ended_at: Some(Some(epoch_ms())),
                ..Default::default()
            },
        )
    }

    /// Auto-archive stale closed sessions that haven't been interacted with
    /// for more than `archive_after_days` days.
    pub(crate) fn auto_archive_stale(&self, archive_after_days: u32) {
        let now = epoch_ms();
        let threshold = now - (archive_after_days as i64) * 86_400_000;

        let ids: Vec<String> = {
            let sessions = self.sessions.read();
            sessions
                .values()
                .filter(|s| {
                    s.status == SessionStatus::Closed
                        && s.ended_at.or(Some(s.created_at)).unwrap_or(s.created_at) < threshold
                })
                .map(|s| s.id.clone())
                .collect()
        };

        for id in ids {
            if let Err(e) = self.update(
                &id,
                SessionUpdate {
                    status: Some(SessionStatus::Archived),
                    ..Default::default()
                },
            ) {
                eprintln!("[engine] Failed to auto-archive session {}: {}", id, e);
            }
        }
    }

    /// Auto-update the tray badge with the current attention count.
    fn update_tray_badge(&self) {
        let count = self.attention_count();
        if let Some(tray) = self.app_handle.tray_by_id("main") {
            #[cfg(target_os = "macos")]
            {
                let title: Option<String> = if count == 0 {
                    None
                } else {
                    Some(format!("{}", count))
                };
                let _ = tray.set_title(title);
            }
            let tooltip = if count == 0 {
                Some("AgTower — all clear".to_string())
            } else {
                Some(format!(
                    "AgTower — {} need{} attention",
                    count,
                    if count == 1 { "s" } else { "" }
                ))
            };
            let _ = tray.set_tooltip(tooltip);
        }
    }

    fn attention_count(&self) -> usize {
        self.sessions
            .read()
            .values()
            .filter(|s| s.status == SessionStatus::NeedsAttention)
            .count()
    }
}

use super::epoch_ms;

fn session_from_row(row: SessionRow) -> Session {
    let provider_data: Value =
        serde_json::from_str(&row.provider_data).unwrap_or_else(|_| serde_json::json!({}));

    Session {
        id: row.id,
        repo_id: row.repo_id,
        repo_path: row.repo_path,
        repo_name: row.repo_name,
        prompt: row.prompt,
        title: row.title,
        status: SessionStatus::from_str(&row.status),
        pid: row.pid,
        model: row.model,
        created_at: row.created_at,
        ended_at: row.ended_at,
        result: row.result,
        duration_ms: row.duration_ms,
        num_turns: row.num_turns,
        exit_code: row.exit_code,
        error: row.error,
        base_commit_sha: row.base_commit_sha,
        pty_active: false,
        total_input_tokens: row.total_input_tokens,
        total_output_tokens: row.total_output_tokens,
        total_cache_read_tokens: row.total_cache_read_tokens,
        total_cache_write_tokens: row.total_cache_write_tokens,
        git_branch: row.git_branch,
        stop_reason: row.stop_reason,
        provider: row.provider,
        provider_data,
        // Transient defaults
        live_provider_data: serde_json::json!({}),
    }
}

fn session_to_row(session: &Session) -> SessionRow {
    SessionRow {
        id: session.id.clone(),
        repo_id: session.repo_id.clone(),
        repo_path: session.repo_path.clone(),
        repo_name: session.repo_name.clone(),
        prompt: session.prompt.clone(),
        title: session.title.clone(),
        status: session.status.as_str().to_string(),
        pid: session.pid,
        model: session.model.clone(),
        created_at: session.created_at,
        ended_at: session.ended_at,
        result: session.result.clone(),
        duration_ms: session.duration_ms,
        num_turns: session.num_turns,
        exit_code: session.exit_code,
        error: session.error.clone(),
        base_commit_sha: session.base_commit_sha.clone(),
        total_input_tokens: session.total_input_tokens,
        total_output_tokens: session.total_output_tokens,
        total_cache_read_tokens: session.total_cache_read_tokens,
        total_cache_write_tokens: session.total_cache_write_tokens,
        git_branch: session.git_branch.clone(),
        stop_reason: session.stop_reason.clone(),
        provider: session.provider.clone(),
        provider_data: serde_json::to_string(&session.provider_data)
            .unwrap_or_else(|_| "{}".into()),
    }
}

/// Pure selection of which session ids to remove as duplicates: among sessions
/// sharing a provider_session_id, keep the oldest by created_at and return the
/// rest. Extracted from `dedup_sessions` so this data-destroying selection is
/// unit-testable without an Engine/DB/AppHandle.
fn duplicate_session_ids(sessions: &HashMap<String, Session>) -> Vec<String> {
    let mut sorted: Vec<&Session> = sessions.values().collect();
    sorted.sort_by_key(|s| s.created_at);

    let mut seen: HashMap<String, String> = HashMap::new();
    let mut remove = Vec::new();
    for session in &sorted {
        if let Some(psid) = session.pd_session_id() {
            let psid = psid.to_string();
            if let std::collections::hash_map::Entry::Vacant(entry) = seen.entry(psid) {
                entry.insert(session.id.clone());
            } else {
                // Keep the older one (sorted by created_at), remove the newer duplicate.
                remove.push(session.id.clone());
            }
        }
    }
    remove
}

/// Apply partial updates to a session. Returns true if any persistent field changed.
fn apply_updates(session: &mut Session, updates: &SessionUpdate) -> bool {
    let mut has_persistent = false;

    /// Apply a single field if the update provides it. Tracks whether the
    /// field is persistent (should trigger a DB write).
    macro_rules! apply {
        ($field:ident) => {
            if let Some(ref val) = updates.$field {
                session.$field = val.clone();
                if !TRANSIENT_KEYS.contains(&stringify!($field)) {
                    has_persistent = true;
                }
            }
        };
    }

    apply!(title);
    apply!(repo_id);
    apply!(repo_path);
    apply!(repo_name);
    apply!(status);
    apply!(pid);
    apply!(model);
    apply!(ended_at);
    apply!(result);
    apply!(duration_ms);
    apply!(num_turns);
    apply!(exit_code);
    apply!(error);
    apply!(base_commit_sha);
    apply!(pty_active);
    apply!(total_input_tokens);
    apply!(total_output_tokens);
    apply!(total_cache_read_tokens);
    apply!(total_cache_write_tokens);
    apply!(git_branch);
    apply!(stop_reason);

    // Deep-merge provider_data: update individual keys, don't replace the whole blob
    if let Some(ref new_pd) = updates.provider_data {
        if let Some(incoming) = new_pd.as_object() {
            if let Some(existing) = session.provider_data.as_object_mut() {
                for (k, v) in incoming {
                    existing.insert(k.clone(), v.clone());
                }
            } else {
                session.provider_data = new_pd.clone();
            }
        } else {
            session.provider_data = new_pd.clone();
        }
        has_persistent = true;
    }

    // Deep-merge live_provider_data (transient, same pattern as provider_data)
    if let Some(ref new_lpd) = updates.live_provider_data {
        if let Some(incoming) = new_lpd.as_object() {
            if let Some(existing) = session.live_provider_data.as_object_mut() {
                for (k, v) in incoming {
                    existing.insert(k.clone(), v.clone());
                }
            } else {
                session.live_provider_data = new_lpd.clone();
            }
        } else {
            session.live_provider_data = new_lpd.clone();
        }
        // live_provider_data is transient — don't set has_persistent
    }

    has_persistent
}
