import { sanitizeConfiguredEnvVars } from "@/providers/shared/configured-env";
import type { ProviderLauncherConfig, PtyLaunchSpec } from "@/providers/types";
import type { Session } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";

type CommandMode = "new" | "resume";

function getConfiguredEnvVars() {
  const envVars = useSettingsStore.getState().providerSettings["claude-code"]?.envVars as
    | Record<string, unknown>
    | undefined;
  return sanitizeConfiguredEnvVars(envVars);
}

/**
 * Inline Claude Code settings that wire every lifecycle hook we care about
 * into `agtower-hook`. Claude's `--settings <json>` flag merges additively
 * with the user's own `~/.claude/settings.json`, so we never have to touch
 * their file.
 *
 * `$AGTOWER_SESSION_ID` is exported into the PTY by the Rust backend; the
 * hook helper reads it to know which session to update.
 */
const CLAUDE_HOOKS_SETTINGS = JSON.stringify({
  hooks: {
    UserPromptSubmit: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "agtower-hook set-status running", timeout: 5 }],
      },
    ],
    Stop: [
      {
        matcher: "",
        // Claude finished responding — user needs to look. Flip to
        // needsAttention; the focus handler transitions to idle once the
        // user actually views the session.
        hooks: [{ type: "command", command: "agtower-hook set-status needsAttention", timeout: 5 }],
      },
    ],
    Notification: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "agtower-hook set-status needsAttention", timeout: 5 }],
      },
    ],
    SessionEnd: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "agtower-hook set-status closed", timeout: 1 }],
      },
    ],
    PreToolUse: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "agtower-hook set-status running", timeout: 2 }],
      },
    ],
  },
});

function buildClaudeLaunch(session: Session, mode: CommandMode = "new"): PtyLaunchSpec {
  const configuredPath = (
    useSettingsStore.getState().providerSettings["claude-code"]?.cliPath as string | undefined
  )?.trim();
  const parts: string[] = [configuredPath || "claude"];
  const pd = session.providerData ?? {};
  const providerSessionId = pd.sessionId as string | null;
  const effort = pd.effort as string | null;
  const permissionMode = pd.permissionMode as string | null;

  if (mode === "resume") {
    if (providerSessionId) {
      parts.push("--resume", providerSessionId);
    } else {
      parts.push("--continue");
    }
  } else {
    if (providerSessionId) {
      parts.push("--session-id", providerSessionId);
    }

    const prompt = session.prompt ?? "";
    if (prompt) {
      parts.push("-p", prompt);
    }
  }

  if (session.title) {
    parts.push("--name", session.title);
  }

  // Don't pass --model at all. Claude Code selects its own model from
  // its config / the user's settings. AgTower is a launcher, not a model
  // picker.

  if (effort) {
    parts.push("--effort", effort);
  }

  if (permissionMode) {
    parts.push("--permission-mode", permissionMode);
  }

  // Inject lifecycle hooks that push session state into AgTower's control
  // socket. `--settings` merges with the user's ~/.claude/settings.json
  // rather than replacing it, so this is non-destructive.
  parts.push("--settings", CLAUDE_HOOKS_SETTINGS);

  const [program, ...args] = parts;
  return {
    kind: "process",
    program,
    args,
    env: getConfiguredEnvVars(),
  };
}

export const claudeCodeLauncher: ProviderLauncherConfig = {
  buildPtyLaunch: (session: Session, mode: "new" | "resume") => buildClaudeLaunch(session, mode),
};
