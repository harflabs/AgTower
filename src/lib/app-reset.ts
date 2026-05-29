import { markOnboardingRequired } from "@/lib/onboarding-state";
import { AGTOWER_RECENT_COMMANDS_KEY, AGTOWER_VIEWED_SESSIONS_KEY } from "@/lib/storage-keys";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { TERMINAL_FONT_SIZE_DEFAULT, useSettingsStore } from "@/stores/settings-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSplitViewStore } from "@/stores/split-view-store";

export function clearClientSessionState() {
  useSessionStore.setState({
    sessions: {},
    _hydrated: true,
    activeSessionId: null,
    unseenCount: 0,
  });
  useSplitViewStore.setState({
    focusedPaneId: null,
    splitPair: null,
    splitRatio: 0.5,
    draggingSessionId: null,
    draggingSessionPosition: null,
  });
  useSidebarStore.setState({
    focusedNodeId: null,
    sidebarFocusMode: false,
    keyboardNavActive: false,
    renamingSessionId: null,
  });
  localStorage.removeItem(AGTOWER_VIEWED_SESSIONS_KEY);
}

export function resetClientAppState() {
  markOnboardingRequired();
  clearClientSessionState();
  useRepoStore.setState({
    repos: {},
    activeRepoId: null,
  });
  useSettingsStore.setState({
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
  });
  useSidebarStore.setState({
    sidebarWidth: 296,
    sidebarOpen: true,
    collapsedWorkspaces: {},
    expandedHistoryByWorkspace: {},
    pinnedSessionIds: {},
    focusedNodeId: null,
    sidebarFocusMode: false,
    keyboardNavActive: false,
    renamingSessionId: null,
  });
  localStorage.removeItem("agtower-repos");
  localStorage.removeItem("agtower-settings");
  localStorage.removeItem("agtower-sidebar");
  localStorage.removeItem(AGTOWER_RECENT_COMMANDS_KEY);
}
