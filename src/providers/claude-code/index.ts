import {
  formatClaudeModelName,
  formatClaudeTokenSummary,
  getClaudeActivityText,
  getClaudeProviderSessionId,
  preprocessClaudePrompt,
} from "@/providers/claude-code/format";
import { claudeCodeLauncher } from "@/providers/claude-code/launcher";
import { ClaudeCodeSettings } from "@/providers/claude-code/settings";
import { detectClaude } from "@/providers/claude-code/types";
import { registerProvider } from "@/providers/registry";
import type { ProviderModule } from "@/providers/types";

const claudeCodeProvider: ProviderModule = {
  id: "claude-code",
  displayName: "Claude Code",
  assistantDisplayName: "Claude",
  launcher: claudeCodeLauncher,
  settings: {
    SettingsSection: ClaudeCodeSettings,
  },
  detect: detectClaude,
  formatModelName: formatClaudeModelName,
  preprocessPrompt: preprocessClaudePrompt,
  getActivityText: getClaudeActivityText,
  formatTokenSummary: formatClaudeTokenSummary,
  getProviderSessionId: getClaudeProviderSessionId,
};

registerProvider(claudeCodeProvider);
