import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "@/stores/repo-store";
import { useRepoStore } from "@/stores/repo-store";
import { DEFAULT_LIVE_STATE, type Session, useSessionStore } from "@/stores/session-store";

const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function resetStores() {
  useSessionStore.setState({
    sessions: {},
    _hydrated: false,
    activeSessionId: null,
    unseenCount: 0,
  });
  useRepoStore.setState({
    repos: {},
    activeRepoId: null,
  });
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    repoId: "repo-1",
    repoPath: "/tmp/repo",
    repoName: "repo",
    prompt: "",
    title: "Session 1",
    status: "running",
    pid: null,
    providerData: {},
    model: null,
    createdAt: 0,
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
    provider: "claude-code",
    ...DEFAULT_LIVE_STATE,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "repo-1",
    name: "repo",
    path: "/tmp/repo",
    isGit: true,
    addedAt: 0,
    lastOpenedAt: 0,
    pinned: false,
    color: "",
    sortOrder: null,
    ...overrides,
  };
}

describe("useSessionStore", () => {
  beforeEach(() => {
    resetStores();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetStores();
    invokeMock.mockReset();
  });

  describe("updateSession", () => {
    it("does not persist when only transient fields change", () => {
      const session = makeSession();
      useSessionStore.getState().addSession(session);

      useSessionStore.getState().updateSession(session.id, {
        ptyActive: true,
        liveProviderData: { tokens: 10 },
      });

      expect(invokeMock).not.toHaveBeenCalled();
      const stored = useSessionStore.getState().sessions[session.id];
      expect(stored.ptyActive).toBe(true);
      expect(stored.liveProviderData).toEqual({ tokens: 10 });
    });

    it("persists via update_session when a persistent field changes", () => {
      const session = makeSession();
      useSessionStore.getState().addSession(session);

      useSessionStore.getState().updateSession(session.id, { status: "idle" });

      expect(invokeMock).toHaveBeenCalledWith("update_session", {
        id: session.id,
        updates: { status: "idle" },
      });
      expect(useSessionStore.getState().sessions[session.id].status).toBe("idle");
    });

    it("persists when a persistent field is mixed with transient fields", () => {
      const session = makeSession();
      useSessionStore.getState().addSession(session);

      useSessionStore.getState().updateSession(session.id, {
        ptyActive: true,
        status: "needsAttention",
      });

      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith("update_session", {
        id: session.id,
        updates: { ptyActive: true, status: "needsAttention" },
      });
    });

    it("ignores updates for an unknown session id", () => {
      useSessionStore.getState().updateSession("missing", { status: "idle" });

      // No persistent change is dispatched because the session does not exist.
      expect(invokeMock).not.toHaveBeenCalled();
      expect(useSessionStore.getState().sessions.missing).toBeUndefined();
    });
  });

  describe("_addFromEngine", () => {
    it("is a no-op before hydration", () => {
      const session = makeSession({ providerData: { threadId: "t-1" } });

      useSessionStore.getState()._addFromEngine(session);

      expect(useSessionStore.getState().sessions[session.id]).toBeUndefined();
    });

    it("rejects sessions without any provider identity key", () => {
      useSessionStore.setState({ _hydrated: true });
      const session = makeSession({ providerData: { somethingElse: "x" } });

      useSessionStore.getState()._addFromEngine(session);

      expect(useSessionStore.getState().sessions[session.id]).toBeUndefined();
    });

    it("accepts a session whose providerData carries a threadId", () => {
      useSessionStore.setState({ _hydrated: true });
      const session = makeSession({ providerData: { threadId: "t-1" } });

      useSessionStore.getState()._addFromEngine(session);

      expect(useSessionStore.getState().sessions[session.id]).toBeDefined();
    });

    it("remaps repoId when a same-path repo exists under a different id", () => {
      useSessionStore.setState({ _hydrated: true });
      useRepoStore.setState({
        repos: {
          "repo-canonical": makeRepo({ id: "repo-canonical", path: "/tmp/repo" }),
        },
      });
      const session = makeSession({
        repoId: "repo-stale",
        repoPath: "/tmp/repo",
        providerData: { sessionId: "s-1" },
      });

      useSessionStore.getState()._addFromEngine(session);

      const stored = useSessionStore.getState().sessions[session.id];
      expect(stored).toBeDefined();
      expect(stored.repoId).toBe("repo-canonical");
    });

    it("keeps the original repoId when no matching repo exists", () => {
      useSessionStore.setState({ _hydrated: true });
      const session = makeSession({
        repoId: "repo-original",
        repoPath: "/tmp/repo",
        providerData: { filePath: "/tmp/repo/session.json" },
      });

      useSessionStore.getState()._addFromEngine(session);

      expect(useSessionStore.getState().sessions[session.id].repoId).toBe("repo-original");
    });

    it("does not overwrite an already-present session", () => {
      useSessionStore.setState({ _hydrated: true });
      const existing = makeSession({ title: "original", providerData: { threadId: "t-1" } });
      useSessionStore.getState().addSession(existing);

      const incoming = makeSession({ title: "incoming", providerData: { threadId: "t-1" } });
      useSessionStore.getState()._addFromEngine(incoming);

      expect(useSessionStore.getState().sessions[existing.id].title).toBe("original");
    });
  });
});
