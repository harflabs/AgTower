import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { saveWorkspaceState } from "@/lib/engine";
import { confirmDestructiveAction } from "@/lib/native-dialog";
import { generateSessionTitle } from "@/lib/session-helpers";
import { detectClaude } from "@/providers/claude-code/types";
import { detectCodex } from "@/providers/codex/types";
import { buildLaunchOptionData, pickLaunchOptionOverrides } from "@/providers/launch-options";
import { useRepoStore } from "@/stores/repo-store";
import { DEFAULT_LIVE_STATE, type Session, useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";

type LaunchableProviderId = "claude-code" | "codex";

const PROVIDER_LABELS: Record<LaunchableProviderId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

const ACTIVE_SESSION_STATUSES = new Set(["running", "needsAttention", "idle"]);

async function assertProviderInstalled(providerId: LaunchableProviderId): Promise<void> {
  const cliPath = useSettingsStore.getState().providerSettings[providerId]?.cliPath;
  const resolvedPath = typeof cliPath === "string" && cliPath.trim() ? cliPath.trim() : undefined;
  const detection =
    providerId === "claude-code"
      ? await detectClaude(resolvedPath)
      : await detectCodex(resolvedPath);
  if (!detection.available) {
    const label = PROVIDER_LABELS[providerId];
    throw new Error(
      resolvedPath
        ? `${label} could not be launched from the configured CLI path.`
        : `${label} is not installed or is not available on this Mac.`,
    );
  }
}

export interface StartSessionOptions {
  prompt?: string;
  providerId?: string | null;
  repoId?: string | null;
  launchOptions?: Record<string, string>;
}

export interface StartTerminalSessionOptions {
  repoId?: string | null;
}

function resolveWorkspace(repoId?: string | null) {
  const { activeRepoId, repos } = useRepoStore.getState();
  const targetRepoId = repoId ?? activeRepoId;
  const repo = targetRepoId ? repos[targetRepoId] : null;
  if (!repo) throw new Error("No workspace selected");
  return repo;
}

function buildProviderDataFromSettings(
  providerId: string,
  settings: Record<string, unknown>,
  overrides?: Record<string, string>,
) {
  const providerData: Record<string, string> = {};
  // Identity seed, not a user-facing launch option: claim a sessionId up front
  // and pass it to Claude via `--session-id` in the launcher. Without this,
  // Claude picks its own id and AgTower falls back to timestamp-proximity
  // matching in `extract_metadata`, which silently reassigns JSONLs between
  // empty new sessions and then dedupes them (see `session_store.rs::dedup_sessions`).
  if (providerId === "claude-code") {
    providerData.sessionId = crypto.randomUUID();
  }
  Object.assign(providerData, buildLaunchOptionData(providerId, settings, overrides));
  return providerData;
}

function buildProviderModelFromSettings(settings: Record<string, unknown>) {
  return typeof settings.defaultModel === "string" && settings.defaultModel.trim()
    ? settings.defaultModel.trim()
    : null;
}

export function useSession() {
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const startSession = useCallback(
    async (options: StartSessionOptions = {}) => {
      const activeRepo = resolveWorkspace(options.repoId);
      const providerId = options.providerId ?? useSettingsStore.getState().defaultProvider;
      const prompt = options.prompt ?? "";

      if (providerId !== "claude-code" && providerId !== "codex") {
        throw new Error(`Unsupported provider: ${providerId}`);
      }

      await assertProviderInstalled(providerId);

      const sessionId = crypto.randomUUID();

      // Capture git baseline SHA before session starts
      let baseCommitSha: string | null = null;
      try {
        baseCommitSha = await invoke<string | null>("get_git_head_sha", {
          repoPath: activeRepo.path,
        });
      } catch {
        // Non-git repo or git not available
      }

      const providerSettings = useSettingsStore.getState().providerSettings[providerId] ?? {};
      const session: Session = {
        id: sessionId,
        repoId: activeRepo.id,
        repoPath: activeRepo.path,
        repoName: activeRepo.name,
        prompt,
        title: generateSessionTitle(prompt, providerId),
        // Must be "running" at creation (not "idle"): `resolveLaunchMode` in
        // session-terminal.tsx treats "idle" as "resume the last session",
        // so using it here would cause clicking + to resume the most recent
        // conversation instead of starting fresh. `session-terminal.tsx` flips
        // this to "idle" right after the PTY launches.
        status: "running",
        pid: null,
        providerData: buildProviderDataFromSettings(
          providerId,
          providerSettings,
          options.launchOptions,
        ),
        model: buildProviderModelFromSettings(providerSettings),
        createdAt: Date.now(),
        endedAt: null,
        result: null,
        durationMs: null,
        numTurns: null,
        exitCode: null,
        error: null,
        baseCommitSha,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCacheReadTokens: null,
        totalCacheWriteTokens: null,
        gitBranch: null,
        stopReason: null,
        provider: providerId,
        ...DEFAULT_LIVE_STATE,
      };
      addSession(session);
      try {
        await invoke("create_session", { session });
      } catch (err) {
        useSessionStore.getState()._removeFromEngine(sessionId);
        throw err;
      }
      useRepoStore.getState().setActiveRepo(activeRepo.id);
      setActiveSession(sessionId);
      useRepoStore.getState().updateRepo(activeRepo.id, { lastOpenedAt: Date.now() });
      saveWorkspaceState("activeSessionId", sessionId).catch(console.error);

      return sessionId;
    },
    [addSession, setActiveSession],
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      // Kill the PTY session
      try {
        await invoke("kill_pty_session", { sessionId });
      } catch (err) {
        console.warn("[stop] PTY kill failed:", err);
      }
      updateSession(sessionId, {
        status: "closed",
        endedAt: Date.now(),
      });
    },
    [updateSession],
  );

  const restartSession = useCallback(
    async (sessionId: string) => {
      const session = useSessionStore.getState().sessions[sessionId];
      if (!session) throw new Error("Session not found");

      if (session.provider === "claude-code" || session.provider === "codex") {
        await assertProviderInstalled(session.provider);
      }

      // Kill existing PTY if running
      if (
        session.status === "running" ||
        session.status === "needsAttention" ||
        session.status === "idle"
      ) {
        try {
          await invoke("kill_pty_session", { sessionId });
        } catch {
          // Session may already be dead
        }
      }

      // Re-capture baseline for restart
      let baseCommitSha: string | null = null;
      try {
        baseCommitSha = await invoke<string | null>("get_git_head_sha", {
          repoPath: session.repoPath,
        });
      } catch {
        // proceed without baseline
      }

      const providerSettings = useSettingsStore.getState().providerSettings[session.provider] ?? {};
      // Preserve the launch-option choices baked into the original session's
      // providerData so a restart keeps the same permission mode / sandbox / etc.
      const overrides = pickLaunchOptionOverrides(session.provider, session.providerData);
      const providerData = buildProviderDataFromSettings(
        session.provider,
        providerSettings,
        overrides,
      );
      const model = buildProviderModelFromSettings(providerSettings);

      updateSession(sessionId, {
        status: "running",
        pid: null,
        // Restart starts a fresh provider conversation, so rebuild launch
        // metadata from current settings rather than carrying resume IDs over.
        providerData,
        model,
        endedAt: null,
        result: null,
        durationMs: null,
        numTurns: null,
        exitCode: null,
        error: null,
        baseCommitSha,
        ptyActive: false,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCacheReadTokens: null,
        totalCacheWriteTokens: null,
        gitBranch: null,
        stopReason: null,
        provider: session.provider,
      });
    },
    [updateSession],
  );

  const stopAllSessions = useCallback(async () => {
    const allSessions = useSessionStore.getState().sessions;
    const running = Object.values(allSessions).filter((s) => ACTIVE_SESSION_STATUSES.has(s.status));
    if (running.length === 0) return;

    const confirmed = await confirmDestructiveAction({
      title: running.length === 1 ? "Stop active session?" : `Stop ${running.length} sessions?`,
      message:
        running.length === 1
          ? "This will terminate the active agent process and move the session to Closed."
          : "This will terminate every active agent process and move those sessions to Closed.",
      okLabel: "Stop",
    });
    if (!confirmed) return;

    const endedAt = Date.now();
    await Promise.allSettled(
      running.map((s) =>
        invoke("kill_pty_session", { sessionId: s.id })
          .catch(() => {})
          .then(() => {
            updateSession(s.id, { status: "closed", endedAt });
          }),
      ),
    );
  }, [updateSession]);

  const stopSessionsInRepo = useCallback(
    async (repoId: string) => {
      const allSessions = useSessionStore.getState().sessions;
      const running = Object.values(allSessions).filter(
        (s) => ACTIVE_SESSION_STATUSES.has(s.status) && s.repoId === repoId,
      );
      if (running.length === 0) return;

      const repoName = running[0]?.repoName ?? "this workspace";
      const confirmed = await confirmDestructiveAction({
        title: running.length === 1 ? `Stop session in ${repoName}?` : `Stop ${repoName} sessions?`,
        message:
          running.length === 1
            ? "This will terminate the active agent process and move the session to Closed."
            : "This will terminate every active agent process in this workspace and move those sessions to Closed.",
        okLabel: "Stop",
      });
      if (!confirmed) return;

      const endedAt = Date.now();
      await Promise.allSettled(
        running.map((s) =>
          invoke("kill_pty_session", { sessionId: s.id })
            .catch(() => {})
            .then(() => {
              updateSession(s.id, { status: "closed", endedAt });
            }),
        ),
      );
    },
    [updateSession],
  );

  const startTerminalSession = useCallback(
    async (options: StartTerminalSessionOptions = {}) => {
      const activeRepo = resolveWorkspace(options.repoId);

      const sessionId = crypto.randomUUID();
      const session: Session = {
        id: sessionId,
        repoId: activeRepo.id,
        repoPath: activeRepo.path,
        repoName: activeRepo.name,
        prompt: "",
        title: "Terminal",
        status: "running",
        pid: null,
        providerData: {},
        model: null,
        createdAt: Date.now(),
        endedAt: null,
        result: null,
        durationMs: null,
        numTurns: null,
        exitCode: null,
        error: null,
        baseCommitSha: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCacheReadTokens: null,
        totalCacheWriteTokens: null,
        gitBranch: null,
        stopReason: null,
        provider: "terminal",
        ...DEFAULT_LIVE_STATE,
      };
      addSession(session);
      try {
        await invoke("create_session", { session });
      } catch (err) {
        useSessionStore.getState()._removeFromEngine(sessionId);
        throw err;
      }
      useRepoStore.getState().setActiveRepo(activeRepo.id);
      setActiveSession(sessionId);
      useRepoStore.getState().updateRepo(activeRepo.id, { lastOpenedAt: Date.now() });
      saveWorkspaceState("activeSessionId", sessionId).catch(console.error);

      return sessionId;
    },
    [addSession, setActiveSession],
  );

  return {
    startSession,
    stopSession,
    restartSession,
    stopAllSessions,
    stopSessionsInRepo,
    startTerminalSession,
  };
}
