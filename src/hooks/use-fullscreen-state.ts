import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

/**
 * Mirrors the window's fullscreen state to `html[data-fullscreen]`.
 *
 * In macOS fullscreen:
 * - Traffic lights don't render, so CSS should collapse any left-side clearance
 *   that only exists to dodge the traffic-light cluster in windowed mode.
 * - The titlebar geometry changes, so fullscreen-specific background handling
 *   still matters to avoid transparent-window artifacts behind the webview.
 *
 * Tauri v2 doesn't expose a direct "fullscreen-changed" event, so we poll
 * `isFullscreen()` on resize (which fires during fullscreen transitions).
 */
export function useFullscreenState(): void {
  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) {
      document.documentElement.dataset.fullscreen = "false";
      return;
    }

    const tauriWindow = getCurrentWindow();
    let cancelled = false;
    let unlistenResized: (() => void) | undefined;

    const apply = (fullscreen: boolean) => {
      document.documentElement.dataset.fullscreen = fullscreen ? "true" : "false";
    };

    const refresh = () => {
      tauriWindow
        .isFullscreen()
        .then((fullscreen) => {
          if (!cancelled) apply(fullscreen);
        })
        .catch(() => {
          // Window destroyed during transition — safe to ignore.
        });
    };

    refresh();

    tauriWindow
      .onResized(refresh)
      .then((stop) => {
        if (cancelled) stop();
        else unlistenResized = stop;
      })
      .catch(() => {
        // Listener attach failed (window already gone); refresh() has already
        // applied the snapshot we got, so there's nothing else to do.
      });

    return () => {
      cancelled = true;
      unlistenResized?.();
    };
  }, []);
}
