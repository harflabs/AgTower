import { invoke } from "@tauri-apps/api/core";
import { createSession as engineCreateSession } from "@/lib/engine";
import type { DiscoveryResult } from "@/providers/types";
import { type Repository, useRepoStore } from "@/stores/repo-store";
import { DEFAULT_LIVE_STATE, type Session, useSessionStore } from "@/stores/session-store";

interface SessionMetadata {
  model: string | null;
  num_turns: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  provider_session_id: string | null;
  provider_file_path: string | null;
  slug: string | null;
}

interface RustDiscoveredCodexSession {
  thread_id: string;
  project_path: string;
  title: string;
  git_branch: string | null;
  model: string | null;
  created_at: number;
  last_activity_at: number;
  message_count: number;
  rollout_path: string;
  is_active: boolean;
}

let _discoveryRunning = false;

function normalizeRepoPath(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized || path;
}

export async function discoverCodexSessions(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { imported: 0, skipped: 0, errors: 0 };
  if (_discoveryRunning) return result;
  _discoveryRunning = true;
  try {
    return await _discoverInner();
  } finally {
    _discoveryRunning = false;
  }
}

async function _discoverInner(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { imported: 0, skipped: 0, errors: 0 };

  let discovered: RustDiscoveredCodexSession[];
  try {
    discovered = await invoke<RustDiscoveredCodexSession[]>("scan_codex_sessions");
  } catch (err) {
    console.error("[codex-discovery] Scan failed:", err);
    result.errors++;
    return result;
  }

  if (discovered.length === 0) return result;

  const existingSessions = useSessionStore.getState().sessions;
  const existingByThreadId = new Map<string, Session>();
  const existingByRolloutPath = new Map<string, Session>();
  const existingByRepoTime: Array<{ repoPath: string; createdAt: number }> = [];

  for (const session of Object.values(existingSessions)) {
    const pd = session.providerData ?? {};
    const threadId = pd.threadId as string | undefined;
    const rolloutPath = pd.rolloutPath as string | undefined;
    if (threadId) existingByThreadId.set(threadId, session);
    if (rolloutPath) existingByRolloutPath.set(rolloutPath, session);
    existingByRepoTime.push({
      repoPath: normalizeRepoPath(session.repoPath),
      createdAt: session.createdAt,
    });
  }

  const repos = useRepoStore.getState().repos;
  const reposByPath = new Map<string, Repository>();
  for (const repo of Object.values(repos)) {
    reposByPath.set(repo.path, repo);
  }

  const { addSession } = useSessionStore.getState();

  for (const disc of discovered) {
    const existingSession =
      existingByThreadId.get(disc.thread_id) ?? existingByRolloutPath.get(disc.rollout_path);
    if (existingSession) {
      const repo = await resolveRepoForDiscoveredSession(disc, reposByPath);
      if (
        repo &&
        (existingSession.repoId !== repo.id ||
          existingSession.repoPath !== repo.path ||
          existingSession.repoName !== repo.name)
      ) {
        useSessionStore.getState().updateSession(existingSession.id, {
          repoId: repo.id,
          repoPath: repo.path,
          repoName: repo.name,
        });
      }
      result.skipped++;
      continue;
    }

    const hasTimeMatch = existingByRepoTime.some(
      (s) =>
        s.repoPath === normalizeRepoPath(disc.project_path) &&
        Math.abs(s.createdAt - disc.created_at) < 60000,
    );
    if (hasTimeMatch) {
      result.skipped++;
      continue;
    }

    // Running external sessions stay outside the app until they close.
    if (disc.is_active) {
      result.skipped++;
      continue;
    }

    const repo = await resolveRepoForDiscoveredSession(disc, reposByPath);
    if (!repo) {
      // Historical session path is no longer available -- skip it without
      // failing the entire import flow.
      result.skipped++;
      continue;
    }

    const session: Session = {
      id: crypto.randomUUID(),
      repoId: repo.id,
      repoPath: repo.path,
      repoName: repo.name,
      prompt: disc.title,
      title: disc.title,
      status: "closed",
      pid: null,
      providerData: {
        threadId: disc.thread_id,
        rolloutPath: disc.rollout_path,
      },
      model: disc.model,
      createdAt: disc.created_at,
      endedAt: disc.last_activity_at,
      result: null,
      durationMs: disc.last_activity_at - disc.created_at,
      numTurns: Math.ceil(disc.message_count / 2),
      exitCode: null,
      error: null,
      baseCommitSha: null,
      totalInputTokens: null,
      totalOutputTokens: null,
      totalCacheReadTokens: null,
      totalCacheWriteTokens: null,
      gitBranch: disc.git_branch ?? null,
      stopReason: null,
      provider: "codex",
      ...DEFAULT_LIVE_STATE,
    };

    addSession(session);
    existingByThreadId.set(disc.thread_id, session);
    if (disc.rollout_path) existingByRolloutPath.set(disc.rollout_path, session);

    try {
      await engineCreateSession(session);
      result.imported++;

      if (!disc.is_active) {
        invoke<SessionMetadata>("extract_codex_metadata", {
          threadId: disc.thread_id,
          rolloutPath: disc.rollout_path,
        })
          .then((metadata) => {
            const tokenUpdates: Partial<Session> = {};
            if (metadata.total_input_tokens > 0)
              tokenUpdates.totalInputTokens = metadata.total_input_tokens;
            if (metadata.total_output_tokens > 0)
              tokenUpdates.totalOutputTokens = metadata.total_output_tokens;
            if (metadata.total_cache_read_tokens > 0)
              tokenUpdates.totalCacheReadTokens = metadata.total_cache_read_tokens;
            if (metadata.num_turns > 0) tokenUpdates.numTurns = metadata.num_turns;
            if (metadata.model) tokenUpdates.model = metadata.model;
            if (Object.keys(tokenUpdates).length > 0) {
              useSessionStore.getState().updateSession(session.id, tokenUpdates);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[codex-discovery] Failed to save session:", err);
      useSessionStore.getState().removeSession(session.id);
      result.errors++;
    }
  }

  return result;
}

async function resolveRepoForDiscoveredSession(
  disc: RustDiscoveredCodexSession,
  reposByPath: Map<string, Repository>,
): Promise<Repository | null> {
  const projectPath = normalizeRepoPath(disc.project_path);
  let repo = reposByPath.get(projectPath);
  if (!repo && projectPath !== disc.project_path) {
    repo = reposByPath.get(disc.project_path);
  }
  if (repo) return repo;

  try {
    const repoInfo = await invoke<{
      name: string;
      path: string;
      is_git: boolean;
    }>("validate_repository", { path: projectPath });

    const existingRepo = reposByPath.get(repoInfo.path);
    if (existingRepo) return existingRepo;

    const newRepo: Repository = {
      id: crypto.randomUUID(),
      name: repoInfo.name,
      path: repoInfo.path,
      isGit: repoInfo.is_git,
      addedAt: Date.now(),
      lastOpenedAt: disc.last_activity_at,
      pinned: false,
      color: "",
      sortOrder: null,
    };
    useRepoStore.getState().addRepo(newRepo);
    reposByPath.set(newRepo.path, newRepo);
    return newRepo;
  } catch {
    return null;
  }
}
