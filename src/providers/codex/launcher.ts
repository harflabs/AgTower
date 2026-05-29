import { sanitizeConfiguredEnvVars } from "@/providers/shared/configured-env";
import type { ProviderLauncherConfig, PtyLaunchSpec } from "@/providers/types";
import type { Session } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";

type CommandMode = "new" | "resume";

function getConfiguredEnvVars() {
  const envVars = useSettingsStore.getState().providerSettings.codex?.envVars as
    | Record<string, unknown>
    | undefined;
  return sanitizeConfiguredEnvVars(envVars);
}

function buildCodexLaunch(session: Session, mode: CommandMode = "new"): PtyLaunchSpec {
  const configuredPath = (
    useSettingsStore.getState().providerSettings.codex?.cliPath as string | undefined
  )?.trim();
  const parts: string[] = [configuredPath || "codex"];
  const pd = session.providerData ?? {};
  const threadId = pd.threadId as string | null;
  const askForApproval = pd.askForApproval as string | null;
  const sandbox = pd.sandbox as string | null;

  // Bare BEL notifications are a defence-in-depth fallback — if the push-hook
  // below ever misses (e.g. `notify` stripped by a user override), the PTY
  // reader still detects `\x07` and flips the session to NeedsAttention.
  parts.push("-c", "tui.notification_method=bel");

  // Codex fires the `notify` script on each turn-complete. Treat that as
  // "user needs to look" → NeedsAttention. The focus handler flips it to
  // Idle once the user actually views the session. `$AGTOWER_SESSION_ID`
  // is injected into the PTY env by the Rust backend, and the helper finds
  // the control socket via `$AGTOWER_SOCKET_PATH`.
  parts.push("-c", 'notify=["bash","-c","agtower-hook set-status needsAttention"]');

  if (mode === "resume") {
    if (threadId) {
      parts.push("resume", threadId);
    } else {
      // Can't resume without a thread ID — fall through to new session
      const prompt = session.prompt ?? "";
      if (prompt) {
        parts.push(prompt);
      }
    }
  } else {
    const prompt = session.prompt ?? "";
    if (prompt) {
      parts.push(prompt);
    }
  }

  // Only add flags for new sessions (not resume)
  if (mode !== "resume" || !threadId) {
    if (session.model) {
      parts.push("--model", session.model);
    }

    if (askForApproval) {
      parts.push("--ask-for-approval", askForApproval);
    }

    if (sandbox) {
      parts.push("--sandbox", sandbox);
    }
  }

  const [program, ...args] = parts;
  return {
    kind: "process",
    program,
    args,
    env: getConfiguredEnvVars(),
  };
}

export const codexLauncher: ProviderLauncherConfig = {
  buildPtyLaunch: (session: Session, mode: "new" | "resume") => buildCodexLaunch(session, mode),
};
