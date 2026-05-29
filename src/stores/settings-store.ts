import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type AgentProviderType = string;
export type ThemeMode = "system" | "dark" | "light";
export type StartupBehavior = "dashboard" | "restore";
export type SessionSortOrder = "recent" | "createdAt" | "oldest" | "title" | "status";
export type WorkspaceSortOrder = "manual" | "recent" | "createdAt" | "alphabetical";

interface NotificationSettings {
  desktop: boolean;
  inApp: boolean;
  sound: boolean;
}

/** Per-provider settings (each provider stores its own key-value pairs) */
type ProviderSettingsMap = Record<string, Record<string, unknown>>;

export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)));
}

export interface SettingsState {
  defaultProvider: AgentProviderType;
  sidebarProviderFilter: AgentProviderType;
  sessionSortOrder: SessionSortOrder;
  workspaceSortOrder: WorkspaceSortOrder;
  notifications: NotificationSettings;
  startupBehavior: StartupBehavior;
  theme: ThemeMode;
  archiveAfterDays: number;
  /**
   * When true, every new session is launched inside `tmux new-session`
   * instead of spawning the provider CLI directly. Required for Claude
   * Code's experimental agent-teams split-pane mode. The user must have
   * tmux installed themselves — we do not bundle it.
   */
  launchInTmux: boolean;
  /** Default size (px) for newly-mounted session terminals; Cmd+=/-/0 keeps it in sync. */
  terminalFontSize: number;
  /** Per-provider settings keyed by provider ID */
  providerSettings: ProviderSettingsMap;

  setDefaultProvider: (provider: AgentProviderType) => void;
  setSidebarProviderFilter: (provider: AgentProviderType) => void;
  setSessionSortOrder: (order: SessionSortOrder) => void;
  setWorkspaceSortOrder: (order: WorkspaceSortOrder) => void;
  setNotifications: (notifications: Partial<NotificationSettings>) => void;
  setStartupBehavior: (behavior: StartupBehavior) => void;
  setTheme: (theme: ThemeMode) => void;
  setArchiveAfterDays: (days: number) => void;
  setLaunchInTmux: (enabled: boolean) => void;
  setTerminalFontSize: (size: number) => void;
  setProviderSetting: (providerId: string, key: string, value: unknown) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set) => ({
        defaultProvider: "claude-code",
        sidebarProviderFilter: "",
        sessionSortOrder: "recent",
        workspaceSortOrder: "manual",
        notifications: { desktop: true, inApp: true, sound: true },
        startupBehavior: "dashboard",
        theme: "system",
        archiveAfterDays: 7,
        launchInTmux: false,
        terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
        providerSettings: {},

        setDefaultProvider: (defaultProvider) => set({ defaultProvider }),
        setSidebarProviderFilter: (sidebarProviderFilter) => set({ sidebarProviderFilter }),
        setSessionSortOrder: (sessionSortOrder) => set({ sessionSortOrder }),
        setWorkspaceSortOrder: (workspaceSortOrder) => set({ workspaceSortOrder }),
        setNotifications: (updates) =>
          set((s) => ({
            notifications: { ...s.notifications, ...updates },
          })),
        setStartupBehavior: (behavior) => set({ startupBehavior: behavior }),
        setTheme: (theme) => set({ theme }),
        setArchiveAfterDays: (days) => set({ archiveAfterDays: days }),
        setLaunchInTmux: (launchInTmux) => set({ launchInTmux }),
        setTerminalFontSize: (size) => set({ terminalFontSize: clampTerminalFontSize(size) }),

        setProviderSetting: (providerId, key, value) =>
          set((s) => ({
            providerSettings: {
              ...s.providerSettings,
              [providerId]: {
                ...(s.providerSettings[providerId] ?? {}),
                [key]: value,
              },
            },
          })),
      }),
      { name: "agtower-settings" },
    ),
    { name: "settings-store" },
  ),
);
