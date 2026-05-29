import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordViewedSession } from "@/lib/viewed-session-history";
import type { ProviderModule } from "@/providers/types";
import type { Repository } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import { getPaletteItems } from "./command-actions";
import type { PaletteContext } from "./model";

function makeProvider(
  id: string,
  displayName: string,
  assistantDisplayName: string,
): ProviderModule {
  return {
    id,
    displayName,
    getProviderSessionId: (session) => {
      const providerData = session.providerData as Record<string, unknown>;
      const sessionKey = id === "codex" ? "threadId" : "sessionId";
      const sessionId = providerData[sessionKey];
      return typeof sessionId === "string" ? sessionId : null;
    },
    assistantDisplayName,
    launcher: {
      buildPtyLaunch: () => ({ kind: "process", program: id, args: [] }),
    },
    settings: {
      SettingsSection: (() => null) as never,
    },
  };
}

function makeRepo(overrides: Partial<Repository>): Repository {
  return {
    id: overrides.id ?? "repo-1",
    name: overrides.name ?? "AgTower",
    path: overrides.path ?? "/tmp/agtower",
    isGit: overrides.isGit ?? true,
    addedAt: overrides.addedAt ?? 0,
    lastOpenedAt: overrides.lastOpenedAt ?? 0,
    pinned: overrides.pinned ?? false,
    color: overrides.color ?? "",
    sortOrder: overrides.sortOrder ?? null,
  };
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? "session-1",
    repoId: overrides.repoId ?? "repo-1",
    repoPath: overrides.repoPath ?? "/tmp/agtower",
    repoName: overrides.repoName ?? "AgTower",
    prompt: overrides.prompt ?? "",
    title: overrides.title ?? "Session",
    status: overrides.status ?? "running",
    pid: overrides.pid ?? null,
    providerData: overrides.providerData ?? {},
    model: overrides.model ?? null,
    createdAt: overrides.createdAt ?? 0,
    endedAt: overrides.endedAt ?? null,
    result: overrides.result ?? null,
    durationMs: overrides.durationMs ?? null,
    numTurns: overrides.numTurns ?? null,
    exitCode: overrides.exitCode ?? null,
    error: overrides.error ?? null,
    baseCommitSha: overrides.baseCommitSha ?? null,
    totalInputTokens: overrides.totalInputTokens ?? null,
    totalOutputTokens: overrides.totalOutputTokens ?? null,
    totalCacheReadTokens: overrides.totalCacheReadTokens ?? null,
    totalCacheWriteTokens: overrides.totalCacheWriteTokens ?? null,
    gitBranch: overrides.gitBranch ?? null,
    stopReason: overrides.stopReason ?? null,
    provider: overrides.provider ?? "claude-code",
    ptyActive: overrides.ptyActive ?? false,
    liveProviderData: overrides.liveProviderData ?? {},
  };
}

function createContext(overrides: Partial<PaletteContext> = {}): PaletteContext {
  const repo = makeRepo({});
  return {
    activeRepo: repo,
    activeRepoId: repo.id,
    activeSession: null,
    activeSessionId: null,
    addRepository: async () => null,
    clearSessionCache: async () => {},
    isOnSession: false,
    navigate: vi.fn(),
    providers: [
      makeProvider("claude-code", "Claude Code", "Claude"),
      makeProvider("codex", "Codex", "Codex"),
    ],
    repos: { [repo.id]: repo },
    resetEverything: async () => {},
    restartSession: async () => {},
    sessions: {},
    settings: {
      archiveAfterDays: 7,
      defaultProvider: "claude-code",
      notifications: { desktop: true, inApp: true, sound: true },
      providerSettings: {},
      sidebarProviderFilter: "",
      startupBehavior: "dashboard",
      theme: "system",
    },
    startSession: async () => "session-created",
    startTerminalSession: async () => "terminal-created",
    stopAllSessions: async () => {},
    stopSession: async () => {},
    stopSessionsInRepo: async () => {},
    viewedSessionIds: [],
    ...overrides,
  };
}

describe("getPaletteItems", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds provider-aware launch commands for each workspace", () => {
    const items = getPaletteItems(createContext());
    const codexItem = items.find((item) => item.id === "command:new-provider-session:codex:repo-1");

    expect(
      items.find((item) => item.id === "command:new-provider-session:claude-code:repo-1"),
    ).toMatchObject({
      title: "New Claude Session in AgTower",
    });
    expect(codexItem).toMatchObject({
      title: "New Codex Session in AgTower",
    });
    expect(items.find((item) => item.id === "command:new-terminal:repo-1")).toMatchObject({
      title: "New Terminal in AgTower",
    });
    expect(codexItem?.aliases).toEqual(
      expect.arrayContaining(["Codex @ AgTower", "Codex@AgTower"]),
    );
  });

  it("adds open-session cycling commands when open sessions exist", () => {
    const current = makeSession({
      createdAt: 20,
      id: "current",
      repoId: "repo-1",
      status: "running",
    });
    const next = makeSession({
      createdAt: 10,
      id: "next",
      repoId: "repo-1",
      status: "idle",
    });

    const items = getPaletteItems(
      createContext({
        activeSession: current,
        activeSessionId: current.id,
        sessions: {
          [current.id]: current,
          [next.id]: next,
        },
      }),
    );

    expect(items.find((item) => item.id === "command:next-open-session")).toMatchObject({
      shortcutActionId: "next-open-session",
      title: "Next Open Session",
    });
    expect(items.find((item) => item.id === "command:prev-open-session")).toMatchObject({
      shortcutActionId: "prev-open-session",
      title: "Previous Open Session",
    });
  });

  it("adds scoped latest and resume commands for workspaces and providers", () => {
    const running = makeSession({
      createdAt: 40,
      id: "running",
      provider: "codex",
      repoId: "repo-1",
      status: "running",
    });
    const closedCodex = makeSession({
      createdAt: 30,
      id: "closed-codex",
      provider: "codex",
      repoId: "repo-1",
      status: "closed",
    });
    const attentionClaude = makeSession({
      createdAt: 20,
      id: "attention-claude",
      provider: "claude-code",
      repoId: "repo-1",
      status: "needsAttention",
    });

    const items = getPaletteItems(
      createContext({
        sessions: {
          [running.id]: running,
          [closedCodex.id]: closedCodex,
          [attentionClaude.id]: attentionClaude,
        },
      }),
    );

    expect(items.find((item) => item.id === "command:open-latest:repo-1")).toMatchObject({
      title: "Open Latest Session in AgTower",
    });
    expect(
      items.find((item) => item.id === "command:resume-latest-provider:codex:repo-1"),
    ).toMatchObject({
      title: "Resume Latest Codex Session in AgTower",
    });
    expect(items.find((item) => item.id === "command:open-attention:repo-1")).toMatchObject({
      title: "Open Latest Attention Session in AgTower",
    });
    expect(items.find((item) => item.id === "command:stop-provider:codex:repo-1")).toMatchObject({
      title: "Stop Active Codex Sessions in AgTower",
    });
  });

  it("adds power commands for the current session", () => {
    const previous = makeSession({
      createdAt: 20,
      id: "previous",
      provider: "claude-code",
      repoId: "repo-1",
      status: "closed",
      title: "Previous Session",
    });
    const current = makeSession({
      createdAt: 30,
      id: "current",
      prompt: "Investigate the dashboard bug",
      provider: "codex",
      providerData: { threadId: "thread_123" },
      repoId: "repo-1",
      status: "running",
      title: "Current Session",
    });

    recordViewedSession(previous.id);
    recordViewedSession(current.id);

    const items = getPaletteItems(
      createContext({
        activeSession: current,
        activeSessionId: current.id,
        isOnSession: true,
        sessions: {
          [previous.id]: previous,
          [current.id]: current,
        },
      }),
    );

    expect(items.find((item) => item.id === "command:clone-current-session")).toMatchObject({
      title: "Clone Current Session",
    });
    expect(items.find((item) => item.id === "command:copy-resume-command")).toMatchObject({
      title: "Copy Resume Command",
    });
  });

  it("orders open sessions in the home view by MRU and flags the current session", () => {
    const olderVisited = makeSession({
      createdAt: 10,
      id: "older-visited",
      repoId: "repo-1",
      status: "idle",
      title: "Older Visited",
    });
    const recentlyVisited = makeSession({
      createdAt: 20,
      id: "recently-visited",
      repoId: "repo-1",
      status: "needsAttention",
      title: "Recently Visited",
    });
    const neverVisited = makeSession({
      createdAt: 100,
      id: "never-visited",
      repoId: "repo-1",
      status: "running",
      title: "Never Visited",
    });
    const current = makeSession({
      createdAt: 50,
      id: "current",
      repoId: "repo-1",
      status: "running",
      title: "Current",
    });

    // History order (freshest first): current, recentlyVisited, olderVisited.
    // never-visited has no MRU rank and falls to the end of the sort.
    const items = getPaletteItems(
      createContext({
        activeSession: current,
        activeSessionId: current.id,
        isOnSession: true,
        sessions: {
          [olderVisited.id]: olderVisited,
          [recentlyVisited.id]: recentlyVisited,
          [neverVisited.id]: neverVisited,
          [current.id]: current,
        },
        viewedSessionIds: [current.id, recentlyVisited.id, olderVisited.id],
      }),
    );

    const homeSessionItems = items
      .filter((item) => item.kind === "session" && item.homeSection === "Open Sessions")
      .sort((a, b) => (a.homeOrder ?? 999) - (b.homeOrder ?? 999));

    expect(homeSessionItems.map((item) => item.id)).toEqual([
      `session:${current.id}`,
      `session:${recentlyVisited.id}`,
      `session:${olderVisited.id}`,
      `session:${neverVisited.id}`,
    ]);
    expect(homeSessionItems[0]?.isCurrent).toBe(true);
    expect(homeSessionItems.slice(1).every((item) => item.isCurrent !== true)).toBe(true);
  });

  it("renders an Idle activity fallback when the provider has no live data", () => {
    const session = makeSession({
      id: "no-activity",
      provider: "claude-code",
      repoId: "repo-1",
      status: "idle",
      title: "No Activity",
    });

    const items = getPaletteItems(
      createContext({
        sessions: { [session.id]: session },
        viewedSessionIds: [session.id],
      }),
    );

    const item = items.find((entry) => entry.id === `session:${session.id}`);
    expect(item?.activity).toBe("Idle");
  });

  it("omits the activity row entirely for closed sessions", () => {
    const closed = makeSession({
      id: "closed-session",
      provider: "claude-code",
      repoId: "repo-1",
      status: "closed",
      title: "Closed",
    });

    const items = getPaletteItems(
      createContext({
        sessions: { [closed.id]: closed },
        viewedSessionIds: [closed.id],
      }),
    );

    const item = items.find((entry) => entry.id === `session:${closed.id}`);
    expect(item?.activity).toBeUndefined();
    expect(item?.homeSection).toBeUndefined();
  });

  it("does not expose stale feed-only commands for terminal sessions", () => {
    const current = makeSession({
      id: "current",
      repoId: "repo-1",
      status: "running",
    });

    const items = getPaletteItems(
      createContext({
        activeSession: current,
        activeSessionId: current.id,
        isOnSession: true,
        sessions: {
          [current.id]: current,
        },
      }),
    );
    const ids = items.map((item) => item.id);

    expect(ids).not.toContain("command:reply-current");
    expect(ids).not.toContain("command:toggle-tool-groups");
    expect(ids).not.toContain("command:toggle-file-changes");
    expect(items.find((item) => item.id === "command:stop-current")?.shortcutActionId).toBe(
      undefined,
    );
  });
});
