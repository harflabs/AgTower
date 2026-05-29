import { detectCodex } from "@/providers/codex/types";
import { ProviderSettingsSection } from "@/providers/shared/provider-settings-section";

export function CodexSettings() {
  return (
    <ProviderSettingsSection
      providerId="codex"
      title="Codex"
      description="Codex CLI provider configuration"
      versionLabel="Codex CLI"
      notFoundLabel="Codex CLI not found"
      cliLabel="Codex CLI path"
      cliPlaceholder="e.g. /usr/local/bin/codex"
      defaultModelPlaceholder="e.g. o4-mini"
      envDescription="Passed to Codex processes"
      detectCli={detectCodex}
    />
  );
}
