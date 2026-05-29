import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";

interface NativeWindowChromeOptions {
  title: string;
  subtitle?: string | null;
  showsSidebarToggle: boolean;
  /** Set true on pages where the React toolbar renders its own title/breadcrumb
   *  so the native NSWindow title doesn't duplicate it. NSWindow.title is still
   *  set so Cmd+Tab / Mission Control / Dock continue to show the page name. */
  hideTitle?: boolean;
}

interface NativeWindowChromeState {
  contentInsetTop: number;
  isFullscreen: boolean;
}

export function useNativeMacOSWindowChrome({
  title,
  subtitle,
  showsSidebarToggle,
  hideTitle = false,
}: NativeWindowChromeOptions) {
  useEffect(() => {
    const root = document.documentElement;

    if (!IS_MACOS || !HAS_TAURI_RUNTIME) {
      root.style.removeProperty("--window-native-titlebar-height");
      return;
    }

    let cancelled = false;
    let unlistenResized: (() => void) | undefined;
    const window = getCurrentWindow();

    const applyState = (state: NativeWindowChromeState) => {
      const inset = Number.isFinite(state.contentInsetTop) ? Math.max(0, state.contentInsetTop) : 0;
      root.style.setProperty(
        "--window-native-titlebar-height",
        inset > 0 ? `${inset}px` : "var(--window-toolbar-height)",
      );
    };

    const sync = () => {
      invoke<NativeWindowChromeState>("sync_native_window_chrome", {
        payload: {
          hideTitle,
          showsSidebarToggle,
          subtitle: subtitle?.trim() ? subtitle : null,
          title,
        },
      })
        .then((state) => {
          if (!cancelled) {
            applyState(state);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.error("[native-window-chrome] Failed to sync native chrome:", error);
          }
        });
    };

    sync();

    window
      .onResized(sync)
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlistenResized = stop;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlistenResized?.();
    };
  }, [hideTitle, showsSidebarToggle, subtitle, title]);
}
