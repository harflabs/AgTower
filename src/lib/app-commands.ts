import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NavigateFunction } from "react-router";
import {
  archiveAndAdvance,
  buildSessionPath,
  closeCurrentSessionAndAdvance,
} from "@/lib/session-navigation";
import { getRemainingSplitSessionId } from "@/lib/split-view";
import { useModalStore } from "@/stores/modal-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSplitViewStore } from "@/stores/split-view-store";

export type AppCommandId =
  | "app.command-palette"
  | "app.preferences"
  | "app.keyboard-shortcuts"
  | "app.help.docs"
  | "session.new"
  | "session.new-terminal"
  | "session.close-context"
  | "session.archive-and-advance"
  | "view.toggle-sidebar"
  | "view.search"
  | "view.sync-cli-sessions";

export interface AppCommandExecutionContext {
  navigate?: NavigateFunction;
  pathname: string;
  sessionId?: string | null;
  windowLabel: string;
}

export interface NativeMenuCommandPayload {
  commandId: AppCommandId;
}

interface NativeMenuContext {
  canArchiveAndAdvance: boolean;
  closeMenuText: string;
  pathname: string;
  windowLabel: string;
}

type AppCommandEffect =
  | { kind: "toggle-command-palette" }
  | { kind: "open-preferences" }
  | { kind: "open-keyboard-shortcuts" }
  | { kind: "open-help-docs" }
  | { kind: "new-session" }
  | { kind: "new-terminal" }
  | { kind: "close-session-view" }
  | { kind: "hide-main-window" }
  | { kind: "archive-and-advance" }
  | { kind: "toggle-sidebar" }
  | { kind: "toggle-search" }
  | { kind: "sync-cli-sessions" };

export const NATIVE_APP_COMMAND_EVENT = "agtower://app-command";

const NATIVE_MENU_MANAGED_COMMANDS = new Set<AppCommandId>([
  "app.command-palette",
  "app.preferences",
  "session.new",
  "session.new-terminal",
  "session.close-context",
  "session.archive-and-advance",
  "view.toggle-sidebar",
  "view.search",
  "view.sync-cli-sessions",
]);

export function shouldHandleAppCommandInRenderer(
  commandId: AppCommandId,
  nativeMenuAvailable: boolean,
) {
  return !nativeMenuAvailable || !NATIVE_MENU_MANAGED_COMMANDS.has(commandId);
}

export function createNativeMenuContext(
  context: AppCommandExecutionContext & {
    canArchiveAndAdvance: boolean;
  },
): NativeMenuContext {
  const closeMenuText = context.pathname.startsWith("/session/") ? "Close Session" : "Close Window";

  return {
    canArchiveAndAdvance: context.canArchiveAndAdvance,
    closeMenuText,
    pathname: context.pathname,
    windowLabel: context.windowLabel,
  };
}

export function resolveAppCommandEffect(
  commandId: AppCommandId,
  context: AppCommandExecutionContext,
): AppCommandEffect | null {
  switch (commandId) {
    case "app.command-palette":
      return { kind: "toggle-command-palette" };
    case "app.preferences":
      return { kind: "open-preferences" };
    case "app.keyboard-shortcuts":
      return { kind: "open-keyboard-shortcuts" };
    case "app.help.docs":
      return { kind: "open-help-docs" };
    case "session.new":
      return { kind: "new-session" };
    case "session.new-terminal":
      return { kind: "new-terminal" };
    case "session.close-context":
      return context.pathname.startsWith("/session/")
        ? { kind: "close-session-view" }
        : { kind: "hide-main-window" };
    case "session.archive-and-advance":
      if (!context.sessionId) return null;
      return { kind: "archive-and-advance" };
    case "view.toggle-sidebar":
      return { kind: "toggle-sidebar" };
    case "view.search":
      return { kind: "toggle-search" };
    case "view.sync-cli-sessions":
      return { kind: "sync-cli-sessions" };
    default:
      return null;
  }
}

function closeSplitContext(
  sessionId: string,
  navigate: NavigateFunction,
  options: { archive?: boolean } = {},
): boolean {
  const splitPair = useSplitViewStore.getState().splitPair;
  if (!splitPair) return false;

  const remainingId = getRemainingSplitSessionId(splitPair, sessionId);
  if (!remainingId) return false;

  if (options.archive) {
    useSessionStore.getState().archiveSession(sessionId);
  }

  useSplitViewStore.getState().closeSplit();

  const remainingSession = useSessionStore.getState().sessions[remainingId];
  if (!remainingSession) {
    useSessionStore.getState().setActiveSession(null);
    navigate("/", { replace: true });
    return true;
  }

  useRepoStore.getState().setActiveRepo(remainingSession.repoId);
  useSessionStore.getState().setActiveSession(remainingId);
  navigate(buildSessionPath(remainingId), { replace: true });
  return true;
}

function canArchiveSession(sessionId: string): boolean {
  const session = useSessionStore.getState().sessions[sessionId];
  if (!session) return false;
  return session.status !== "running" && session.status !== "idle" && session.status !== "archived";
}

export async function executeAppCommand(
  commandId: AppCommandId,
  context: AppCommandExecutionContext,
): Promise<void> {
  const effect = resolveAppCommandEffect(commandId, context);
  if (!effect) return;

  switch (effect.kind) {
    case "toggle-command-palette":
      if (useModalStore.getState().commandPaletteOpen) {
        window.dispatchEvent(new CustomEvent("command-palette-retrigger"));
      } else {
        useModalStore.getState().setCommandPaletteOpen(true);
      }
      break;
    case "open-preferences":
      context.navigate?.("/settings");
      break;
    case "open-keyboard-shortcuts":
      useModalStore.getState().setShortcutModalOpen(true);
      break;
    case "open-help-docs":
      await openUrl("https://github.com/harflabs/AgTower#readme");
      break;
    case "new-session":
      useModalStore.getState().setNewSessionDialogOpen(true);
      break;
    case "new-terminal":
      window.dispatchEvent(new CustomEvent("new-terminal-session"));
      break;
    case "close-session-view":
      if (context.sessionId && context.navigate) {
        if (closeSplitContext(context.sessionId, context.navigate)) {
          break;
        }
        closeCurrentSessionAndAdvance(context.sessionId, context.navigate);
      }
      break;
    case "hide-main-window":
      await getCurrentWebviewWindow().hide();
      break;
    case "archive-and-advance":
      if (context.sessionId && context.navigate) {
        if (!canArchiveSession(context.sessionId)) break;
        if (closeSplitContext(context.sessionId, context.navigate, { archive: true })) {
          break;
        }
        archiveAndAdvance(context.sessionId, context.navigate);
      }
      break;
    case "toggle-sidebar":
      if (useSidebarStore.getState().sidebarOpen) {
        useSidebarStore.getState().setSidebarFocusMode(false);
        useSidebarStore.getState().toggleSidebar();
      } else {
        useSidebarStore.getState().toggleSidebar();
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("focus-sidebar-tree"));
        });
      }
      break;
    case "toggle-search":
      useModalStore.getState().toggleSearch();
      break;
    case "sync-cli-sessions":
      window.dispatchEvent(new CustomEvent("sync-cli-sessions"));
      break;
  }
}
