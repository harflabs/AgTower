/**
 * Thin TypeScript wrappers around Rust engine commands.
 *
 * Sessions, repos, workspace state, and engine-owned settings persist through
 * the Rust backend. UI-only settings may still live in client state.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Repository } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import type { SidebarTree } from "@/types/sidebar";

export interface EngineSettings {
  notificationsEnabled: boolean;
  notificationSound: boolean;
  archiveAfterDays: number;
}

// ---------------------------------------------------------------------------
// Workspace state (key-value store for UI state restoration)
// ---------------------------------------------------------------------------

export function saveWorkspaceState(key: string, value: string): Promise<void> {
  return invoke("engine_save_workspace_state", { key, value });
}

export function loadWorkspaceState(key: string): Promise<string | null> {
  return invoke("engine_load_workspace_state", { key });
}

export function engineStartup(): Promise<void> {
  return invoke("engine_startup");
}

export function hasExistingUserData(): Promise<boolean> {
  return invoke("engine_has_existing_user_data");
}

export function getAllSessions(): Promise<Record<string, Session>> {
  return invoke("get_all_sessions");
}

export function getAllRepos(): Promise<Record<string, unknown>> {
  return invoke("get_all_repos");
}

export function addRepo(repo: Repository): Promise<void> {
  return invoke("add_repo", { repo });
}

export function updateRepo(
  id: string,
  updates: Partial<
    Pick<Repository, "name" | "color" | "pinned" | "sortOrder" | "lastOpenedAt" | "isGit">
  >,
): Promise<void> {
  return invoke("update_repo", { id, updates });
}

export function removeRepo(id: string): Promise<void> {
  return invoke("remove_repo", { id });
}

export function reorderRepos(ids: string[]): Promise<void> {
  return invoke("reorder_repos", { ids });
}

export function createSession(session: Session): Promise<void> {
  return invoke("create_session", { session });
}

export function clearSessionCache(): Promise<void> {
  return invoke("clear_session_cache");
}

export function resetEverything(): Promise<void> {
  return invoke("reset_everything");
}

export function getEngineSettings(): Promise<EngineSettings> {
  return invoke("get_engine_settings");
}

export function getSidebarTree(
  query: string,
  providerFilter: string | null,
  recentClosedLimit = 5,
  includeHistoryMatches = true,
): Promise<SidebarTree> {
  return invoke("get_sidebar_tree", {
    query,
    providerFilter,
    recentClosedLimit,
    includeHistoryMatches,
  });
}

export function updateEngineSetting(key: string, value: string): Promise<void> {
  return invoke("update_setting", { key, value });
}
