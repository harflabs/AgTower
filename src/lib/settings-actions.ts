import type { EngineSettings } from "@/lib/engine";
import { updateEngineSetting } from "@/lib/engine";
import { requestNotificationPermission } from "@/lib/notifications";
import type { AgentProviderType, StartupBehavior, ThemeMode } from "@/stores/settings-store";
import { useSettingsStore } from "@/stores/settings-store";

export function applyEngineSettings(settings: EngineSettings): void {
  const store = useSettingsStore.getState();
  store.setArchiveAfterDays(settings.archiveAfterDays);
  store.setNotifications({
    desktop: settings.notificationsEnabled,
    sound: settings.notificationSound,
  });
}

export function setThemeMode(theme: ThemeMode): void {
  useSettingsStore.getState().setTheme(theme);
}

export function setStartupBehaviorPreference(behavior: StartupBehavior): void {
  useSettingsStore.getState().setStartupBehavior(behavior);
}

export function setDefaultProviderPreference(provider: AgentProviderType): void {
  useSettingsStore.getState().setDefaultProvider(provider);
}

export function setSidebarProviderFilterPreference(provider: AgentProviderType): void {
  useSettingsStore.getState().setSidebarProviderFilter(provider);
}

export function setInAppNotificationsEnabled(enabled: boolean): void {
  useSettingsStore.getState().setNotifications({ inApp: enabled });
}

export function setLaunchInTmuxEnabled(enabled: boolean): void {
  useSettingsStore.getState().setLaunchInTmux(enabled);
}

export async function setDesktopNotificationsEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    const granted = await requestNotificationPermission();
    if (!granted) {
      throw new Error("Notification permission was not granted");
    }
  }

  const store = useSettingsStore.getState();
  const previous = store.notifications.desktop;
  if (previous === enabled) return;

  store.setNotifications({ desktop: enabled });

  try {
    await updateEngineSetting("notificationsEnabled", String(enabled));
  } catch (error) {
    useSettingsStore.getState().setNotifications({ desktop: previous });
    throw error;
  }
}

export async function setNotificationSoundEnabled(enabled: boolean): Promise<void> {
  const store = useSettingsStore.getState();
  const previous = store.notifications.sound;
  if (previous === enabled) return;

  store.setNotifications({ sound: enabled });

  try {
    await updateEngineSetting("notificationSound", String(enabled));
  } catch (error) {
    useSettingsStore.getState().setNotifications({ sound: previous });
    throw error;
  }
}

export async function setArchiveAfterDays(days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("Auto-archive days must be at least 1");
  }

  const store = useSettingsStore.getState();
  const previous = store.archiveAfterDays;
  if (previous === days) return;

  store.setArchiveAfterDays(days);

  try {
    await updateEngineSetting("archiveAfterDays", String(days));
  } catch (error) {
    useSettingsStore.getState().setArchiveAfterDays(previous);
    throw error;
  }
}
