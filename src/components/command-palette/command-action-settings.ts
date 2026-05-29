import { toast } from "sonner";
import {
  setArchiveAfterDays,
  setDefaultProviderPreference,
  setDesktopNotificationsEnabled,
  setInAppNotificationsEnabled,
  setNotificationSoundEnabled,
  setSidebarProviderFilterPreference,
  setStartupBehaviorPreference,
  setThemeMode,
} from "@/lib/settings-actions";
import type { StartupBehavior, ThemeMode } from "@/stores/settings-store";
import { buildSettingPreview, providerName, providerSessionName } from "./command-action-shared";
import type { PaletteContext, PaletteItem } from "./model";

const THEME_LABELS: Record<ThemeMode, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};

const STARTUP_LABELS: Record<StartupBehavior, string> = {
  dashboard: "Dashboard",
  restore: "Restore Last View",
};

export function createThemeItems(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const currentThemeLabel = THEME_LABELS[ctx.settings.theme];
  const themeOptions = [
    { value: "system", title: "Set Theme to System", iconName: "Laptop" },
    { value: "dark", title: "Set Theme to Dark", iconName: "Moon" },
    { value: "light", title: "Set Theme to Light", iconName: "Sun" },
  ] as const;

  for (const option of themeOptions) {
    items.push({
      id: `setting:theme:${option.value}`,
      kind: "setting",
      title: option.title,
      subtitle: "Appearance",
      aliases: ["theme", "appearance", option.value],
      keywords: [option.value, "theme", "appearance"],
      iconName: option.iconName,
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: option.value === "dark" ? 10 : option.value === "system" ? 11 : 12,
      queryOrder: 84,
      currentValue: currentThemeLabel,
      preview: buildSettingPreview("Choose how AgTower looks.", currentThemeLabel),
      when: () => ctx.settings.theme !== option.value,
      perform: () => setThemeMode(option.value),
    });
  }

  return items;
}

export function createStartupItems(ctx: PaletteContext): PaletteItem[] {
  const currentStartupLabel = STARTUP_LABELS[ctx.settings.startupBehavior];

  return [
    {
      id: "setting:startup:dashboard",
      kind: "setting",
      title: "Show Dashboard on Startup",
      subtitle: "Startup behavior",
      aliases: ["startup dashboard", "launch dashboard"],
      keywords: ["startup", "dashboard", "launch"],
      iconName: "LayoutDashboard",
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: 30,
      queryOrder: 72,
      currentValue: currentStartupLabel,
      preview: buildSettingPreview(
        "Open the dashboard when the app launches.",
        currentStartupLabel,
      ),
      when: () => ctx.settings.startupBehavior !== "dashboard",
      perform: () => setStartupBehaviorPreference("dashboard"),
    },
    {
      id: "setting:startup:restore",
      kind: "setting",
      title: "Restore Last Session on Startup",
      subtitle: "Startup behavior",
      aliases: ["startup restore", "launch last session"],
      keywords: ["startup", "restore", "session", "launch"],
      iconName: "History",
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: 31,
      queryOrder: 72,
      currentValue: currentStartupLabel,
      preview: buildSettingPreview(
        "Restore the last active session when the app launches.",
        currentStartupLabel,
      ),
      when: () => ctx.settings.startupBehavior !== "restore",
      perform: () => setStartupBehaviorPreference("restore"),
    },
  ];
}

export function createNotificationItems(ctx: PaletteContext): PaletteItem[] {
  const notifications = ctx.settings.notifications;

  return [
    {
      id: "setting:notifications:desktop:on",
      kind: "setting",
      title: "Enable Desktop Notifications",
      subtitle: "System alerts",
      aliases: ["turn on desktop notifications", "alerts on"],
      keywords: ["desktop", "notifications", "alerts", "native"],
      iconName: "Bell",
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: 20,
      queryOrder: 76,
      currentValue: notifications.desktop ? "On" : "Off",
      preview: buildSettingPreview(
        "Show native desktop notifications when agents finish or error.",
        notifications.desktop ? "On" : "Off",
      ),
      when: () => !notifications.desktop,
      perform: async () => {
        try {
          await setDesktopNotificationsEnabled(true);
        } catch (error) {
          toast.error(`Failed to enable desktop notifications: ${String(error)}`);
        }
      },
    },
    {
      id: "setting:notifications:desktop:off",
      kind: "setting",
      title: "Disable Desktop Notifications",
      subtitle: "System alerts",
      aliases: ["turn off desktop notifications", "alerts off"],
      keywords: ["desktop", "notifications", "alerts", "native"],
      iconName: "Bell",
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: 20,
      queryOrder: 76,
      currentValue: notifications.desktop ? "On" : "Off",
      preview: buildSettingPreview(
        "Stop showing native desktop notifications.",
        notifications.desktop ? "On" : "Off",
      ),
      when: () => notifications.desktop,
      perform: async () => {
        try {
          await setDesktopNotificationsEnabled(false);
        } catch (error) {
          toast.error(`Failed to disable desktop notifications: ${String(error)}`);
        }
      },
    },
    {
      id: "setting:notifications:inapp:on",
      kind: "setting",
      title: "Enable In-App Toasts",
      subtitle: "In-app notifications",
      aliases: ["turn on toasts", "show toasts"],
      keywords: ["toast", "notifications", "in-app"],
      iconName: "BellRing",
      group: "Settings",
      queryOrder: 70,
      currentValue: notifications.inApp ? "On" : "Off",
      preview: buildSettingPreview(
        "Show toast notifications inside the app.",
        notifications.inApp ? "On" : "Off",
      ),
      when: () => !notifications.inApp,
      perform: () => setInAppNotificationsEnabled(true),
    },
    {
      id: "setting:notifications:inapp:off",
      kind: "setting",
      title: "Disable In-App Toasts",
      subtitle: "In-app notifications",
      aliases: ["turn off toasts", "hide toasts"],
      keywords: ["toast", "notifications", "in-app"],
      iconName: "BellRing",
      group: "Settings",
      queryOrder: 70,
      currentValue: notifications.inApp ? "On" : "Off",
      preview: buildSettingPreview(
        "Stop showing toast notifications inside the app.",
        notifications.inApp ? "On" : "Off",
      ),
      when: () => notifications.inApp,
      perform: () => setInAppNotificationsEnabled(false),
    },
    {
      id: "setting:notifications:sound:on",
      kind: "setting",
      title: "Enable Notification Sound",
      subtitle: "Sound",
      aliases: ["unmute notifications", "turn on sound"],
      keywords: ["sound", "notifications", "audio", "unmute"],
      iconName: "Volume2",
      group: "Settings",
      queryOrder: 68,
      currentValue: notifications.sound ? "On" : "Off",
      preview: buildSettingPreview(
        "Play a sound when agents finish or error.",
        notifications.sound ? "On" : "Off",
      ),
      when: () => !notifications.sound,
      perform: async () => {
        try {
          await setNotificationSoundEnabled(true);
        } catch (error) {
          toast.error(`Failed to enable notification sound: ${String(error)}`);
        }
      },
    },
    {
      id: "setting:notifications:sound:off",
      kind: "setting",
      title: "Disable Notification Sound",
      subtitle: "Sound",
      aliases: ["mute notifications", "turn off sound"],
      keywords: ["sound", "notifications", "audio", "mute"],
      iconName: "Volume2",
      group: "Settings",
      queryOrder: 68,
      currentValue: notifications.sound ? "On" : "Off",
      preview: buildSettingPreview(
        "Stop playing sound when agents finish or error.",
        notifications.sound ? "On" : "Off",
      ),
      when: () => notifications.sound,
      perform: async () => {
        try {
          await setNotificationSoundEnabled(false);
        } catch (error) {
          toast.error(`Failed to disable notification sound: ${String(error)}`);
        }
      },
    },
  ];
}

export function createProviderItems(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "setting:sidebar-provider:all",
      kind: "setting",
      title: "Show All Providers in Sidebar",
      subtitle: "Sidebar filter",
      aliases: ["sidebar filter all providers", "clear provider filter"],
      keywords: ["sidebar", "provider", "filter", "all"],
      iconName: "Layers3",
      group: "Settings",
      queryOrder: 58,
      currentValue:
        ctx.settings.sidebarProviderFilter === ""
          ? "All providers"
          : providerName(ctx.settings.sidebarProviderFilter, ctx),
      preview: buildSettingPreview(
        "Show sessions from every provider in the sidebar.",
        ctx.settings.sidebarProviderFilter === ""
          ? "All providers"
          : providerName(ctx.settings.sidebarProviderFilter, ctx),
      ),
      when: () => ctx.settings.sidebarProviderFilter !== "",
      perform: () => setSidebarProviderFilterPreference(""),
    },
  ];

  for (const provider of ctx.providers) {
    items.push({
      id: `setting:provider:default:${provider.id}`,
      kind: "setting",
      title: `Use ${provider.displayName} by Default`,
      subtitle: "Default provider",
      aliases: [
        "default provider",
        `switch default provider to ${provider.displayName}`,
        `switch default provider to ${providerSessionName(provider.id, ctx)}`,
        `use ${provider.displayName} by default`,
        `use ${providerSessionName(provider.id, ctx)} by default`,
        provider.id,
        provider.displayName,
      ],
      keywords: ["provider", "default", provider.id, provider.displayName],
      iconName: "Cpu",
      group: "Settings",
      homeSection: "Quick Settings",
      homeOrder: 40,
      queryOrder: 74,
      currentValue: providerName(ctx.settings.defaultProvider, ctx),
      preview: buildSettingPreview(
        "Choose the default provider for new sessions.",
        providerName(ctx.settings.defaultProvider, ctx),
      ),
      when: () => ctx.settings.defaultProvider !== provider.id,
      perform: () => setDefaultProviderPreference(provider.id),
    });
    items.push({
      id: `setting:sidebar-provider:${provider.id}`,
      kind: "setting",
      title: `Filter Sidebar to ${provider.displayName}`,
      subtitle: "Sidebar filter",
      aliases: [
        "sidebar provider filter",
        `show ${provider.displayName} sessions`,
        `show ${providerSessionName(provider.id, ctx)} sessions`,
        `show ${provider.id} sessions`,
        provider.id,
        provider.displayName,
      ],
      keywords: ["sidebar", "provider", "filter", provider.id, provider.displayName],
      iconName: "Layers3",
      group: "Settings",
      queryOrder: 58,
      currentValue:
        ctx.settings.sidebarProviderFilter === ""
          ? "All providers"
          : providerName(ctx.settings.sidebarProviderFilter, ctx),
      preview: buildSettingPreview(
        "Only show sessions from this provider in the sidebar.",
        ctx.settings.sidebarProviderFilter === ""
          ? "All providers"
          : providerName(ctx.settings.sidebarProviderFilter, ctx),
      ),
      when: () => ctx.settings.sidebarProviderFilter !== provider.id,
      perform: () => setSidebarProviderFilterPreference(provider.id),
    });

    items.push({
      id: `provider:${provider.id}`,
      kind: "provider",
      title: `Open ${provider.displayName} Settings`,
      subtitle: "Provider settings",
      aliases: [
        provider.id,
        provider.displayName,
        `${provider.displayName} settings`,
        `${providerSessionName(provider.id, ctx)} settings`,
        `open ${provider.displayName} settings`,
        "provider settings",
      ],
      keywords: ["provider", "settings", provider.id, provider.displayName],
      iconName: "Cpu",
      group: "Providers",
      queryOrder: 48,
      preview: {
        title: provider.displayName,
        summary: `Jump to the ${provider.displayName} settings section.`,
      },
      meta: {
        providerId: provider.id,
      },
      perform: (runtime) => runtime.navigate(`/settings?section=provider-${provider.id}`),
    });
  }

  return items;
}

export function createAutoArchiveItems(ctx: PaletteContext): PaletteItem[] {
  return [1, 3, 7, 14, 30].map((days, index) => ({
    id: `setting:auto-archive:${days}`,
    kind: "setting",
    title: `Auto-Archive Closed Sessions After ${days} Day${days === 1 ? "" : "s"}`,
    subtitle: "Auto-archive",
    aliases: [`archive after ${days}`, "auto archive"],
    keywords: ["archive", "auto-archive", String(days)],
    iconName: "Archive",
    group: "Settings",
    queryOrder: 60 - index,
    currentValue: `${ctx.settings.archiveAfterDays} days`,
    preview: buildSettingPreview(
      "Choose when closed sessions move to Archived.",
      `${ctx.settings.archiveAfterDays} days`,
    ),
    when: () => ctx.settings.archiveAfterDays !== days,
    perform: () => setArchiveAfterDays(days),
  }));
}
