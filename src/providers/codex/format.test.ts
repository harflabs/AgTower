import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_STATE, type Session } from "@/stores/session-store";
import { formatCodexTokenSummary, getCodexActivityText } from "./format";

function createSession(overrides: Partial<Session>): Session {
  return {
    id: "session-1",
    repoId: "repo-1",
    repoPath: "/tmp/repo",
    repoName: "repo",
    prompt: "Fix startup",
    title: "Fix startup",
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
    provider: "codex",
    ...DEFAULT_LIVE_STATE,
    ...overrides,
  };
}

describe("formatCodexTokenSummary", () => {
  it("returns null when there are zero input and output tokens", () => {
    expect(formatCodexTokenSummary(createSession({}))).toBeNull();
    expect(
      formatCodexTokenSummary(
        createSession({
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
        }),
      ),
    ).toBeNull();
  });

  it("computes totalIn as input plus cacheRead and the cache percentage", () => {
    // totalIn = 1000 + 3000 = 4000, cache% = round(3000 / 4000 * 100) = 75
    const summary = formatCodexTokenSummary(
      createSession({
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 3000,
      }),
    );
    expect(summary).toBe("4.0K in · 500 out · 75% cached");
  });

  it("rounds the cache percentage", () => {
    // totalIn = 1 + 2 = 3, cache% = round(2 / 3 * 100) = round(66.66) = 67
    const summary = formatCodexTokenSummary(
      createSession({
        totalInputTokens: 1,
        totalOutputTokens: 0,
        totalCacheReadTokens: 2,
      }),
    );
    expect(summary).toBe("3 in · 0 out · 67% cached");
  });

  it("omits the cached part when there is no cache read", () => {
    const summary = formatCodexTokenSummary(
      createSession({
        totalInputTokens: 1200,
        totalOutputTokens: 800,
        totalCacheReadTokens: 0,
      }),
    );
    expect(summary).toBe("1.2K in · 800 out");
  });
});

describe("getCodexActivityText", () => {
  it("returns null when no live activity flags are set", () => {
    expect(getCodexActivityText(createSession({}))).toBeNull();
  });

  it("prefers API error over every lower-priority flag", () => {
    const session = createSession({
      liveProviderData: {
        apiError: { message: "boom" },
        waitingForApproval: true,
        isThinking: true,
        activeTool: "Read(file.ts)",
        activeCommand: "ls",
        activeSubagents: 2,
      },
    });
    expect(getCodexActivityText(session)).toBe("Error: boom");
  });

  it("uses the retry form when the API error has a retry attempt", () => {
    const session = createSession({
      liveProviderData: { apiError: { message: "boom", retryAttempt: 3 } },
    });
    expect(getCodexActivityText(session)).toBe("Error (retry 3)");
  });

  it("prefers waiting for approval over thinking and tools", () => {
    const session = createSession({
      liveProviderData: {
        waitingForApproval: true,
        isThinking: true,
        activeTool: "Read(file.ts)",
        activeCommand: "ls",
        activeSubagents: 2,
      },
    });
    expect(getCodexActivityText(session)).toBe("Waiting for approval...");
  });

  it("prefers thinking over active tool, command and subagents", () => {
    const session = createSession({
      liveProviderData: {
        isThinking: true,
        activeTool: "Read(file.ts)",
        activeCommand: "ls",
        activeSubagents: 2,
      },
    });
    expect(getCodexActivityText(session)).toBe("Thinking...");
  });

  it("prefers active tool over command and subagents", () => {
    const session = createSession({
      liveProviderData: {
        activeTool: "Read(file.ts)",
        activeCommand: "ls",
        activeSubagents: 2,
      },
    });
    expect(getCodexActivityText(session)).toBe("Read(file.ts)");
  });

  it("prefers active command over subagents", () => {
    const session = createSession({
      liveProviderData: {
        activeCommand: "ls -la",
        activeSubagents: 2,
      },
    });
    expect(getCodexActivityText(session)).toBe("Running: ls -la");
  });

  it("falls back to subagent count when nothing else is active", () => {
    const session = createSession({
      liveProviderData: { activeSubagents: 2 },
    });
    expect(getCodexActivityText(session)).toBe("2 agent(s) working");
  });
});
