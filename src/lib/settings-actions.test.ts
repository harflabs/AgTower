import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestNotificationPermissionMock, updateEngineSettingMock } = vi.hoisted(() => ({
  requestNotificationPermissionMock: vi.fn(),
  updateEngineSettingMock: vi.fn(),
}));

vi.mock("@/lib/engine", () => ({
  updateEngineSetting: updateEngineSettingMock,
}));

vi.mock("@/lib/notifications", () => ({
  requestNotificationPermission: requestNotificationPermissionMock,
}));

import {
  applyEngineSettings,
  setArchiveAfterDays,
  setDesktopNotificationsEnabled,
  setNotificationSoundEnabled,
} from "@/lib/settings-actions";
import { useSettingsStore } from "@/stores/settings-store";

const DEFAULT_SETTINGS = {
  archiveAfterDays: 7,
  defaultProvider: "claude-code",
  launchInTmux: false,
  notifications: {
    desktop: true,
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

describe("settings actions", () => {
  beforeEach(() => {
    resetSettingsStore();
    requestNotificationPermissionMock.mockReset();
    updateEngineSettingMock.mockReset();
  });

  it("applies engine-owned settings into the client store", () => {
    applyEngineSettings({
      archiveAfterDays: 14,
      notificationsEnabled: false,
      notificationSound: false,
    });

    expect(useSettingsStore.getState().archiveAfterDays).toBe(14);
    expect(useSettingsStore.getState().notifications).toEqual({
      desktop: false,
      inApp: true,
      sound: false,
    });
  });

  it("updates desktop notifications when permission and engine persistence succeed", async () => {
    useSettingsStore.getState().setNotifications({ desktop: false });
    requestNotificationPermissionMock.mockResolvedValue(true);
    updateEngineSettingMock.mockResolvedValue(undefined);

    await setDesktopNotificationsEnabled(true);

    expect(requestNotificationPermissionMock).toHaveBeenCalledOnce();
    expect(updateEngineSettingMock).toHaveBeenCalledWith("notificationsEnabled", "true");
    expect(useSettingsStore.getState().notifications.desktop).toBe(true);
  });

  it("keeps desktop notifications unchanged when permission is denied", async () => {
    useSettingsStore.getState().setNotifications({ desktop: false });
    requestNotificationPermissionMock.mockResolvedValue(false);

    await expect(setDesktopNotificationsEnabled(true)).rejects.toThrow(
      "Notification permission was not granted",
    );

    expect(updateEngineSettingMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().notifications.desktop).toBe(false);
  });

  it("rolls back desktop notifications if engine persistence fails", async () => {
    useSettingsStore.getState().setNotifications({ desktop: false });
    requestNotificationPermissionMock.mockResolvedValue(true);
    updateEngineSettingMock.mockRejectedValue(new Error("boom"));

    await expect(setDesktopNotificationsEnabled(true)).rejects.toThrow("boom");

    expect(useSettingsStore.getState().notifications.desktop).toBe(false);
  });

  it("rolls back notification sound if engine persistence fails", async () => {
    updateEngineSettingMock.mockRejectedValue(new Error("boom"));

    await expect(setNotificationSoundEnabled(false)).rejects.toThrow("boom");

    expect(useSettingsStore.getState().notifications.sound).toBe(true);
  });

  it("rolls back archiveAfterDays if engine persistence fails", async () => {
    updateEngineSettingMock.mockRejectedValue(new Error("boom"));

    await expect(setArchiveAfterDays(14)).rejects.toThrow("boom");

    expect(useSettingsStore.getState().archiveAfterDays).toBe(7);
  });
});
