import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIVE_STATE, type Session } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { claudeCodeLauncher } from "./claude-code/launcher";
import { codexLauncher } from "./codex/launcher";

const DEFAULT_SETTINGS = {
  archiveAfterDays: 7,
  defaultProvider: "claude-code",
  launchInTmux: false,
  notifications: {
    desktop: false,
    inApp: true,
    sound: true,
  },
  providerSettings: {},
  sessionSortOrder: "recent" as const,
  sidebarProviderFilter: "",
  startupBehavior: "dashboard" as const,
  theme: "system" as const,
  workspaceSortOrder: "manual" as const,
};

function resetSettingsStore() {
  localStorage.clear();
  useSettingsStore.setState({
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications },
    providerSettings: {},
  });
}

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

describe("provider launchers", () => {
  beforeEach(() => {
    resetSettingsStore();
  });

  it("includes configured Claude env vars in the PTY launch spec", () => {
    useSettingsStore.setState({
      providerSettings: {
        "claude-code": {
          envVars: {
            ANTHROPIC_API_KEY: "secret",
            " CLAUDE_LOG ": "debug",
            "   ": "ignored",
            "BAD KEY": "ignored",
            "BAD=KEY": "ignored",
          },
        },
      },
    });

    const spec = claudeCodeLauncher.buildPtyLaunch(
      createSession({ provider: "claude-code" }),
      "new",
    );

    expect(spec).toMatchObject({
      kind: "process",
      program: "claude",
    });
    expect(spec.kind).toBe("process");
    if (spec.kind !== "process") {
      throw new Error("Expected Claude launch to spawn a process");
    }
    expect(spec.env).toEqual({
      ANTHROPIC_API_KEY: "secret",
      CLAUDE_LOG: "debug",
    });
  });

  it("includes configured Codex env vars in the PTY launch spec", () => {
    useSettingsStore.setState({
      providerSettings: {
        codex: {
          envVars: {
            OPENAI_API_KEY: "secret",
            CODEX_SANDBOX: "workspace-write",
            " BAD KEY ": "ignored",
            "ALSO=BAD": "ignored",
          },
        },
      },
    });

    const spec = codexLauncher.buildPtyLaunch(
      createSession({ provider: "codex", model: "o4-mini" }),
      "new",
    );

    expect(spec).toMatchObject({
      kind: "process",
      program: "codex",
    });
    expect(spec.kind).toBe("process");
    if (spec.kind !== "process") {
      throw new Error("Expected Codex launch to spawn a process");
    }
    expect(spec.env).toEqual({
      OPENAI_API_KEY: "secret",
      CODEX_SANDBOX: "workspace-write",
    });
  });
});
