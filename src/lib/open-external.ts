import { openUrl } from "@tauri-apps/plugin-opener";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

/**
 * Open a URL in the user's default browser.
 *
 * Inside Tauri's wry webview, `window.open` (xterm's default link handler) does
 * NOT route to the system browser — wry intercepts it and the click silently
 * no-ops. We must go through the opener plugin instead. Outside Tauri (e.g.
 * `pnpm dev` in a plain browser) we fall back to `window.open`.
 *
 * The opener plugin's default scope only permits http/https/mailto/tel; other
 * schemes reject and are swallowed by the catch.
 */
export function openExternalUrl(url: string): void {
  if (HAS_TAURI_RUNTIME) {
    void openUrl(url).catch((error) => {
      console.error(`Failed to open URL: ${url}`, error);
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
