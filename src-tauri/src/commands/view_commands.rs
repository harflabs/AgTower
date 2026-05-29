use std::sync::Arc;

use tauri::State;

use crate::engine::computation::{self, SidebarTree};
use crate::engine::Engine;

#[tauri::command]
pub(crate) fn get_sidebar_tree(
    engine: State<'_, Arc<Engine>>,
    query: String,
    provider_filter: Option<String>,
    recent_closed_limit: usize,
    include_history_matches: bool,
) -> SidebarTree {
    let sessions = engine.sessions.get_all();
    let repos = engine.repos.get_all();
    computation::compute_sidebar_tree(
        &sessions,
        &repos,
        &query,
        provider_filter.as_deref(),
        recent_closed_limit,
        include_history_matches,
    )
}
