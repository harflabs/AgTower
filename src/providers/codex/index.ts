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
};

registerProvider(codexProvider);
