//! Sidebar tree computation.
//!
//! `compute_sidebar_tree` builds the workspace/session hierarchy the
//! frontend renders in the sidebar. Called via the `get_sidebar_tree`
//! Tauri command — each invocation takes <1ms.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::repo_store::Repository;
use super::session_store::{Session, SessionStatus};

// ---------------------------------------------------------------------------
// Output types (serialized to frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarTree {
    pub pinned_workspaces: Vec<SidebarWorkspaceNode>,
    pub workspaces: Vec<SidebarWorkspaceNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarWorkspaceNode {
    pub key: String,
    pub repo_id: Option<String>,
    pub name: String,
    pub path: Option<String>,
    pub color: Option<String>,
    pub is_missing: bool,
    pub visible_sessions: Vec<SidebarSessionNode>,
    pub history_count: usize,
    pub history_groups: Vec<SidebarHistoryGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarHistoryGroup {
    pub label: String,
    pub sessions: Vec<SidebarSessionNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarSessionNode {
    pub id: String,
    pub bucket: SidebarSessionBucket,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SidebarSessionBucket {
    Attention,
    Active,
    RecentClosed,
    History,
}

// ---------------------------------------------------------------------------
// Search helpers (case-insensitive substring match)
// ---------------------------------------------------------------------------

fn matches_search(query: &str, haystacks: &[&str]) -> bool {
    let q = query.trim();
    if q.is_empty() {
        return true;
    }
    let lower = q.to_lowercase();
    haystacks
        .iter()
        .any(|value| value.to_lowercase().contains(&lower))
}

fn last_activity(session: &Session) -> i64 {
    session.ended_at.unwrap_or(session.created_at)
}

fn sort_active_sessions(a: &Session, b: &Session) -> std::cmp::Ordering {
    let a_attention = a.status == SessionStatus::NeedsAttention;
    let b_attention = b.status == SessionStatus::NeedsAttention;
    if a_attention != b_attention {
        return b_attention.cmp(&a_attention);
    }
    last_activity(b).cmp(&last_activity(a))
}

fn sort_terminal_sessions(a: &Session, b: &Session) -> std::cmp::Ordering {
    last_activity(b).cmp(&last_activity(a))
}

pub(crate) fn compute_sidebar_tree(
    sessions: &HashMap<String, Session>,
    repos: &HashMap<String, Repository>,
    search_query: &str,
    provider_filter: Option<&str>,
    recent_closed_limit: usize,
    include_history_matches: bool,
) -> SidebarTree {
    let query = search_query.trim();
    let has_query = !query.is_empty();

    let provider_matches = |session: &&Session| match provider_filter {
        Some(filter) if !filter.is_empty() => session.provider == filter,
        _ => true,
    };

    // Pre-compute latest session activity per repo for sorting
    let mut repo_latest_activity: HashMap<&str, i64> = HashMap::new();
    for session in sessions.values().filter(provider_matches) {
        let activity = last_activity(session);
        let entry = repo_latest_activity
            .entry(session.repo_id.as_str())
            .or_insert(0);
        if activity > *entry {
            *entry = activity;
        }
    }

    let mut repo_order: Vec<&Repository> = repos.values().collect();
    repo_order.sort_by(|a, b| match (a.sort_order, b.sort_order) {
        (Some(ao), Some(bo)) => ao.cmp(&bo),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => {
            let a_latest = repo_latest_activity
                .get(a.id.as_str())
                .copied()
                .unwrap_or(0);
            let b_latest = repo_latest_activity
                .get(b.id.as_str())
                .copied()
                .unwrap_or(0);
            b_latest.cmp(&a_latest)
        }
    });

    let mut workspaces = Vec::new();
    let pinned_repo_ids: HashSet<String> = repos
        .values()
        .filter(|r| r.pinned)
        .map(|r| r.id.clone())
        .collect();

    for repo in repo_order {
        let repo_sessions: Vec<Session> = sessions
            .values()
            .filter(provider_matches)
            .filter(|session| session.repo_id == repo.id)
            .cloned()
            .collect();

        // Keep workspaces visible even when none of their sessions match the
        // filter — the workspace's "+" button is the only way to create a
        // session of the filtered provider in that repo, so hiding the row
        // would dead-end the user. Sessions inside the workspace are still
        // filtered (provider_matches above), so the row just shows up empty.
        // Search filtering, by contrast, is driven by user query intent and
        // continues to hide non-matching workspaces (handled below).

        let workspace_matches_search =
            has_query && matches_search(query, &[&repo.name, &repo.path]);
        let session_matches_search = repo_sessions.iter().any(|session| {
            matches_search(
                query,
                &[&session.title, &session.prompt, &session.repo_name],
            )
        });

        if has_query && !workspace_matches_search && !session_matches_search {
            continue;
        }

        let mut active_sessions: Vec<Session> = repo_sessions
            .iter()
            .filter(|session| session.status.is_active())
            .cloned()
            .collect();
        active_sessions.sort_by(sort_active_sessions);

        // Closed sessions sorted by recency (archived excluded from sidebar)
        let mut closed_sessions: Vec<Session> = repo_sessions
            .iter()
            .filter(|session| session.status == SessionStatus::Closed)
            .cloned()
            .collect();
        closed_sessions.sort_by(sort_terminal_sessions);

        let matches_filter = |session: &Session| -> bool {
            !has_query
                || workspace_matches_search
                || matches_search(
                    query,
                    &[&session.title, &session.prompt, &session.repo_name],
                )
        };

        // Visible: active sessions + up to N recent closed
        let visible_recent_closed: Vec<Session> = if has_query {
            closed_sessions
                .iter()
                .filter(|session| matches_filter(session))
                .cloned()
                .collect()
        } else {
            closed_sessions
                .iter()
                .take(recent_closed_limit)
                .cloned()
                .collect()
        };

        let recent_closed_ids: HashSet<String> = visible_recent_closed
            .iter()
            .map(|session| session.id.clone())
            .collect();

        // History: remaining closed sessions, grouped by time
        let history_pool: Vec<Session> = closed_sessions
            .into_iter()
            .filter(|session| !recent_closed_ids.contains(&session.id))
            .filter(|session| matches_filter(session))
            .collect();

        let history_count = history_pool.len();
        let history_groups = if history_count > 0 && (include_history_matches || !has_query) {
            let now = epoch_ms();
            let today = today_start_ms(now);
            let yesterday = today - 86_400_000;
            let last7 = today - 7 * 86_400_000;
            let last30 = today - 30 * 86_400_000;

            let mut g_today = Vec::new();
            let mut g_yesterday = Vec::new();
            let mut g_last7 = Vec::new();
            let mut g_last30 = Vec::new();
            let mut g_older = Vec::new();

            for session in &history_pool {
                let t = session.ended_at.unwrap_or(session.created_at);
                let node = SidebarSessionNode {
                    id: session.id.clone(),
                    bucket: SidebarSessionBucket::History,
                };
                if t >= today {
                    g_today.push(node);
                } else if t >= yesterday {
                    g_yesterday.push(node);
                } else if t >= last7 {
                    g_last7.push(node);
                } else if t >= last30 {
                    g_last30.push(node);
                } else {
                    g_older.push(node);
                }
            }

            let mut groups = Vec::new();
            if !g_today.is_empty() {
                groups.push(SidebarHistoryGroup {
                    label: "Today".to_string(),
                    sessions: g_today,
                });
            }
            if !g_yesterday.is_empty() {
                groups.push(SidebarHistoryGroup {
                    label: "Yesterday".to_string(),
                    sessions: g_yesterday,
                });
            }
            if !g_last7.is_empty() {
                groups.push(SidebarHistoryGroup {
                    label: "Last 7 days".to_string(),
                    sessions: g_last7,
                });
            }
            if !g_last30.is_empty() {
                groups.push(SidebarHistoryGroup {
                    label: "Last 30 days".to_string(),
                    sessions: g_last30,
                });
            }
            if !g_older.is_empty() {
                groups.push(SidebarHistoryGroup {
                    label: "Older".to_string(),
                    sessions: g_older,
                });
            }
            groups
        } else {
            Vec::new()
        };

        let visible_active: Vec<Session> = active_sessions
            .into_iter()
            .filter(|session| matches_filter(session))
            .collect();

        let visible_sessions = visible_active
            .into_iter()
            .map(|session| SidebarSessionNode {
                id: session.id,
                bucket: if session.status == SessionStatus::NeedsAttention {
                    SidebarSessionBucket::Attention
                } else {
                    SidebarSessionBucket::Active
                },
            })
            .chain(
                visible_recent_closed
                    .into_iter()
                    .map(|session| SidebarSessionNode {
                        id: session.id,
                        bucket: SidebarSessionBucket::RecentClosed,
                    }),
            )
            .collect::<Vec<_>>();

        workspaces.push(SidebarWorkspaceNode {
            key: repo.id.clone(),
            repo_id: Some(repo.id.clone()),
            name: repo.name.clone(),
            path: Some(repo.path.clone()),
            color: Some(repo.color.clone()),
            is_missing: false,
            visible_sessions,
            history_count,
            history_groups,
        });
    }

    let mut missing_groups: HashMap<String, Vec<Session>> = HashMap::new();
    for session in sessions
        .values()
        .filter(provider_matches)
        .filter(|session| !repos.contains_key(&session.repo_id))
    {
        missing_groups
            .entry(session.repo_id.clone())
            .or_default()
            .push(session.clone());
    }

    let mut missing_order: Vec<(String, Vec<Session>)> = missing_groups.into_iter().collect();
    missing_order.sort_by(|(_, a), (_, b)| {
        let a_latest = a.iter().map(last_activity).max().unwrap_or_default();
        let b_latest = b.iter().map(last_activity).max().unwrap_or_default();
        b_latest.cmp(&a_latest)
    });

    for (repo_id, mut group_sessions) in missing_order {
        group_sessions.sort_by(sort_terminal_sessions);
        let workspace_name = group_sessions
            .first()
            .map(|session| session.repo_name.clone())
            .unwrap_or_else(|| "Removed Workspace".to_string());
        let workspace_matches_search = !has_query
            || matches_search(
                query,
                &[&workspace_name, group_sessions[0].repo_path.as_str()],
            );
        let session_matches_search = !has_query
            || group_sessions.iter().any(|session| {
                matches_search(
                    query,
                    &[&session.title, &session.prompt, &session.repo_name],
                )
            });

        if has_query && !workspace_matches_search && !session_matches_search {
            continue;
        }

        let visible_sessions = group_sessions
            .into_iter()
            .filter(|session| {
                !has_query
                    || workspace_matches_search
                    || matches_search(
                        query,
                        &[&session.title, &session.prompt, &session.repo_name],
                    )
            })
            .map(|session| SidebarSessionNode {
                id: session.id,
                bucket: if session.status == SessionStatus::NeedsAttention {
                    SidebarSessionBucket::Attention
                } else if session.status.is_active() {
                    SidebarSessionBucket::Active
                } else if session.status == SessionStatus::Closed {
                    SidebarSessionBucket::RecentClosed
                } else {
                    SidebarSessionBucket::History
                },
            })
            .collect::<Vec<_>>();

        workspaces.push(SidebarWorkspaceNode {
            key: format!("missing:{repo_id}"),
            repo_id: Some(repo_id),
            name: workspace_name,
            path: None,
            color: None,
            is_missing: true,
            visible_sessions,
            history_count: 0,
            history_groups: Vec::new(),
        });
    }

    let (pinned_workspaces, unpinned_workspaces): (Vec<_>, Vec<_>) =
        workspaces.into_iter().partition(|w| {
            w.repo_id
                .as_ref()
                .is_some_and(|id| pinned_repo_ids.contains(id))
        });

    SidebarTree {
        pinned_workspaces,
        workspaces: unpinned_workspaces,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

use super::epoch_ms;

/// Calculate the start of today in milliseconds (midnight local time).
/// Falls back to approximate calculation if timezone conversion fails.
fn today_start_ms(now_ms: i64) -> i64 {
    use chrono::{Local, TimeZone};
    if let chrono::LocalResult::Single(now) = Local.timestamp_millis_opt(now_ms) {
        if let Some(today) = now.date_naive().and_hms_opt(0, 0, 0) {
            if let chrono::LocalResult::Single(t) = Local.from_local_datetime(&today) {
                return t.timestamp_millis();
            }
        }
    }
    if let Some(now) = chrono::DateTime::from_timestamp_millis(now_ms) {
        let local_now = now.with_timezone(&Local);
        if let Some(today) = local_now.date_naive().and_hms_opt(0, 0, 0) {
            if let chrono::LocalResult::Single(t) = Local.from_local_datetime(&today) {
                return t.timestamp_millis();
            }
        }
    }
    if let Some(today) = chrono::DateTime::from_timestamp_millis(now_ms)
        .map(|now| now.date_naive())
        .and_then(|date| date.and_hms_opt(0, 0, 0))
    {
        if let chrono::LocalResult::Single(t) = Local.from_local_datetime(&today) {
            return t.timestamp_millis();
        }
    }
    // Fallback: approximate midnight by rounding down to nearest day
    now_ms - (now_ms % 86_400_000)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    fn make_session(
        id: &str,
        repo_id: &str,
        repo_name: &str,
        title: &str,
        prompt: &str,
        status: SessionStatus,
        created_at: i64,
    ) -> Session {
        Session {
            id: id.to_string(),
            repo_id: repo_id.to_string(),
            repo_path: format!("/tmp/{repo_id}"),
            repo_name: repo_name.to_string(),
            prompt: prompt.to_string(),
            title: title.to_string(),
            status,
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
            provider: "claude-code".to_string(),
            provider_data: json!({}),
            live_provider_data: json!({}),
        }
    }

    fn make_repo(id: &str, name: &str, sort_order: Option<i64>, added_at: i64) -> Repository {
        Repository {
            id: id.to_string(),
            name: name.to_string(),
            path: format!("/work/{name}"),
            is_git: true,
            color: "#000000".to_string(),
            pinned: false,
            sort_order,
            added_at,
            last_opened_at: added_at,
        }
    }

    #[test]
    fn sidebar_tree_builds_workspace_and_missing_groups() {
        let repos = HashMap::from([(
            "repo-1".to_string(),
            make_repo("repo-1", "Repo One", Some(0), 10),
        )]);

        let mut sessions = HashMap::new();

        let attention = make_session(
            "attention",
            "repo-1",
            "Repo One",
            "Attention",
            "prompt",
            SessionStatus::NeedsAttention,
            500,
        );

        let mut idle = make_session(
            "idle",
            "repo-1",
            "Repo One",
            "Idle",
            "prompt",
            SessionStatus::Idle,
            400,
        );
        idle.ended_at = Some(450);

        let mut closed_new = make_session(
            "closed-new",
            "repo-1",
            "Repo One",
            "Closed New",
            "prompt",
            SessionStatus::Closed,
            300,
        );
        closed_new.ended_at = Some(600);

        let mut closed_old = make_session(
            "closed-old",
            "repo-1",
            "Repo One",
            "Closed Old",
            "prompt",
            SessionStatus::Closed,
            200,
        );
        closed_old.ended_at = Some(250);

        let mut archived = make_session(
            "archived",
            "repo-1",
            "Repo One",
            "Archived",
            "prompt",
            SessionStatus::Archived,
            100,
        );
        archived.ended_at = Some(150);

        let mut missing_closed = make_session(
            "missing-closed",
            "missing-repo",
            "Removed Repo",
            "Missing Closed",
            "prompt",
            SessionStatus::Closed,
            50,
        );
        missing_closed.repo_path = "/gone/repo".to_string();
        missing_closed.ended_at = Some(70);

        for session in [
            attention,
            idle,
            closed_new,
            closed_old,
            archived,
            missing_closed,
        ] {
            sessions.insert(session.id.clone(), session);
        }

        let tree = compute_sidebar_tree(&sessions, &repos, "", None, 1, false);

        assert_eq!(tree.workspaces.len(), 2);

        let repo_workspace = tree
            .workspaces
            .iter()
            .find(|workspace| workspace.repo_id.as_deref() == Some("repo-1"))
            .unwrap();
        assert!(!repo_workspace.is_missing);
        assert_eq!(
            repo_workspace
                .visible_sessions
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>(),
            vec!["attention", "idle", "closed-new"]
        );
        assert!(matches!(
            repo_workspace.visible_sessions[0].bucket,
            SidebarSessionBucket::Attention
        ));
        assert!(matches!(
            repo_workspace.visible_sessions[1].bucket,
            SidebarSessionBucket::Active
        ));
        assert!(matches!(
            repo_workspace.visible_sessions[2].bucket,
            SidebarSessionBucket::RecentClosed
        ));
        // closed-old goes to history, archived is excluded from sidebar
        assert_eq!(repo_workspace.history_count, 1);

        let missing_workspace = tree
            .workspaces
            .iter()
            .find(|workspace| workspace.is_missing)
            .unwrap();
        assert_eq!(missing_workspace.name, "Removed Repo");
        assert_eq!(
            missing_workspace
                .visible_sessions
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>(),
            vec!["missing-closed"]
        );
    }

    #[test]
    fn sidebar_tree_excludes_archived_sessions() {
        let repos = HashMap::from([(
            "repo-1".to_string(),
            make_repo("repo-1", "Repo One", Some(0), 10),
        )]);

        let mut archived = make_session(
            "archived-only",
            "repo-1",
            "Repo One",
            "Archive candidate",
            "prompt",
            SessionStatus::Archived,
            100,
        );
        archived.ended_at = Some(100);

        let mut closed = make_session(
            "closed-one",
            "repo-1",
            "Repo One",
            "Closed session",
            "prompt",
            SessionStatus::Closed,
            200,
        );
        closed.ended_at = Some(200);

        let sessions =
            HashMap::from([(archived.id.clone(), archived), (closed.id.clone(), closed)]);

        let tree = compute_sidebar_tree(&sessions, &repos, "", None, 1, false);
        let workspace = &tree.workspaces[0];
        // Closed session appears in visible, archived is excluded entirely
        assert_eq!(workspace.visible_sessions.len(), 1);
        assert_eq!(workspace.visible_sessions[0].id, "closed-one");
        assert_eq!(workspace.history_count, 0);
    }
}
