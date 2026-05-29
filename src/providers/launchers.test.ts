import { beforeEach, describe, expect, it } from "vitest";
// Importing the provider modules registers them so getProvider() returns their
// declared launchOptions for the linkage test.
import "@/providers/claude-code";
import "@/providers/codex";
import { getProvider } from "@/providers/registry";
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

/** Whether `flag` appears in args immediately followed by `value`. */
function hasFlagValue(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === value) return true;
  }
  return false;
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

  it("emits Claude --permission-mode and --effort from providerData", () => {
    const spec = claudeCodeLauncher.buildPtyLaunch(
      createSession({
        provider: "claude-code",
        providerData: { sessionId: "sid-1", permissionMode: "auto", effort: "high" },
      }),
      "new",
    );
    if (spec.kind !== "process") throw new Error("Expected Claude launch to spawn a process");
    expect(hasFlagValue(spec.args, "--permission-mode", "auto")).toBe(true);
    expect(hasFlagValue(spec.args, "--effort", "high")).toBe(true);
  });

  it("omits Claude --permission-mode and --effort when providerData is empty", () => {
    const spec = claudeCodeLauncher.buildPtyLaunch(
      createSession({ provider: "claude-code", providerData: {} }),
      "new",
    );
    if (spec.kind !== "process") throw new Error("Expected Claude launch to spawn a process");
    expect(spec.args).not.toContain("--permission-mode");
    expect(spec.args).not.toContain("--effort");
  });

  it("emits Codex --ask-for-approval and --sandbox from providerData", () => {
    const spec = codexLauncher.buildPtyLaunch(
      createSession({
        provider: "codex",
        providerData: { askForApproval: "on-request", sandbox: "workspace-write" },
      }),
      "new",
    );
    if (spec.kind !== "process") throw new Error("Expected Codex launch to spawn a process");
    expect(hasFlagValue(spec.args, "--ask-for-approval", "on-request")).toBe(true);
    expect(hasFlagValue(spec.args, "--sandbox", "workspace-write")).toBe(true);
    expect(spec.args).not.toContain("--approval-mode");
  });

  it("emits Codex `resume <threadId>` and suppresses option flags when resuming", () => {
    const spec = codexLauncher.buildPtyLaunch(
      createSession({
        provider: "codex",
        model: "o4-mini",
        providerData: {
          threadId: "thread-9",
          askForApproval: "never",
          sandbox: "danger-full-access",
        },
      }),
      "resume",
    );
    if (spec.kind !== "process") throw new Error("Expected Codex launch to spawn a process");
    expect(hasFlagValue(spec.args, "resume", "thread-9")).toBe(true);
    expect(spec.args).not.toContain("--ask-for-approval");
    expect(spec.args).not.toContain("--sandbox");
    expect(spec.args).not.toContain("--model");
  });

  it("re-emits Codex option flags when a resume has no threadId (falls through to new)", () => {
    const spec = codexLauncher.buildPtyLaunch(
      createSession({
        provider: "codex",
        providerData: { askForApproval: "on-request", sandbox: "read-only" },
      }),
      "resume",
    );
    if (spec.kind !== "process") throw new Error("Expected Codex launch to spawn a process");
    expect(spec.args).not.toContain("resume");
    expect(hasFlagValue(spec.args, "--ask-for-approval", "on-request")).toBe(true);
    expect(hasFlagValue(spec.args, "--sandbox", "read-only")).toBe(true);
  });

  it("resumes Claude with --resume and still applies its option flags", () => {
    const spec = claudeCodeLauncher.buildPtyLaunch(
      createSession({
        provider: "claude-code",
        providerData: { sessionId: "sid-7", permissionMode: "plan", effort: "max" },
      }),
      "resume",
    );
    if (spec.kind !== "process") throw new Error("Expected Claude launch to spawn a process");
    expect(hasFlagValue(spec.args, "--resume", "sid-7")).toBe(true);
    expect(spec.args).not.toContain("--continue");
    expect(hasFlagValue(spec.args, "--permission-mode", "plan")).toBe(true);
    expect(hasFlagValue(spec.args, "--effort", "max")).toBe(true);
  });

  it("resumes Claude with --continue when there is no prior session id", () => {
    const spec = claudeCodeLauncher.buildPtyLaunch(
      createSession({ provider: "claude-code", providerData: {} }),
      "resume",
    );
    if (spec.kind !== "process") throw new Error("Expected Claude launch to spawn a process");
    expect(spec.args).toContain("--continue");
    expect(spec.args).not.toContain("--resume");
  });

  // Drift guard: every option a provider DECLARES (the UI source of truth) must be
  // consumed by that provider's launcher (the arg source of truth). This iterates
  // whatever each provider declares, so a new provider/option is covered for free.
  it("wires every declared launch option through to its launcher", () => {
    const cases: Array<{ id: string; launcher: typeof claudeCodeLauncher }> = [
      { id: "claude-code", launcher: claudeCodeLauncher },
      { id: "codex", launcher: codexLauncher },
    ];
    for (const { id, launcher } of cases) {
      const options = getProvider(id)?.launchOptions ?? [];
      expect(options.length).toBeGreaterThan(0);
      for (const opt of options) {
        const value = opt.choices.find((c) => c.value !== "")?.value;
        if (!value) throw new Error(`${id}/${opt.key} declares no concrete choice`);
        const spec = launcher.buildPtyLaunch(
          createSession({
            provider: id as Session["provider"],
            providerData: { sessionId: "sid", [opt.key]: value },
          }),
          "new",
        );
        if (spec.kind !== "process") throw new Error("Expected a process launch");
        const wiredAsFlagArg = spec.args.some(
          (arg, i) => arg.startsWith("-") && spec.args[i + 1] === value,
        );
        expect(
          wiredAsFlagArg,
          `${id}: launch option "${opt.key}"=${value} was not passed as a flag argument`,
        ).toBe(true);
      }
    }
  });
});
