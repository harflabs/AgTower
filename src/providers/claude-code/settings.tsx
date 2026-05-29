import { detectClaude } from "@/providers/claude-code/types";
import { ProviderSettingsSection } from "@/providers/shared/provider-settings-section";

export function ClaudeCodeSettings() {
  return (
    <ProviderSettingsSection
      providerId="claude-code"
      title="Claude Code"
      description="Claude Code provider configuration and defaults"
      versionLabel="Claude Code CLI"
      notFoundLabel="Claude Code CLI not found"
      cliLabel="Claude Code CLI path"
      cliPlaceholder="e.g. /usr/local/bin/claude"
      defaultModelPlaceholder="e.g. claude-sonnet-4-5-20250514"
      envDescription="Passed to agent processes"
      detectCli={detectClaude}
    />
  );
}
