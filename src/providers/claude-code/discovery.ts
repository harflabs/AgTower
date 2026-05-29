import { invoke } from "@tauri-apps/api/core";
import { createSession as engineCreateSession } from "@/lib/engine";
import type { DiscoveryResult } from "@/providers/types";
import { type Repository, useRepoStore } from "@/stores/repo-store";
import { DEFAULT_LIVE_STATE, type Session, useSessionStore } from "@/stores/session-store";

// Matches Rust SessionMetadata struct (returned by extract_session_metadata)
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

// Matches Rust DiscoveredCliSession struct (snake_case from serde)
interface RustDiscoveredSession {
  session_id: string;
  project_path: string;
  title: string;
  git_branch: string | null;
  model: string | null;
  created_at: number;
  last_activity_at: number;
  message_count: number;
  provider_file_path: string;
  is_active: boolean;
}

// Guard against concurrent discovery (React StrictMode double-mount, rapid calls)
let _discoveryRunning = false;

/**
 * Scan CLI sessions and import new ones into the app.
 * Returns count of imported/skipped sessions.
 */
export async function discoverCliSessions(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { imported: 0, skipped: 0, errors: 0 };
  if (_discoveryRunning) return result;
  _discoveryRunning = true;
  try {
    return await _discoverCliSessionsInner();
  } finally {
    _discoveryRunning = false;
  }
}

async function _discoverCliSessionsInner(): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { imported: 0, skipped: 0, errors: 0 };

  // 1. Invoke Rust scanner
  let discovered: RustDiscoveredSession[];
  try {
    discovered = await invoke<RustDiscoveredSession[]>("scan_cli_sessions");
  } catch (err) {
    console.error("[discovery] Scan failed:", err);
    result.errors++;
    return result;
  }

  if (discovered.length === 0) return result;

  // 2. Build dedup sets from existing sessions
  const existingSessions = useSessionStore.getState().sessions;
  const existingProviderIds = new Set<string>();
  const existingProviderPaths = new Set<string>();
  // Also build a map of (repoPath, createdAt) for time-based dedup
  const existingByRepoTime: Array<{ repoPath: string; createdAt: number }> = [];
  for (const session of Object.values(existingSessions)) {
    const pd = session.providerData ?? {};
    const providerSessionId = pd.sessionId as string | undefined;
    const providerFilePath = pd.filePath as string | undefined;
    if (providerSessionId) {
      existingProviderIds.add(providerSessionId);
    }
    if (providerFilePath) {
      existingProviderPaths.add(providerFilePath);
    }
    existingByRepoTime.push({
      repoPath: session.repoPath,
      createdAt: session.createdAt,
    });
  }

  // 3. Build repo lookup by path for association
  const repos = useRepoStore.getState().repos;
  const reposByPath = new Map<string, Repository>();
  for (const repo of Object.values(repos)) {
    reposByPath.set(repo.path, repo);
  }

  // 4. Process each discovered session
  const { addSession } = useSessionStore.getState();

  for (const disc of discovered) {
    // Skip if already imported — dedup by provider session ID
    if (existingProviderIds.has(disc.session_id)) {
      result.skipped++;
      continue;
    }

    // Skip if provider file path already known by another session
    if (existingProviderPaths.has(disc.provider_file_path)) {
      result.skipped++;
      continue;
    }

    // Skip if an app-created session exists for same repo within 60s
    // (handles case where app session hasn't had providerSessionId extracted yet)
    const hasTimeMatch = existingByRepoTime.some(
      (s) => s.repoPath === disc.project_path && Math.abs(s.createdAt - disc.created_at) < 60000,
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

    // Find or create the repo for this session's project path
    let repo = reposByPath.get(disc.project_path);

    if (!repo) {
      // Auto-create repo if path exists on disk
      try {
        const repoInfo = await invoke<{
          name: string;
          path: string;
          is_git: boolean;
        }>("validate_repository", { path: disc.project_path });

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
        repo = newRepo;
        reposByPath.set(newRepo.path, newRepo);
      } catch {
        // Historical session path is no longer available -- skip it without
        // failing the entire import flow.
        result.skipped++;
        continue;
      }
    }

    // Build the Session from discovered metadata
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
        sessionId: disc.session_id,
        filePath: disc.provider_file_path,
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
      provider: "claude-code",
      ...DEFAULT_LIVE_STATE,
    };

    addSession(session);
    existingProviderIds.add(disc.session_id);
    if (disc.provider_file_path) existingProviderPaths.add(disc.provider_file_path);

    try {
      await engineCreateSession(session);
      result.imported++;

      // Extract token metadata for completed sessions (runs in background)
      if (!disc.is_active) {
        invoke<SessionMetadata>("extract_session_metadata", {
          repoPath: disc.project_path,
          providerSessionId: disc.session_id,
          sessionCreatedAt: disc.created_at,
        })
          .then((metadata) => {
            const tokenUpdates: Partial<Session> = {};
            if (metadata.total_input_tokens > 0)
              tokenUpdates.totalInputTokens = metadata.total_input_tokens as number;
            if (metadata.total_output_tokens > 0)
              tokenUpdates.totalOutputTokens = metadata.total_output_tokens as number;
            if (metadata.total_cache_read_tokens > 0)
              tokenUpdates.totalCacheReadTokens = metadata.total_cache_read_tokens as number;
            if (metadata.total_cache_write_tokens > 0)
              tokenUpdates.totalCacheWriteTokens = metadata.total_cache_write_tokens as number;
            if (metadata.num_turns > 0) tokenUpdates.numTurns = metadata.num_turns;
            if (metadata.model) tokenUpdates.model = metadata.model;
            if (Object.keys(tokenUpdates).length > 0) {
              useSessionStore.getState().updateSession(session.id, tokenUpdates);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[discovery] Failed to save session:", err);
      // Remove from store to keep memory and DB consistent
      useSessionStore.getState().removeSession(session.id);
      result.errors++;
    }
  }

  return result;
}
