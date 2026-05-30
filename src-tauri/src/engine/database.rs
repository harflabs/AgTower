//! SQLite database layer for the engine.
//!
//! Provides direct `rusqlite` access with WAL mode and CRUD operations
//! for sessions, repos, settings, and workspace state. The schema is
//! bootstrapped from a single `001_init.sql` file via `CREATE TABLE
//! IF NOT EXISTS`.

use parking_lot::Mutex;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Wraps a SQLite connection behind a mutex for thread-safe access.
pub(crate) struct Database {
    conn: Mutex<Connection>,
}

/// Move a corrupt DB file and its WAL/SHM sidecars aside (suffixed with a
/// timestamp) so a fresh database can be created. Best-effort: failures are
/// logged, not propagated.
fn quarantine_db_files(db_path: &Path) {
    let stamp = super::epoch_ms();
    for suffix in ["", "-wal", "-shm"] {
        let mut from_os = db_path.as_os_str().to_os_string();
        from_os.push(suffix);
        let from = std::path::PathBuf::from(from_os);
        if !from.exists() {
            continue;
        }
        let mut to_os = from.as_os_str().to_os_string();
        to_os.push(format!(".corrupt-{stamp}"));
        match std::fs::rename(&from, std::path::PathBuf::from(to_os)) {
            Ok(()) => eprintln!("[engine] Quarantined {}", from.display()),
            Err(e) => eprintln!("[engine] Failed to quarantine {}: {e}", from.display()),
        }
    }
}

impl Database {
    /// Open (or create) the database at `app_data_dir/agtower.db` and ensure
    /// the schema exists.
    ///
    /// If the existing file fails to open or initialize — almost always on-disk
    /// corruption (interrupted write, disk full mid-WAL-checkpoint, bad sectors)
    /// — we move it (and its WAL/SHM sidecars) aside and recreate a fresh DB
    /// rather than abort launch with no window. Session history is recoverable
    /// via provider discovery; a dead app is not.
    pub(crate) fn open(app_data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;

        let db_path = app_data_dir.join("agtower.db");

        match Self::open_at(&db_path) {
            Ok(db) => Ok(db),
            Err(first_err) => {
                eprintln!(
                    "[engine] Database at {} failed to open ({first_err}); quarantining it and recreating.",
                    db_path.display()
                );
                quarantine_db_files(&db_path);
                Self::open_at(&db_path).map_err(|second_err| {
                    format!(
                        "Failed to open database even after quarantining a corrupt file: {second_err}"
                    )
                })
            }
        }
    }

    /// Open the connection at `db_path`, apply pragmas, and run the schema.
    fn open_at(db_path: &Path) -> Result<Self, String> {
        let conn =
            Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-8000;",
        )
        .map_err(|e| format!("Failed to set pragmas: {e}"))?;

        conn.execute_batch(include_str!("../../migrations/001_init.sql"))
            .map_err(|e| format!("Schema init failed: {e}"))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // -- Sessions ---------------------------------------------------------------

    pub(crate) fn save_session(&self, s: &SessionRow) -> SqlResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO sessions
             (id, repo_id, repo_path, repo_name, prompt, title, status, pid,
              model, created_at, ended_at, result,
              duration_ms, num_turns, exit_code, error, base_commit_sha,
              total_input_tokens, total_output_tokens,
              total_cache_read_tokens, total_cache_write_tokens, git_branch, stop_reason,
              provider, provider_data)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,
                     ?18,?19,?20,?21,?22,?23,?24,?25)",
            params![
                s.id,
                s.repo_id,
                s.repo_path,
                s.repo_name,
                s.prompt,
                s.title,
                s.status,
                s.pid,
                s.model,
                s.created_at,
                s.ended_at,
                s.result,
                s.duration_ms,
                s.num_turns,
                s.exit_code,
                s.error,
                s.base_commit_sha,
                s.total_input_tokens,
                s.total_output_tokens,
                s.total_cache_read_tokens,
                s.total_cache_write_tokens,
                s.git_branch,
                s.stop_reason,
                s.provider,
                s.provider_data,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn load_all_sessions(&self) -> SqlResult<Vec<SessionRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, repo_id, repo_path, repo_name, prompt, title, status, pid,
                    model, created_at, ended_at, result,
                    duration_ms, num_turns, exit_code, error, base_commit_sha,
                    total_input_tokens, total_output_tokens,
                    total_cache_read_tokens, total_cache_write_tokens, git_branch, stop_reason,
                    provider, provider_data
             FROM sessions ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                repo_id: r.get(1)?,
                repo_path: r.get(2)?,
                repo_name: r.get(3)?,
                prompt: r.get(4)?,
                title: r.get(5)?,
                status: r.get(6)?,
                pid: r.get(7)?,
                model: r.get(8)?,
                created_at: r.get(9)?,
                ended_at: r.get(10)?,
                result: r.get(11)?,
                duration_ms: r.get(12)?,
                num_turns: r.get(13)?,
                exit_code: r.get(14)?,
                error: r.get(15)?,
                base_commit_sha: r.get(16)?,
                total_input_tokens: r.get(17)?,
                total_output_tokens: r.get(18)?,
                total_cache_read_tokens: r.get(19)?,
                total_cache_write_tokens: r.get(20)?,
                git_branch: r.get(21)?,
                stop_reason: r.get(22)?,
                provider: r.get(23)?,
                provider_data: r.get::<_, String>(24).unwrap_or_else(|_| "{}".to_string()),
            })
        })?;
        rows.collect()
    }

    pub(crate) fn delete_session(&self, id: &str) -> SqlResult<()> {
        self.conn
            .lock()
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub(crate) fn delete_all_sessions(&self) -> SqlResult<()> {
        self.conn.lock().execute("DELETE FROM sessions", [])?;
        Ok(())
    }

    // -- Repos ------------------------------------------------------------------

    pub(crate) fn save_repo(&self, r: &RepoRow) -> SqlResult<()> {
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO repos
             (id, name, path, is_git, color, pinned, sort_order, added_at, last_opened_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                r.id,
                r.name,
                r.path,
                r.is_git as i32,
                r.color,
                r.pinned as i32,
                r.sort_order,
                r.added_at,
                r.last_opened_at,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn load_all_repos(&self) -> SqlResult<Vec<RepoRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, is_git, color, pinned, sort_order, added_at, last_opened_at
             FROM repos ORDER BY last_opened_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(RepoRow {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                is_git: r.get::<_, i32>(3)? != 0,
                color: r.get(4)?,
                pinned: r.get::<_, i32>(5)? != 0,
                sort_order: r.get(6)?,
                added_at: r.get(7)?,
                last_opened_at: r.get(8)?,
            })
        })?;
        rows.collect()
    }

    pub(crate) fn delete_repo(&self, id: &str) -> SqlResult<()> {
        self.conn
            .lock()
            .execute("DELETE FROM repos WHERE id = ?1", params![id])?;
        Ok(())
    }

    // -- Settings ---------------------------------------------------------------

    pub(crate) fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub(crate) fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        self.conn
            .lock()
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
    }

    pub(crate) fn load_all_settings(&self) -> SqlResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    pub(crate) fn clear_settings(&self) -> SqlResult<()> {
        self.conn.lock().execute("DELETE FROM settings", [])?;
        Ok(())
    }

    pub(crate) fn has_existing_user_data(&self) -> SqlResult<bool> {
        let conn = self.conn.lock();
        for sql in [
            "SELECT EXISTS(SELECT 1 FROM sessions LIMIT 1)",
            "SELECT EXISTS(SELECT 1 FROM repos LIMIT 1)",
            "SELECT EXISTS(SELECT 1 FROM settings LIMIT 1)",
            "SELECT EXISTS(SELECT 1 FROM workspace_state LIMIT 1)",
        ] {
            let exists: i64 = conn.query_row(sql, [], |row| row.get(0))?;
            if exists != 0 {
                return Ok(true);
            }
        }

        Ok(false)
    }

    // -- Workspace state --------------------------------------------------------

    pub(crate) fn save_workspace_state(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO workspace_state (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub(crate) fn load_workspace_state(&self, key: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT value FROM workspace_state WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
    }

    pub(crate) fn clear_workspace_state(&self) -> SqlResult<()> {
        self.conn
            .lock()
            .execute("DELETE FROM workspace_state", [])?;
        Ok(())
    }
}

// -- Row types ----------------------------------------------------------------

/// Mirrors the `sessions` table schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRow {
    pub id: String,
    pub repo_id: String,
    pub repo_path: String,
    pub repo_name: String,
    pub prompt: String,
    pub title: String,
    pub status: String,
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
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
    pub total_cache_read_tokens: Option<i64>,
    pub total_cache_write_tokens: Option<i64>,
    pub git_branch: Option<String>,
    pub stop_reason: Option<String>,
    pub provider: String,
    /// JSON blob for provider-specific data (e.g. sessionId, filePath, slug)
    pub provider_data: String,
}

/// Mirrors the `repos` table schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git: bool,
    pub color: String,
    pub pinned: bool,
    pub sort_order: Option<i64>,
    pub added_at: i64,
    pub last_opened_at: i64,
}

/// Convenience extension — rusqlite's `optional()` for query_row.
trait OptionalExt<T> {
    fn optional(self) -> SqlResult<Option<T>>;
}

impl<T> OptionalExt<T> for SqlResult<T> {
    fn optional(self) -> SqlResult<Option<T>> {
        match self {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::ops::Deref;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEST_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDatabase {
        db: Option<Database>,
        dir: PathBuf,
    }

    impl Deref for TestDatabase {
        type Target = Database;

        fn deref(&self) -> &Self::Target {
            self.db.as_ref().expect("test db should still be open")
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            self.db.take();
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn test_db_dir() -> PathBuf {
        let unique = TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "agtower-db-tests-{}-{}",
            std::process::id(),
            unique
        ))
    }

    fn open_test_db() -> TestDatabase {
        let dir = test_db_dir();
        let db = Database::open(&dir).expect("test db should open");
        TestDatabase { db: Some(db), dir }
    }

    fn session_row(id: &str, created_at: i64) -> SessionRow {
        SessionRow {
            id: id.to_string(),
            repo_id: "repo-1".to_string(),
            repo_path: "/tmp/repo-1".to_string(),
            repo_name: "Repo One".to_string(),
            prompt: format!("Prompt {id}"),
            title: format!("Title {id}"),
            status: "running".to_string(),
            pid: Some(42),
            model: Some("sonnet".to_string()),
            created_at,
            ended_at: Some(created_at + 10),
            result: Some("ok".to_string()),
            duration_ms: Some(123),
            num_turns: Some(4),
            exit_code: Some(0),
            error: None,
            base_commit_sha: Some("abc123".to_string()),
            total_input_tokens: Some(10),
            total_output_tokens: Some(20),
            total_cache_read_tokens: Some(5),
            total_cache_write_tokens: Some(6),
            git_branch: Some("main".to_string()),
            stop_reason: Some("end_turn".to_string()),
            provider: "claude-code".to_string(),
            provider_data: "{\"sessionId\":\"abc\"}".to_string(),
        }
    }

    fn repo_row(id: &str, last_opened_at: i64) -> RepoRow {
        RepoRow {
            id: id.to_string(),
            name: format!("Repo {id}"),
            path: format!("/tmp/{id}"),
            is_git: true,
            color: "#123456".to_string(),
            pinned: false,
            sort_order: None,
            added_at: 1,
            last_opened_at,
        }
    }

    #[test]
    fn settings_and_workspace_state_round_trip() {
        let db = open_test_db();

        assert!(db.load_all_settings().unwrap().is_empty());
        db.set_setting("notificationsEnabled", "true").unwrap();
        db.set_setting("archiveAfterDays", "14").unwrap();

        let all_settings = db.load_all_settings().unwrap();
        assert_eq!(all_settings.len(), 2);
        assert_eq!(
            all_settings
                .iter()
                .find(|(k, _)| k == "notificationsEnabled")
                .map(|(_, v)| v.clone()),
            Some("true".to_string())
        );

        // Single-key getter (used by the one-time title backfill guard).
        assert_eq!(
            db.get_setting("notificationsEnabled").unwrap(),
            Some("true".to_string())
        );
        assert_eq!(db.get_setting("missingKey").unwrap(), None);

        db.save_workspace_state("activeSessionId", "session-1")
            .unwrap();
        assert_eq!(
            db.load_workspace_state("activeSessionId").unwrap(),
            Some("session-1".to_string())
        );

        db.clear_settings().unwrap();
        db.clear_workspace_state().unwrap();
        assert_eq!(db.load_all_settings().unwrap().len(), 0);
        assert_eq!(db.load_workspace_state("activeSessionId").unwrap(), None);
    }

    #[test]
    fn detects_existing_user_data_across_tables() {
        let db = open_test_db();
        assert!(!db.has_existing_user_data().unwrap());

        db.set_setting("notificationsEnabled", "true").unwrap();
        assert!(db.has_existing_user_data().unwrap());

        db.clear_settings().unwrap();
        assert!(!db.has_existing_user_data().unwrap());

        db.save_workspace_state("activeSessionId", "session-1")
            .unwrap();
        assert!(db.has_existing_user_data().unwrap());

        db.clear_workspace_state().unwrap();
        assert!(!db.has_existing_user_data().unwrap());

        db.save_repo(&repo_row("repo-1", 100)).unwrap();
        assert!(db.has_existing_user_data().unwrap());

        db.delete_repo("repo-1").unwrap();
        assert!(!db.has_existing_user_data().unwrap());

        db.save_session(&session_row("session-1", 100)).unwrap();
        assert!(db.has_existing_user_data().unwrap());
    }

    #[test]
    fn repo_crud_round_trips_and_respects_sort_ordering() {
        let db = open_test_db();

        let repo_old = repo_row("repo-old", 100);
        let repo_new = repo_row("repo-new", 200);

        db.save_repo(&repo_old).unwrap();
        db.save_repo(&repo_new).unwrap();

        let loaded = db.load_all_repos().unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "repo-new");
        assert_eq!(loaded[1].id, "repo-old");

        db.delete_repo("repo-new").unwrap();
        let remaining = db.load_all_repos().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "repo-old");
    }

    #[test]
    fn session_crud_and_batch_deletes_round_trip() {
        let db = open_test_db();

        let older = session_row("older", 100);
        let newer = session_row("newer", 200);

        db.save_session(&older).unwrap();
        db.save_session(&newer).unwrap();

        let loaded = db.load_all_sessions().unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "newer");
        assert_eq!(loaded[1].id, "older");

        db.delete_session("newer").unwrap();
        let remaining = db.load_all_sessions().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "older");

        db.delete_session("older").unwrap();
        assert!(db.load_all_sessions().unwrap().is_empty());

        db.save_session(&session_row("again", 300)).unwrap();
        db.delete_all_sessions().unwrap();
        assert!(db.load_all_sessions().unwrap().is_empty());
    }
}
