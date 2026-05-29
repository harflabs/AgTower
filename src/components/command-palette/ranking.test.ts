import { describe, expect, it, vi } from "vitest";
import type { PaletteContext, PaletteItem } from "./model";
import { parsePaletteQuery } from "./query";
import { rankPaletteItems } from "./ranking";

function createContext(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    activeRepo: null,
    activeRepoId: null,
    activeSession: null,
    activeSessionId: null,
    addRepository: async () => null,
    clearSessionCache: async () => {},
    isOnSession: false,
    navigate: vi.fn(),
    providers: [],
    repos: {},
    resetEverything: async () => {},
    restartSession: async () => {},
    startSession: async () => "session-1",
    startTerminalSession: async () => "session-2",
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
    stopAllSessions: async () => {},
    stopSession: async () => {},
    stopSessionsInRepo: async () => {},
    viewedSessionIds: [],
    ...overrides,
  };
}

function createItem(overrides: Partial<PaletteItem> = {}): PaletteItem {
  return {
    group: "Commands",
    id: "command:test",
    kind: "command",
    perform: () => {},
    title: "Test Command",
    ...overrides,
  };
}

describe("rankPaletteItems", () => {
  it("returns no ranked matches for an empty query state", () => {
    const items = [
      createItem({
        id: "command:dashboard",
        title: "Go to Dashboard",
        queryOrder: 80,
      }),
    ];

    expect(rankPaletteItems(items, parsePaletteQuery(""), createContext(), [])).toEqual([]);
  });

  it("returns the matching alias when an alias wins", () => {
    const items = [
      createItem({
        id: "command:mark-done",
        title: "Mark Done",
        aliases: ["Archive"],
        queryOrder: 50,
      }),
    ];

    const [match] = rankPaletteItems(items, parsePaletteQuery("archive"), createContext(), []);

    expect(match.item.id).toBe("command:mark-done");
    expect(match.matchedAlias).toBe("Archive");
  });

  it("boosts the active session over equally matching peers", () => {
    const items = [
      createItem({
        id: "session:1",
        kind: "session",
        title: "Fix login issue",
        group: "Sessions",
        meta: { repoId: "repo-1", sessionId: "1", status: "needsattention" },
      }),
      createItem({
        id: "session:2",
        kind: "session",
        title: "Fix login issue",
        group: "Sessions",
        meta: { repoId: "repo-2", sessionId: "2", status: "needsattention" },
      }),
    ];

    const ctx = createContext({
      activeRepoId: "repo-1",
      activeSessionId: "1",
    });

    const matches = rankPaletteItems(items, parsePaletteQuery("fix login"), ctx, []);

    expect(matches[0]?.item.id).toBe("session:1");
  });

  it("requires an exact query for guarded danger items", () => {
    const items = [
      createItem({
        dangerLevel: "guarded",
        exactMatchQuery: "reset everything",
        group: "Dangerous",
        id: "danger:reset-everything",
        kind: "danger",
        title: "Reset Everything",
      }),
    ];

    expect(rankPaletteItems(items, parsePaletteQuery("reset"), createContext(), [])).toHaveLength(
      0,
    );
    expect(
      rankPaletteItems(items, parsePaletteQuery("reset everything"), createContext(), []),
    ).toHaveLength(1);
  });

  it("uses MRU as a tiebreaker between equally-matched session items", () => {
    const items = [
      createItem({
        id: "session:older",
        kind: "session",
        title: "Fix login issue",
        group: "Sessions",
        meta: { repoId: "repo-1", sessionId: "older", status: "idle" },
      }),
      createItem({
        id: "session:newer",
        kind: "session",
        title: "Fix login issue",
        group: "Sessions",
        meta: { repoId: "repo-1", sessionId: "newer", status: "idle" },
      }),
    ];

    // "newer" is at MRU index 0, "older" at index 1 — recency tips the tie.
    const matches = rankPaletteItems(
      items,
      parsePaletteQuery("fix login"),
      createContext({ viewedSessionIds: ["newer", "older"] }),
      [],
    );

    expect(matches[0]?.item.id).toBe("session:newer");
    expect(matches[1]?.item.id).toBe("session:older");
  });

  it("shows hidden-until-query items for filter-only searches", () => {
    const items = [
      createItem({
        id: "command:new-codex-repo",
        keywords: ["new", "codex", "session", "repo"],
        meta: { providerId: "codex", repoId: "repo-1" },
        title: "New Codex Session in Repo",
      }),
    ];

    const matches = rankPaletteItems(
      items,
      parsePaletteQuery("provider:codex workspace:repo"),
      createContext(),
      [],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.item.id).toBe("command:new-codex-repo");
  });
});
