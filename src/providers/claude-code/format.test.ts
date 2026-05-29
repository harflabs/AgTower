import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_STATE, type Session } from "@/stores/session-store";
import { formatClaudeTokenSummary, preprocessClaudePrompt } from "./format";

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
    provider: "claude-code",
    ...DEFAULT_LIVE_STATE,
    ...overrides,
  };
}

describe("formatClaudeTokenSummary", () => {
  it("returns null when there are zero input and output tokens", () => {
    expect(formatClaudeTokenSummary(createSession({}))).toBeNull();
    expect(
      formatClaudeTokenSummary(
        createSession({
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
        }),
      ),
    ).toBeNull();
  });

  it("sums input, cache read and output tokens into a single total", () => {
    // totalIn = 1000 + 3000 = 4000, total = 4000 + 500 = 4500 => "4.5K tokens"
    const summary = formatClaudeTokenSummary(
      createSession({
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 3000,
      }),
    );
    expect(summary).toBe("4.5K tokens");
  });

  it("appends the compaction-count suffix when compactions occurred", () => {
    const summary = formatClaudeTokenSummary(
      createSession({
        totalInputTokens: 500,
        totalOutputTokens: 500,
        totalCacheReadTokens: 0,
        liveProviderData: { compactionCount: 2 },
      }),
    );
    expect(summary).toBe("1.0K tokens (2x compact)");
  });

  it("omits the compaction suffix when the count is zero", () => {
    const summary = formatClaudeTokenSummary(
      createSession({
        totalInputTokens: 100,
        totalOutputTokens: 50,
        liveProviderData: { compactionCount: 0 },
      }),
    );
    expect(summary).toBe("150 tokens");
  });
});

describe("preprocessClaudePrompt", () => {
  it("extracts the command-message name and returns it verbatim", () => {
    const result = preprocessClaudePrompt(
      "<command-message>commit (with arguments)</command-message><command-name>/commit</command-name>",
    );
    expect(result).toBe("commit (with arguments)");
  });

  it("strips the command-message closing tag and trailing text from the name", () => {
    const result = preprocessClaudePrompt("<command-message>  deploy  </command-message> ignored");
    expect(result).toBe("deploy");
  });

  it("strips command-name, command-args and local-command-caveat tag pairs", () => {
    const result = preprocessClaudePrompt(
      "<command-name>/run</command-name><command-args>--fast</command-args>" +
        "<local-command-caveat>be careful</local-command-caveat>hello",
    );
    expect(result).toBe("hello");
  });

  it("handles an open command tag without a closing tag via the fallback", () => {
    const result = preprocessClaudePrompt("before<command-name>/run never closed");
    expect(result).toBe("before");
  });

  it("strips a dangling local-command-caveat open tag through end of input", () => {
    const result = preprocessClaudePrompt("keep me<local-command-caveat>trailing junk");
    expect(result).toBe("keep me");
  });

  it("removes any remaining generic tags", () => {
    const result = preprocessClaudePrompt("<foo>bar</foo>baz");
    expect(result).toBe("barbaz");
  });

  it("leaves a plain prompt untouched", () => {
    expect(preprocessClaudePrompt("just a normal prompt")).toBe("just a normal prompt");
  });
});
