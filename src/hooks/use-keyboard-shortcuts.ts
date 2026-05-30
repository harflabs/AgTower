import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import type { AppCommandId } from "@/lib/app-commands";
import { shouldHandleAppCommandInRenderer } from "@/lib/app-commands";
import { isInputFocused, isTerminalFocused } from "@/lib/keyboard/input-guard";
import { SHORTCUTS } from "@/lib/keyboard/registry";
import { resolveSelectAllAction, selectElementContents } from "@/lib/keyboard/select-all";
import type { ShortcutScope } from "@/lib/keyboard/types";
import { USES_NATIVE_MACOS_MENU } from "@/lib/platform";
import {
  navigateToSessionTarget,
  resolveAdjacentOpenSessionTarget,
} from "@/lib/session-navigation";
import { applyTerminalFontSize, getTerminalFontSize } from "@/lib/terminal-pool";
import { useModalStore } from "@/stores/modal-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import {
  clampTerminalFontSize,
  TERMINAL_FONT_SIZE_DEFAULT,
  useSettingsStore,
} from "@/stores/settings-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSplitViewStore } from "@/stores/split-view-store";

/** Exported so the shortcut bar can read the current leader state */
export let activeLeaderKey: string | null = null;
const leaderListeners = new Set<(key: string | null) => void>();
export function onLeaderChange(fn: (key: string | null) => void) {
  leaderListeners.add(fn);
  return () => {
    leaderListeners.delete(fn);
  };
}
function setLeaderKey(key: string | null) {
  activeLeaderKey = key;
  for (const fn of leaderListeners) fn(key);
}

const ACTION_COMMANDS: Partial<Record<string, AppCommandId>> = {
  "command-palette": "app.command-palette",
  "shortcut-help": "app.keyboard-shortcuts",
  "new-session": "session.new",
  "new-terminal": "session.new-terminal",
  "toggle-search": "view.search",
  "mark-done-advance": "session.archive-and-advance",
  "sync-cli-sessions": "view.sync-cli-sessions",
  "toggle-sidebar": "view.toggle-sidebar",
  preferences: "app.preferences",
  "close-context": "session.close-context",
};

export function useKeyboardShortcuts(
  executeCommand: (commandId: AppCommandId) => void | Promise<void>,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const leaderRef = useRef<{
    key: string;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  const getActiveScopes = useCallback((): ShortcutScope[] => {
    const scopes: ShortcutScope[] = ["global"];
    if (location.pathname.startsWith("/session/")) {
      scopes.push("session");
    } else if (location.pathname === "/") {
      scopes.push("dashboard");
    }
    return scopes;
  }, [location.pathname]);

  // ── Escape with strict precedence ──
  const handleEscape = useCallback(() => {
    const modals = useModalStore.getState();

    // 1. Close modal/dialog (Radix handles this via their own Escape, but check shortcut modal)
    if (modals.shortcutModalOpen) {
      modals.setShortcutModalOpen(false);
      return true;
    }

    // 2. Close command palette
    if (modals.commandPaletteOpen) {
      modals.setCommandPaletteOpen(false);
      return true;
    }

    // 3. Close terminal search bar
    if (modals.searchOpen) {
      modals.setSearchOpen(false);
      return true;
    }

    // 4. Blur focused input (rename or inline form field)
    const el = document.activeElement as HTMLElement | null;
    if (
      el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
      !el.closest(".terminal-container")
    ) {
      el.blur();
      return true;
    }

    // 5. Deactivate sidebar tree focus mode
    // (Stopping the agent is intentionally NOT here — use Cmd+W instead.
    // Having Escape kill the PTY was too aggressive and caused accidental
    // session kills when closing modals like the command palette.)
    if (useSidebarStore.getState().sidebarFocusMode) {
      useSidebarStore.getState().setSidebarFocusMode(false);
      return true;
    }

    return false;
  }, []);

  const dispatchAction = useCallback(
    (actionId: string) => {
      const commandId = ACTION_COMMANDS[actionId];
      if (commandId) {
        void executeCommand(commandId);
        return;
      }

      switch (actionId) {
        case "next-attention-session": {
          const sessions = Object.values(useSessionStore.getState().sessions);
          const attentionSessions = sessions
            .filter((s) => s.status === "needsAttention")
            .sort((a, b) => b.createdAt - a.createdAt);
          if (attentionSessions.length === 0) return;
          const currentId = useSessionStore.getState().activeSessionId;
          const currentIndex = attentionSessions.findIndex((s) => s.id === currentId);
          const nextIndex = (currentIndex + 1) % attentionSessions.length;
          const target = attentionSessions[nextIndex];
          useRepoStore.getState().setActiveRepo(target.repoId);
          navigate(`/session/${target.id}`);
          break;
        }
        case "prev-attention-session": {
          const sessions = Object.values(useSessionStore.getState().sessions);
          const attentionSessions = sessions
            .filter((s) => s.status === "needsAttention")
            .sort((a, b) => b.createdAt - a.createdAt);
          if (attentionSessions.length === 0) return;
          const currentId = useSessionStore.getState().activeSessionId;
          const currentIndex = attentionSessions.findIndex((s) => s.id === currentId);
          const prevIndex =
            (currentIndex - 1 + attentionSessions.length) % attentionSessions.length;
          const target = attentionSessions[prevIndex];
          useRepoStore.getState().setActiveRepo(target.repoId);
          navigate(`/session/${target.id}`);
          break;
        }
        case "next-open-session":
        case "prev-open-session": {
          const target = resolveAdjacentOpenSessionTarget(
            useSessionStore.getState().sessions,
            useSessionStore.getState().activeSessionId,
            actionId === "next-open-session" ? "next" : "prev",
          );
          if (target) {
            navigateToSessionTarget(target, navigate);
          }
          break;
        }
        case "focus-sidebar": {
          const el = document.activeElement as HTMLElement | null;
          if (el && el !== document.body) {
            el.blur();
          }
          const sidebar = useSidebarStore.getState();
          if (!sidebar.sidebarOpen) {
            sidebar.setSidebarOpen(true);
          }
          window.dispatchEvent(new CustomEvent("focus-sidebar-tree"));
          break;
        }
        case "focus-sidebar-search": {
          const sidebar = useSidebarStore.getState();
          if (!sidebar.sidebarOpen) {
            sidebar.setSidebarOpen(true);
          }
          window.dispatchEvent(new CustomEvent("focus-sidebar-search"));
          break;
        }
        case "go-dashboard":
          navigate("/");
          break;
        case "go-settings":
          navigate("/settings");
          break;
        case "go-new-session":
          useModalStore.getState().setNewSessionDialogOpen(true);
          break;
        case "new-session-quick":
          useModalStore.getState().setNewSessionDialogOpen(true);
          break;
        case "rename-session": {
          const sidebar = useSidebarStore.getState();
          const focusedNodeId = sidebar.focusedNodeId;
          const sessionId =
            sidebar.sidebarFocusMode && focusedNodeId?.startsWith("session:")
              ? focusedNodeId.replace("session:", "")
              : useSessionStore.getState().activeSessionId;
          if (sessionId) {
            sidebar.setRenamingSessionId(sessionId);
          }
          break;
        }
        case "terminal-scale-up":
        case "terminal-scale-down":
        case "terminal-scale-reset": {
          const split = useSplitViewStore.getState();
          const sessionId = split.splitPair
            ? (split.focusedPaneId ?? useSessionStore.getState().activeSessionId)
            : useSessionStore.getState().activeSessionId;
          if (!sessionId) break;

          // If the terminal hasn't finished mounting, getTerminalFontSize()
          // returns null and applyTerminalFontSize() is a no-op. The setting
          // still updates, so the terminal adopts the new size on mount.
          const settings = useSettingsStore.getState();
          const current = getTerminalFontSize(sessionId) ?? settings.terminalFontSize;
          let next: number;
          if (actionId === "terminal-scale-reset") {
            next = TERMINAL_FONT_SIZE_DEFAULT;
          } else if (actionId === "terminal-scale-up") {
            next = clampTerminalFontSize(current + 1);
          } else {
            next = clampTerminalFontSize(current - 1);
          }
          if (next === current && next === settings.terminalFontSize) break;

          applyTerminalFontSize(sessionId, next);
          settings.setTerminalFontSize(next);
          break;
        }
        default:
          break;
      }
    },
    [executeCommand, navigate],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const inputFocused = isInputFocused();
      const terminalFocused = isTerminalFocused();
      const activeScopes = getActiveScopes();

      // ── Escape: use strict precedence chain ──
      if (e.key === "Escape") {
        // Cmd+Escape: always focus sidebar (escape hatch from terminal)
        if (isMeta) {
          e.preventDefault();
          dispatchAction("focus-sidebar");
          return;
        }
        const modals = useModalStore.getState();

        // Bare Escape: if terminal focused and no modals/search open, let xterm receive it.
        if (
          terminalFocused &&
          !modals.commandPaletteOpen &&
          !modals.searchOpen &&
          !modals.shortcutModalOpen
        ) {
          // Don't prevent default — let the terminal handle Escape itself.
          return;
        }
        // Otherwise run the precedence chain
        e.preventDefault();
        handleEscape();
        return;
      }

      // ── Leader key completion ──
      if (leaderRef.current) {
        const leader = leaderRef.current;
        clearTimeout(leader.timeout);
        leaderRef.current = null;
        setLeaderKey(null);

        if (inputFocused || terminalFocused) return;

        const match = SHORTCUTS.find(
          (s) => s.leader === leader.key && s.key === eventKey && activeScopes.includes(s.scope),
        );
        if (match) {
          e.preventDefault();
          dispatchAction(match.actionId);
        }
        return;
      }

      // ── Cmd+A: avoid browser-style document selection on app chrome ──
      if (isMeta && !e.altKey && eventKey === "a") {
        if (inputFocused) {
          return;
        }

        if (terminalFocused) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("terminal-select-all"));
          return;
        }

        const action = resolveSelectAllAction(document.activeElement, e.target);
        if (action.kind === "native") {
          return;
        }

        e.preventDefault();

        if (action.kind === "custom") {
          selectElementContents(action.target);
        } else {
          window.getSelection()?.removeAllRanges();
        }
        return;
      }

      // ── Terminal context: only modifier shortcuts allowed ──
      if (terminalFocused && !isMeta) {
        // Bare keys go to terminal. Don't intercept.
        return;
      }

      // ── Leader key start (app context only) ──
      if (!isMeta && !e.shiftKey && !e.altKey && !inputFocused && !terminalFocused) {
        const isLeaderKey = SHORTCUTS.some((s) => s.leader === eventKey);
        if (isLeaderKey) {
          e.preventDefault();
          const timeout = setTimeout(() => {
            leaderRef.current = null;
            setLeaderKey(null);
          }, 500);
          leaderRef.current = { key: eventKey, timeout };
          setLeaderKey(eventKey);
          return;
        }
      }

      // ── Match registered shortcuts ──
      const match = SHORTCUTS.find((s) => {
        if (s.leader) return false;
        if (s.key !== eventKey) return false;
        if (!activeScopes.includes(s.scope)) return false;

        const needsMeta = s.modifiers?.meta ?? false;
        const needsCtrl = s.modifiers?.ctrl ?? false;
        const needsShift = s.modifiers?.shift ?? false;
        const needsAlt = s.modifiers?.alt ?? false;

        if (needsCtrl) {
          // Ctrl-specific chord: require the physical Control key without Cmd,
          // so it never matches a Cmd-based chord (meta shortcuts accept either
          // Ctrl or Cmd; this one must not).
          if (!e.ctrlKey || e.metaKey) return false;
        } else if (needsMeta !== isMeta) {
          return false;
        }
        const isShiftedChar = s.key.length === 1 && s.key !== s.key.toLowerCase();
        const keyImpliesShift = isShiftedChar || '?!@#$%^&*()_+{}|:"<>~'.includes(s.key);
        if (!keyImpliesShift && needsShift !== e.shiftKey) return false;
        if (needsAlt !== e.altKey) return false;

        // Input guard: block non-modifier shortcuts when input is focused
        if (inputFocused && !needsMeta && !needsCtrl) return false;

        const commandId = ACTION_COMMANDS[s.actionId];
        if (commandId && !shouldHandleAppCommandInRenderer(commandId, USES_NATIVE_MACOS_MENU)) {
          return false;
        }

        return true;
      });

      if (match) {
        e.preventDefault();
        dispatchAction(match.actionId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (leaderRef.current) {
        clearTimeout(leaderRef.current.timeout);
      }
    };
  }, [getActiveScopes, dispatchAction, handleEscape]);
}
