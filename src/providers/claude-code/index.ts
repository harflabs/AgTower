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
  launchOptions: [
    {
      key: "permissionMode",
      label: "Permission mode",
      description: "Passed as --permission-mode",
      choices: [
        { value: "", label: "Provider default" },
        { value: "default", label: "default" },
        { value: "acceptEdits", label: "acceptEdits" },
        { value: "auto", label: "auto" },
        { value: "plan", label: "plan" },
        { value: "dontAsk", label: "dontAsk" },
        { value: "bypassPermissions", label: "bypassPermissions" },
      ],
    },
    {
      key: "effort",
      label: "Reasoning effort",
      description: "Passed as --effort",
      choices: [
        { value: "", label: "Provider default" },
        { value: "low", label: "low" },
        { value: "medium", label: "medium" },
        { value: "high", label: "high" },
        { value: "xhigh", label: "xhigh" },
        { value: "max", label: "max" },
      ],
    },
  ],
};

registerProvider(claudeCodeProvider);
