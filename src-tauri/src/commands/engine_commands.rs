use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::engine::repo_store::{RepoUpdate, Repository};
use crate::engine::session_store::{Session, SessionUpdate};
use crate::engine::Engine;

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn engine_startup(engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.startup()
}

#[tauri::command]
pub(crate) fn engine_has_existing_user_data(
    engine: State<'_, Arc<Engine>>,
) -> Result<bool, String> {
    engine
        .db
        .has_existing_user_data()
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn get_all_sessions(engine: State<'_, Arc<Engine>>) -> HashMap<String, Session> {
    engine.sessions.get_all()
}

#[tauri::command]
pub(crate) fn create_session(
    engine: State<'_, Arc<Engine>>,
    session: Session,
) -> Result<(), String> {
    engine.sessions.add(session)
}

#[tauri::command]
pub(crate) fn update_session(
    engine: State<'_, Arc<Engine>>,
    id: String,
    updates: SessionUpdate,
) -> Result<(), String> {
    engine.sessions.update(&id, updates)
}

#[tauri::command]
pub(crate) fn remove_session(engine: State<'_, Arc<Engine>>, id: String) -> Result<(), String> {
    engine.sessions.remove(&id)
}

/// Return true if the provider's backing file for this session still exists on
/// disk. Returns true when there is no provider identifier to check, so freshly
/// created sessions aren't flagged as missing. Used by the frontend to
/// pre-flight a resume and prune orphaned sidebar rows when the underlying
/// conversation has been deleted.
#[tauri::command]
pub(crate) fn check_session_resumable(
    engine: State<'_, Arc<Engine>>,
    id: String,
) -> Result<bool, String> {
    let session = engine.sessions.get(&id).ok_or("Session not found")?;
    let provider = engine
        .provider_registry
        .get(&session.provider)
        .ok_or_else(|| format!("Unknown provider: {}", session.provider))?;
    Ok(provider
        .discovery()
        .session_file_exists(&session.repo_path, &session.provider_data))
}

/// Convert a display title to a hyphenated slug stored in `provider_data.slug`.
/// "My Session Name" → "my-session-name"
fn title_to_slug(title: &str) -> String {
    title
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

#[tauri::command]
pub(crate) fn rename_session(
    engine: State<'_, Arc<Engine>>,
    id: String,
    title: String,
) -> Result<(), String> {
    // DB-only rename (Direction 2 of issue #9). We deliberately do NOT try to
    // propagate the new title into an already-running provider session:
    //   - The PTY is a shared interactive TUI, not a command bus. Injecting
    //     `/rename <title>` would land in whatever input context is focused
    //     (a prompt, a y/n approval, text the user is composing) and there is
    //     no ACK/round-trip to confirm it took or to roll back on error.
    //   - `/rename` is Claude-specific; Codex has no equivalent command or flag.
    // So the title reconciles into the actual CLI session only on the NEXT
    // launch/resume, via `--name <title>` for Claude
    // (see providers/claude-code/launcher.ts). Codex never forwards the title.
    //
    // Stamp `titleSetAt` so the live re-extraction can tell which rename is
    // newer: a CLI `/rename` left in the JSONL must not revert a sidebar rename
    // the user made afterwards (see engine::session_store::select_extracted_title).
    let slug = title_to_slug(&title);
    let title_set_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    engine.sessions.update(
        &id,
        SessionUpdate {
            title: Some(title.clone()),
            provider_data: Some(serde_json::json!({"slug": slug, "titleSetAt": title_set_at})),
            ..Default::default()
        },
    )?;

    Ok(())
}

#[tauri::command]
pub(crate) fn archive_session(engine: State<'_, Arc<Engine>>, id: String) -> Result<(), String> {
    engine.sessions.archive_session(&id)
}

#[tauri::command]
pub(crate) fn clear_session_cache(
    engine: State<'_, Arc<Engine>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    app_state.pty.cleanup_all();
    engine.sessions.clear_all()?;
    engine.clear_workspace_state()?;
    Ok(())
}

#[tauri::command]
pub(crate) fn reset_everything(
    engine: State<'_, Arc<Engine>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    clear_session_cache(engine.clone(), app_state)?;

    let repo_ids: Vec<String> = engine.repos.get_all().into_keys().collect();
    for id in repo_ids {
        engine.repos.remove(&id)?;
    }

    engine.clear_settings()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Repo commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn get_all_repos(engine: State<'_, Arc<Engine>>) -> HashMap<String, Repository> {
    engine.repos.get_all()
}

#[tauri::command]
pub(crate) fn add_repo(engine: State<'_, Arc<Engine>>, repo: Repository) -> Result<(), String> {
    engine.repos.add(repo)
}

#[tauri::command]
pub(crate) fn update_repo(
    engine: State<'_, Arc<Engine>>,
    id: String,
    updates: RepoUpdate,
) -> Result<(), String> {
    engine.repos.update(&id, updates)
}

#[tauri::command]
pub(crate) fn remove_repo(engine: State<'_, Arc<Engine>>, id: String) -> Result<(), String> {
    engine.repos.remove(&id)
}

#[tauri::command]
pub(crate) fn reorder_repos(
    engine: State<'_, Arc<Engine>>,
    ids: Vec<String>,
) -> Result<(), String> {
    engine.repos.reorder(&ids)
}

// ---------------------------------------------------------------------------
// Settings commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn update_setting(
    engine: State<'_, Arc<Engine>>,
    key: String,
    value: String,
) -> Result<(), String> {
    engine.update_setting(&key, &value)
}

#[tauri::command]
pub(crate) fn get_engine_settings(engine: State<'_, Arc<Engine>>) -> crate::engine::EngineSettings {
    engine.get_settings()
}

// ---------------------------------------------------------------------------
// Workspace state commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn engine_save_workspace_state(
    engine: State<'_, Arc<Engine>>,
    key: String,
    value: String,
) -> Result<(), String> {
    engine.save_workspace_state(&key, &value)
}

#[tauri::command]
pub(crate) fn engine_load_workspace_state(
    engine: State<'_, Arc<Engine>>,
    key: String,
) -> Result<Option<String>, String> {
    engine.load_workspace_state(&key)
}
