import { beforeAll, describe, expect, it } from "vitest";
import { computeKanbanColumns, generateSessionTitle } from "@/lib/session-helpers";
import { preprocessClaudePrompt } from "@/providers/claude-code/format";
import { getAllProviders, registerProvider } from "@/providers/registry";
import type { ProviderModule } from "@/providers/types";
import type { Session } from "@/stores/session-store";
import type { SessionStatus } from "@/types/session";

// A minimal stub provider that wires up only the `preprocessPrompt` hook.
// This mirrors the real claude-code registration (using the real preprocessor)
// without importing the launcher / settings React component. generateSessionTitle
// only calls preprocessPrompt when a matching providerId is passed, so the rest
// of the suite (which omits providerId) is unaffected by this registration.
const PROVIDER_ID = "claude-code";

beforeAll(() => {
  if (!getAllProviders().some((p) => p.id === PROVIDER_ID)) {
    const stub = {
      id: PROVIDER_ID,
      displayName: "Claude Code",
      assistantDisplayName: "Claude",
      preprocessPrompt: preprocessClaudePrompt,
    } as unknown as ProviderModule;
    registerProvider(stub);
  }
});

describe("generateSessionTitle", () => {
  describe("slash and command-message prompts", () => {
    it("humanizes a slash command into a title-cased name", () => {
      expect(generateSessionTitle("/fix-bug now please")).toBe("Fix Bug");
    });

    it("humanizes a slash command with underscores", () => {
      expect(generateSessionTitle("/check_submissions")).toBe("Check Submissions");
    });

    it("humanizes a <command-message> tag via the provider preprocessor", () => {
      const input = "<command-message>check-submissions</command-message>";
      expect(generateSessionTitle(input, PROVIDER_ID)).toBe("Check Submissions");
    });
  });

  describe("shell prompt extraction", () => {
    it("extracts the command after an arrow (➜) prompt", () => {
      const input = "➜ pnpm tauri dev\n> agtower@0.1.0 tauri /Users/dev/projects\n> tauri dev";
      expect(generateSessionTitle(input)).toBe("pnpm tauri dev");
    });

    it("extracts the command after a chevron (❯) prompt", () => {
      expect(generateSessionTitle("❯ cargo build")).toBe("cargo build");
    });

    it("extracts the command after a `$ ` prompt and ignores following output", () => {
      expect(generateSessionTitle("$ git status\nOn branch main")).toBe("git status");
    });

    it("extracts the command after a `% ` prompt", () => {
      expect(generateSessionTitle("% ls -la")).toBe("ls -la");
    });
  });

  describe("terminal noise stripping", () => {
    it("skips npm/pnpm script output lines (`> pkg@1.0.0 script /path`)", () => {
      const input =
        "> agtower@0.1.0 tauri /Users/dev/projects\nRunning dev server\n> vite@5.0.0 dev /path";
      expect(generateSessionTitle(input)).toBe("Running dev server");
    });

    it("strips an inline npm script line (pkg@version script /path) mid-text", () => {
      expect(generateSessionTitle("Running agtower@0.1.0 tauri /Users/dev/projects")).toBe(
        "Running",
      );
    });

    it("strips a bare absolute path token", () => {
      expect(generateSessionTitle("error in /Users/dev/projects/project/file.ts")).toBe("error in");
    });

    it("leaves a normal prompt untouched", () => {
      const input = "add a dark mode toggle to the settings page";
      expect(generateSessionTitle(input)).toBe(input);
    });
  });

  describe("truncation at 60 graphemes", () => {
    it("returns short text unchanged", () => {
      const input = "a".repeat(60);
      expect(generateSessionTitle(input)).toBe(input);
    });

    it("truncates long text to 57 chars plus an ellipsis", () => {
      const result = generateSessionTitle("c".repeat(61));
      expect(result.endsWith("...")).toBe(true);
      expect([...result]).toHaveLength(60);
      expect(result).toBe(`${"c".repeat(57)}...`);
    });

    it("truncates multibyte/emoji text without splitting surrogate pairs", () => {
      // 65 rocket emoji — a naive string slice(0, 57) would split the final
      // surrogate pair into mojibake. The grapheme-aware [...text] spread guards
      // against that, keeping each emoji whole.
      const input = "🚀".repeat(65);
      const result = generateSessionTitle(input);
      expect(result.endsWith("...")).toBe(true);
      expect([...result]).toHaveLength(60);
      expect(result).toBe(`${"🚀".repeat(57)}...`);
      // No lone surrogate (replacement char / broken pair) leaked through.
      expect(result).not.toContain("�");
    });
  });

  describe("empty and whitespace input", () => {
    it("falls back to `New Session` for an empty string", () => {
      expect(generateSessionTitle("")).toBe("New Session");
    });

    it("falls back to `New Session` for whitespace-only input", () => {
      expect(generateSessionTitle("   \n\t  ")).toBe("New Session");
    });
  });
});

describe("computeKanbanColumns", () => {
  let counter = 0;

  function makeSession(overrides: Partial<Session> = {}): Session {
    counter += 1;
    const base: Session = {
      id: `s${counter}`,
      repoId: "repo-a",
      repoPath: "/repos/a",
      repoName: "a",
      prompt: "do the thing",
      title: "Do the thing",
      status: "running" as SessionStatus,
      pid: null,
      providerData: {},
      model: null,
      createdAt: 1000,
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
      ptyActive: false,
      liveProviderData: {},
    };
    return { ...base, ...overrides };
  }

  function asRecord(sessions: Session[]): Record<string, Session> {
    return Object.fromEntries(sessions.map((s) => [s.id, s]));
  }

  it("returns the three columns in running/attention/idle order with labels", () => {
    const columns = computeKanbanColumns({}, null, null);
    expect(columns.map((c) => c.key)).toEqual(["running", "attention", "idle"]);
    expect(columns.map((c) => c.label)).toEqual(["Running", "Attention", "Idle"]);
    for (const column of columns) {
      expect(column.sessions).toEqual([]);
    }
  });

  it("buckets sessions by status and ignores closed/archived sessions", () => {
    const sessions = asRecord([
      makeSession({ id: "run", status: "running" }),
      makeSession({ id: "attn", status: "needsAttention" }),
      makeSession({ id: "idle", status: "idle" }),
      makeSession({ id: "closed", status: "closed" }),
      makeSession({ id: "arch", status: "archived" }),
    ]);
    const [running, attention, idle] = computeKanbanColumns(sessions, null, null);

    expect(running.sessions.map((s) => s.id)).toEqual(["run"]);
    expect(attention.sessions.map((s) => s.id)).toEqual(["attn"]);
    expect(idle.sessions.map((s) => s.id)).toEqual(["idle"]);
  });

  it("filters by workspace (repoId)", () => {
    const sessions = asRecord([
      makeSession({ id: "a1", repoId: "repo-a", status: "running" }),
      makeSession({ id: "b1", repoId: "repo-b", status: "running" }),
    ]);
    const [running] = computeKanbanColumns(sessions, "repo-a", null);
    expect(running.sessions.map((s) => s.id)).toEqual(["a1"]);
  });

  it("filters by provider", () => {
    const sessions = asRecord([
      makeSession({ id: "cc", provider: "claude-code", status: "running" }),
      makeSession({ id: "cx", provider: "codex", status: "running" }),
    ]);
    const [running] = computeKanbanColumns(sessions, null, "codex");
    expect(running.sessions.map((s) => s.id)).toEqual(["cx"]);
  });

  it("applies workspace and provider filters together", () => {
    const sessions = asRecord([
      makeSession({ id: "match", repoId: "repo-a", provider: "codex", status: "running" }),
      makeSession({ id: "wrongRepo", repoId: "repo-b", provider: "codex", status: "running" }),
      makeSession({
        id: "wrongProv",
        repoId: "repo-a",
        provider: "claude-code",
        status: "running",
      }),
    ]);
    const [running] = computeKanbanColumns(sessions, "repo-a", "codex");
    expect(running.sessions.map((s) => s.id)).toEqual(["match"]);
  });

  it("sorts each column by activity descending (endedAt ?? createdAt)", () => {
    const sessions = asRecord([
      makeSession({ id: "oldest", status: "running", createdAt: 100, endedAt: null }),
      makeSession({ id: "newest", status: "running", createdAt: 200, endedAt: 5000 }),
      makeSession({ id: "middle", status: "running", createdAt: 3000, endedAt: null }),
    ]);
    const [running] = computeKanbanColumns(sessions, null, null);
    // newest (endedAt 5000) > middle (createdAt 3000) > oldest (createdAt 100)
    expect(running.sessions.map((s) => s.id)).toEqual(["newest", "middle", "oldest"]);
  });
});
