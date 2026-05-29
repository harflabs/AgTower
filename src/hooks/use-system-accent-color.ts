import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";

/**
 * Reads the system accent color (NSColor.controlAccentColor) from the Rust
 * side and writes it into `--macos-accent` on <html>. CSS then blends it
 * into the sidebar selection background + focus ring to match Finder/Mail/
 * Messages — where a user-chosen blue/purple/red/graphite tints the UI.
 *
 * Re-reads when the window regains focus. Accent changes happen in System
 * Settings, which always steals focus from us, so focus-return is the
 * natural sync point and avoids an NSNotificationCenter observer.
 *
 * No-op on non-macOS. Mount once at the app root.
 */
export function useSystemAccentColor() {
  useEffect(() => {
    if (!IS_MACOS || !HAS_TAURI_RUNTIME) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const apply = (hex: string) => {
      document.documentElement.style.setProperty("--macos-accent", hex);
    };

    const sync = () => {
      invoke<string>("get_system_accent_color")
        .then((hex) => {
          if (!cancelled) apply(hex);
        })
        .catch((err) => {
          console.error("[accent-color] Failed to read system accent:", err);
        });
    };

    sync();

    const tauriWindow = getCurrentWindow();
    tauriWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) sync();
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
