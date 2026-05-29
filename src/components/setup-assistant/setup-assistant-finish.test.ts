import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishSetupAssistantFlow,
  getPendingImportProviderIds,
} from "@/components/setup-assistant/setup-assistant-finish";
import type { SetupAssistantSnapshot } from "@/lib/setup-assistant";
import { useSettingsStore } from "@/stores/settings-store";

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

function createSnapshot(overrides?: Partial<SetupAssistantSnapshot>): SetupAssistantSnapshot {
  return {
    providers: [
      {
        id: "claude-code",
        displayName: "Claude Code",
        cliPath: "",
        status: "ready",
        version: "1.0.0",
        detail: "Ready",
        history: {
          alreadyImportedCount: 0,
          importableCount: 2,
          runningCount: 0,
          preview: [],
        },
      },
      {
        id: "codex",
        displayName: "Codex",
        cliPath: "",
        status: "ready",
        version: "1.0.0",
        detail: "Ready",
        history: {
          alreadyImportedCount: 0,
          importableCount: 0,
          runningCount: 1,
          preview: [],
        },
      },
    ],
    tools: [],
    totalImportableCount: 2,
    ...overrides,
  };
}

describe("setup assistant finish flow", () => {
  beforeEach(() => {
    resetSettingsStore();
  });

  it("only auto-imports providers with pending importable history", () => {
    expect(getPendingImportProviderIds(null, "auto")).toEqual([]);
    expect(getPendingImportProviderIds(createSnapshot(), "manual")).toEqual([]);
    expect(getPendingImportProviderIds(createSnapshot(), "auto")).toEqual(["claude-code"]);
  });

  it("completes onboarding before importing history", async () => {
    const importProviderHistoryFn = vi
      .fn()
      .mockResolvedValue({ imported: 2, skipped: 0, errors: 0 });
    const setDefaultProviderPreferenceFn = vi.fn();
    const setDesktopNotificationsEnabledFn = vi.fn().mockResolvedValue(undefined);
    const completeOnboardingFn = vi.fn().mockResolvedValue(undefined);

    const result = await finishSetupAssistantFlow({
      desktopNotificationsEnabled: true,
      historyImportPreference: "auto",
      selectedProvider: "codex",
      snapshot: createSnapshot(),
      importProviderHistoryFn,
      setDefaultProviderPreferenceFn,
      setDesktopNotificationsEnabledFn,
      completeOnboardingFn,
    });

    expect(importProviderHistoryFn).toHaveBeenCalledWith("claude-code");
    expect(setDefaultProviderPreferenceFn).toHaveBeenCalledWith("codex");
    expect(setDesktopNotificationsEnabledFn).toHaveBeenCalledWith(true);
    expect(completeOnboardingFn).toHaveBeenCalledWith("auto");
    expect(result.imports).toEqual([
      {
        providerId: "claude-code",
        imported: 2,
        skipped: 0,
        errors: 0,
      },
    ]);
    expect(result.warnings).toEqual([]);

    const importOrder = importProviderHistoryFn.mock.invocationCallOrder[0];
    const completeOrder = completeOnboardingFn.mock.invocationCallOrder[0];
    expect(completeOrder).toBeLessThan(importOrder);
  });

  it("stops and surfaces notification persistence failures", async () => {
    const completeOnboardingFn = vi.fn().mockResolvedValue(undefined);
    const setDesktopNotificationsEnabledFn = vi.fn().mockRejectedValue(new Error("boom"));
    const setDefaultProviderPreferenceFn = vi.fn();

    await expect(
      finishSetupAssistantFlow({
        desktopNotificationsEnabled: false,
        historyImportPreference: "manual",
        selectedProvider: "claude-code",
        snapshot: createSnapshot(),
        importProviderHistoryFn: vi.fn(),
        setDefaultProviderPreferenceFn,
        setDesktopNotificationsEnabledFn,
        completeOnboardingFn,
      }),
    ).rejects.toThrow("boom");

    expect(completeOnboardingFn).not.toHaveBeenCalled();
    expect(setDefaultProviderPreferenceFn).not.toHaveBeenCalled();
  });

  it("rolls back settings if onboarding completion fails", async () => {
    const setDefaultProviderPreferenceFn = vi.fn((provider: string) => {
      useSettingsStore.setState({ defaultProvider: provider });
    });
    const setDesktopNotificationsEnabledFn = vi.fn(async (enabled: boolean) => {
      useSettingsStore.getState().setNotifications({ desktop: enabled });
    });

    await expect(
      finishSetupAssistantFlow({
        desktopNotificationsEnabled: true,
        historyImportPreference: "manual",
        selectedProvider: "codex",
        snapshot: createSnapshot(),
        importProviderHistoryFn: vi.fn(),
        setDefaultProviderPreferenceFn,
        setDesktopNotificationsEnabledFn,
        completeOnboardingFn: vi.fn().mockRejectedValue(new Error("boom")),
      }),
    ).rejects.toThrow("boom");

    expect(useSettingsStore.getState().defaultProvider).toBe("claude-code");
    expect(useSettingsStore.getState().notifications.desktop).toBe(false);
  });

  it("keeps setup completion successful when history import reports warnings", async () => {
    const result = await finishSetupAssistantFlow({
      desktopNotificationsEnabled: true,
      historyImportPreference: "auto",
      selectedProvider: "claude-code",
      snapshot: createSnapshot(),
      importProviderHistoryFn: vi.fn().mockResolvedValue({ imported: 1, skipped: 0, errors: 1 }),
      setDefaultProviderPreferenceFn: vi.fn(),
      setDesktopNotificationsEnabledFn: vi.fn().mockResolvedValue(undefined),
      completeOnboardingFn: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.imports).toEqual([
      {
        providerId: "claude-code",
        imported: 1,
        skipped: 0,
        errors: 1,
      },
    ]);
    expect(result.warnings).toEqual([
      "Some Claude Code history could not be imported. You can retry from Settings.",
    ]);
  });

  it("rejects when the selected provider is not ready", async () => {
    const snapshot = createSnapshot({
      providers: [
        {
          ...createSnapshot().providers[0],
          status: "available",
        },
        createSnapshot().providers[1],
      ],
    });

    await expect(
      finishSetupAssistantFlow({
        desktopNotificationsEnabled: false,
        historyImportPreference: "manual",
        selectedProvider: "claude-code",
        snapshot,
        importProviderHistoryFn: vi.fn(),
        setDefaultProviderPreferenceFn: vi.fn(),
        setDesktopNotificationsEnabledFn: vi.fn().mockResolvedValue(undefined),
        completeOnboardingFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("Choose a ready provider before finishing setup");
  });
});
