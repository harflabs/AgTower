import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

/**
 * Mirrors native macOS chrome behavior: the window's toolbar/controls dim when
 * the window loses focus. We expose the state on `html[data-window-active]`
 * so CSS can style toolbar icons, separators, and the sidebar vibrancy overlay.
 *
 * Mount once at the app root.
 */
export function useWindowActiveState() {
  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) {
      document.documentElement.dataset.windowActive = "true";
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const apply = (active: boolean) => {
      document.documentElement.dataset.windowActive = active ? "true" : "false";
    };

    const window = getCurrentWindow();

    // Seed initial state — the event only fires on changes.
    window
      .isFocused()
      .then((focused) => {
        if (!cancelled) apply(focused);
      })
      .catch(() => apply(true));

    window
      .onFocusChanged(({ payload: focused }) => {
        apply(focused);
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
