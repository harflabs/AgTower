import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface SidebarState {
  // ── Persisted ──
  sidebarWidth: number;
  sidebarOpen: boolean;
  collapsedWorkspaces: Record<string, boolean>;
  expandedHistoryByWorkspace: Record<string, boolean>;
  /**
   * Session pins are frontend-only — no DB column. The set survives across
   * restarts via persist but is cleaned up lazily (a pinned id that no longer
   * resolves to a session is just ignored by the sidebar render).
   */
  pinnedSessionIds: Record<string, boolean>;

  setSidebarWidth: (w: number) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setWorkspaceCollapsed: (repoId: string, collapsed: boolean) => void;
  /**
   * Drop explicit collapse overrides so the listed workspaces revert to the
   * status-derived default (expanded only while running/needs-attention).
   * Called once per app launch so quiet repos start collapsed.
   */
  clearWorkspaceCollapseOverrides: (repoIds: string[]) => void;
  toggleWorkspaceHistory: (repoId: string) => void;
  togglePinnedSession: (sessionId: string) => void;
  setSessionPinned: (sessionId: string, pinned: boolean) => void;

  // ── Transient (not persisted) ──
  focusedNodeId: string | null;
  setFocusedNodeId: (id: string | null) => void;
  sidebarFocusMode: boolean;
  setSidebarFocusMode: (active: boolean) => void;
  keyboardNavActive: boolean;
  renamingSessionId: string | null;
  setRenamingSessionId: (id: string | null) => void;
}

export const useSidebarStore = create<SidebarState>()(
  devtools(
    persist(
      (set) => ({
        // ── Persisted defaults ──
        sidebarWidth: 296,
        sidebarOpen: true,
        collapsedWorkspaces: {},
        expandedHistoryByWorkspace: {},
        pinnedSessionIds: {},

        setSidebarWidth: (w) => set({ sidebarWidth: Math.max(256, Math.min(480, w)) }),
        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        clearWorkspaceCollapseOverrides: (repoIds) =>
          set((s) => {
            const next = { ...s.collapsedWorkspaces };
            const nextHistory = { ...s.expandedHistoryByWorkspace };
            let changed = false;
            for (const repoId of repoIds) {
              if (repoId in next) {
                delete next[repoId];
                changed = true;
              }
              // Mirror setWorkspaceCollapsed: a workspace reverting to the
              // collapsed default also forgets its expanded history, so the
              // next manual expand starts from "Show more (N)".
              if (nextHistory[repoId]) {
                nextHistory[repoId] = false;
                changed = true;
              }
            }
            return changed
              ? { collapsedWorkspaces: next, expandedHistoryByWorkspace: nextHistory }
              : {};
          }),
        setWorkspaceCollapsed: (repoId, collapsed) =>
          set((s) => ({
            collapsedWorkspaces: {
              ...s.collapsedWorkspaces,
              [repoId]: collapsed,
            },
            // Reset history when collapsing
            ...(collapsed && s.expandedHistoryByWorkspace[repoId]
              ? {
                  expandedHistoryByWorkspace: {
                    ...s.expandedHistoryByWorkspace,
                    [repoId]: false,
                  },
                }
              : {}),
          })),
        toggleWorkspaceHistory: (repoId) =>
          set((s) => ({
            expandedHistoryByWorkspace: {
              ...s.expandedHistoryByWorkspace,
              [repoId]: !s.expandedHistoryByWorkspace[repoId],
            },
          })),
        togglePinnedSession: (sessionId) =>
          set((s) => {
            const next = { ...s.pinnedSessionIds };
            if (next[sessionId]) {
              delete next[sessionId];
            } else {
              next[sessionId] = true;
            }
            return { pinnedSessionIds: next };
          }),
        setSessionPinned: (sessionId, pinned) =>
          set((s) => {
            const next = { ...s.pinnedSessionIds };
            if (pinned) {
              next[sessionId] = true;
            } else {
              delete next[sessionId];
            }
            return { pinnedSessionIds: next };
          }),
        // ── Transient defaults ──
        focusedNodeId: null,
        setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
        sidebarFocusMode: false,
        setSidebarFocusMode: (sidebarFocusMode) =>
          set({ sidebarFocusMode, keyboardNavActive: sidebarFocusMode }),
        keyboardNavActive: false,
        renamingSessionId: null,
        setRenamingSessionId: (id) => set({ renamingSessionId: id }),
      }),
      {
        name: "agtower-sidebar",
        partialize: (state) => ({
          sidebarWidth: state.sidebarWidth,
          sidebarOpen: state.sidebarOpen,
          collapsedWorkspaces: state.collapsedWorkspaces,
          expandedHistoryByWorkspace: state.expandedHistoryByWorkspace,
          pinnedSessionIds: state.pinnedSessionIds,
        }),
      },
    ),
    { name: "sidebar-store" },
  ),
);
