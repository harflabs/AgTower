import {
  formatCodexModelName,
  formatCodexTokenSummary,
  getCodexActivityText,
  getCodexProviderSessionId,
} from "@/providers/codex/format";
import { codexLauncher } from "@/providers/codex/launcher";
import { CodexSettings } from "@/providers/codex/settings";
import { detectCodex } from "@/providers/codex/types";
import { registerProvider } from "@/providers/registry";
import type { ProviderModule } from "@/providers/types";

const codexProvider: ProviderModule = {
  id: "codex",
  displayName: "Codex",
  assistantDisplayName: "Codex",
  launcher: codexLauncher,
  settings: {
    SettingsSection: CodexSettings,
  },
  detect: detectCodex,
  formatModelName: formatCodexModelName,
  getActivityText: getCodexActivityText,
  formatTokenSummary: formatCodexTokenSummary,
  getProviderSessionId: getCodexProviderSessionId,
  launchOptions: [
    {
      key: "askForApproval",
      label: "Approval policy",
      description: "Passed as --ask-for-approval",
      choices: [
        { value: "", label: "Provider default" },
        { value: "untrusted", label: "untrusted" },
        { value: "on-failure", label: "on-failure (deprecated)" },
        { value: "on-request", label: "on-request" },
        { value: "never", label: "never" },
      ],
    },
    {
      key: "sandbox",
      label: "Sandbox mode",
      description: "Passed as --sandbox",
      choices: [
        { value: "", label: "Provider default" },
        { value: "read-only", label: "read-only" },
        { value: "workspace-write", label: "workspace-write" },
        { value: "danger-full-access", label: "danger-full-access" },
      ],
    },
  ],
};

registerProvider(codexProvider);
