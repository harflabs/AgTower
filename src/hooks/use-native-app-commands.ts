import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo } from "react";
import type { NavigateFunction } from "react-router";
import {
  type AppCommandExecutionContext,
  type AppCommandId,
  createNativeMenuContext,
  executeAppCommand,
  NATIVE_APP_COMMAND_EVENT,
  type NativeMenuCommandPayload,
} from "@/lib/app-commands";
import { USES_NATIVE_MACOS_MENU } from "@/lib/platform";
import type { Session } from "@/stores/session-store";

interface UseNativeAppCommandsOptions {
  navigate?: NavigateFunction;
  pathname: string;
  session?: Session | null;
  sessionId?: string | null;
}

export function useNativeAppCommands({
  navigate,
  pathname,
  session,
  sessionId,
}: UseNativeAppCommandsOptions) {
  const currentWindow = useMemo(() => getCurrentWebviewWindow(), []);

  const context = useMemo<AppCommandExecutionContext>(
    () => ({
      navigate,
      pathname,
      sessionId,
      windowLabel: currentWindow.label,
    }),
    [currentWindow.label, navigate, pathname, sessionId],
  );

  const execute = useCallback(
    (commandId: AppCommandId) => executeAppCommand(commandId, context),
    [context],
  );

  useEffect(() => {
    const unlistenPromise = currentWindow.listen<NativeMenuCommandPayload>(
      NATIVE_APP_COMMAND_EVENT,
      (event) => {
        void execute(event.payload.commandId);
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [currentWindow, execute]);

  useEffect(() => {
    if (!USES_NATIVE_MACOS_MENU) return;

    const syncMenuContext = () =>
      invoke("sync_native_menu_context", {
        context: createNativeMenuContext({
          ...context,
          canArchiveAndAdvance:
            !!sessionId &&
            !!session &&
            session.status !== "running" &&
            session.status !== "idle" &&
            session.status !== "archived",
        }),
      }).catch(console.error);

    syncMenuContext();

    const unlistenPromise = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        syncMenuContext();
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [context, currentWindow, session, sessionId]);

  return execute;
}
