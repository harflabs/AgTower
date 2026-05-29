import { completeOnboarding, type HistoryImportPreference } from "@/lib/onboarding-state";
import {
  setDefaultProviderPreference,
  setDesktopNotificationsEnabled,
} from "@/lib/settings-actions";
import { importProviderHistory, type SetupAssistantSnapshot } from "@/lib/setup-assistant";
import { useSettingsStore } from "@/stores/settings-store";
import type { ProviderChoice } from "./setup-assistant-model";

export interface FinishSetupAssistantResult {
  imports: Array<{
    providerId: ProviderChoice;
    imported: number;
    skipped: number;
    errors: number;
  }>;
  warnings: string[];
}

interface FinishSetupAssistantFlowOptions {
  desktopNotificationsEnabled: boolean;
  historyImportPreference: HistoryImportPreference;
  selectedProvider: ProviderChoice;
  snapshot: SetupAssistantSnapshot | null;
  completeOnboardingFn?: typeof completeOnboarding;
  importProviderHistoryFn?: typeof importProviderHistory;
  setDefaultProviderPreferenceFn?: typeof setDefaultProviderPreference;
  setDesktopNotificationsEnabledFn?: typeof setDesktopNotificationsEnabled;
}

export function getPendingImportProviderIds(
  snapshot: SetupAssistantSnapshot | null,
  historyImportPreference: HistoryImportPreference,
): ProviderChoice[] {
  if (historyImportPreference !== "auto" || !snapshot) return [];

  return snapshot.providers
    .filter((provider) => provider.status === "ready" && provider.history.importableCount > 0)
    .map((provider) => provider.id);
}

function getProviderLabel(providerId: ProviderChoice) {
  return providerId === "claude-code" ? "Claude Code" : "Codex";
}

export async function finishSetupAssistantFlow({
  desktopNotificationsEnabled,
  historyImportPreference,
  selectedProvider,
  snapshot,
  completeOnboardingFn = completeOnboarding,
  importProviderHistoryFn = importProviderHistory,
  setDefaultProviderPreferenceFn = setDefaultProviderPreference,
  setDesktopNotificationsEnabledFn = setDesktopNotificationsEnabled,
}: FinishSetupAssistantFlowOptions): Promise<FinishSetupAssistantResult> {
  if (!snapshot) {
    throw new Error("Refresh provider checks before finishing setup");
  }

  const selectedProviderState = snapshot.providers.find(
    (provider) => provider.id === selectedProvider,
  );
  if (selectedProviderState?.status !== "ready") {
    throw new Error("Choose a ready provider before finishing setup");
  }

  const pendingProviders = getPendingImportProviderIds(snapshot, historyImportPreference);
  const imports: FinishSetupAssistantResult["imports"] = [];
  const warnings: string[] = [];
  const settings = useSettingsStore.getState();
  const previousDefaultProvider = settings.defaultProvider;
  const previousDesktopNotificationsEnabled = settings.notifications.desktop;
  let defaultProviderApplied = false;
  let desktopNotificationsApplied = false;

  try {
    await setDesktopNotificationsEnabledFn(desktopNotificationsEnabled);
    desktopNotificationsApplied = true;

    setDefaultProviderPreferenceFn(selectedProvider);
    defaultProviderApplied = true;

    await completeOnboardingFn(historyImportPreference);
  } catch (error) {
    if (defaultProviderApplied && previousDefaultProvider !== selectedProvider) {
      setDefaultProviderPreferenceFn(previousDefaultProvider);
    }

    if (
      desktopNotificationsApplied &&
      previousDesktopNotificationsEnabled !== desktopNotificationsEnabled
    ) {
      try {
        await setDesktopNotificationsEnabledFn(previousDesktopNotificationsEnabled);
      } catch (rollbackError) {
        console.error(
          "[setup-assistant] Failed to roll back desktop notifications after setup failure:",
          rollbackError,
        );
      }
    }

    throw error;
  }

  for (const providerId of pendingProviders) {
    const providerLabel = getProviderLabel(providerId);

    try {
      const result = await importProviderHistoryFn(providerId);
      imports.push({
        providerId,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      });

      if (result.errors > 0) {
        warnings.push(
          `Some ${providerLabel} history could not be imported. You can retry from Settings.`,
        );
      }
    } catch (error) {
      console.error(`[setup-assistant] Failed to import ${providerLabel} history:`, error);
      imports.push({
        providerId,
        imported: 0,
        skipped: 0,
        errors: 1,
      });
      warnings.push(`Failed to import ${providerLabel} history. You can retry from Settings.`);
    }
  }

  return { imports, warnings };
}
