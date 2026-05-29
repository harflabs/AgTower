//! In-memory repository store backed by SQLite.
//!
//! Repos hold workspace metadata (path, name, color, sort order).
//! Mutations persist immediately and broadcast via Tauri events.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::database::{Database, RepoRow};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Repository {
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct RepoUpdate {
    pub name: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
    pub sort_order: Option<Option<i64>>,
    pub last_opened_at: Option<i64>,
    pub is_git: Option<bool>,
}

// ---------------------------------------------------------------------------
// Repo Store
// ---------------------------------------------------------------------------

pub(crate) struct RepoStore {
    repos: RwLock<HashMap<String, Repository>>,
    db: Arc<Database>,
    app_handle: AppHandle,
}

impl RepoStore {
    pub(crate) fn new(db: Arc<Database>, app_handle: AppHandle) -> Self {
        Self {
            repos: RwLock::new(HashMap::new()),
            db,
            app_handle,
        }
    }

    pub(crate) fn load_from_db(&self) -> Result<(), String> {
        let rows = self.db.load_all_repos().map_err(|e| e.to_string())?;
        let mut repos = self.repos.write();
        repos.clear();
        for row in rows {
            let repo = repo_from_row(row);
            repos.insert(repo.id.clone(), repo);
        }
        Ok(())
    }

    pub(crate) fn get_all(&self) -> HashMap<String, Repository> {
        self.repos.read().clone()
    }

    pub(crate) fn add(&self, repo: Repository) -> Result<(), String> {
        self.db
            .save_repo(&repo_to_row(&repo))
            .map_err(|e| e.to_string())?;

        let id = repo.id.clone();
        self.repos.write().insert(id, repo.clone());
        let _ = self.app_handle.emit("repo:added", &repo);
        Ok(())
    }

    pub(crate) fn update(&self, id: &str, updates: RepoUpdate) -> Result<(), String> {
        let mut repos = self.repos.write();
        let repo = repos.get_mut(id).ok_or("Repo not found")?;

        if let Some(ref name) = updates.name {
            repo.name = name.clone();
        }
        if let Some(ref color) = updates.color {
            repo.color = color.clone();
        }
        if let Some(pinned) = updates.pinned {
            repo.pinned = pinned;
        }
        if let Some(ref sort_order) = updates.sort_order {
            repo.sort_order = *sort_order;
        }
        if let Some(last_opened_at) = updates.last_opened_at {
            repo.last_opened_at = last_opened_at;
        }
        if let Some(is_git) = updates.is_git {
            repo.is_git = is_git;
        }

        self.db
            .save_repo(&repo_to_row(repo))
            .map_err(|e| e.to_string())?;

        let updated = repo.clone();
        drop(repos);

        let _ = self.app_handle.emit("repo:updated", &updated);
        Ok(())
    }

    pub(crate) fn remove(&self, id: &str) -> Result<(), String> {
        self.db.delete_repo(id).map_err(|e| e.to_string())?;
        self.repos.write().remove(id);
        let _ = self
            .app_handle
            .emit("repo:removed", &serde_json::json!({ "id": id }));
        Ok(())
    }

    pub(crate) fn reorder(&self, ids: &[String]) -> Result<(), String> {
        let mut repos = self.repos.write();
        let mut updated = Vec::new();

        for (index, id) in ids.iter().enumerate() {
            let repo = repos.get_mut(id).ok_or("Repo not found")?;
            repo.sort_order = Some(index as i64);
            self.db
                .save_repo(&repo_to_row(repo))
                .map_err(|e| e.to_string())?;
            updated.push(repo.clone());
        }

        drop(repos);

        for repo in updated {
            let _ = self.app_handle.emit("repo:updated", &repo);
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn repo_from_row(row: RepoRow) -> Repository {
    Repository {
        id: row.id,
        name: row.name,
        path: row.path,
        is_git: row.is_git,
        color: row.color,
        pinned: row.pinned,
        sort_order: row.sort_order,
        added_at: row.added_at,
        last_opened_at: row.last_opened_at,
    }
}

fn repo_to_row(repo: &Repository) -> RepoRow {
    RepoRow {
        id: repo.id.clone(),
        name: repo.name.clone(),
        path: repo.path.clone(),
        is_git: repo.is_git,
        color: repo.color.clone(),
        pinned: repo.pinned,
        sort_order: repo.sort_order,
        added_at: repo.added_at,
        last_opened_at: repo.last_opened_at,
    }
}
