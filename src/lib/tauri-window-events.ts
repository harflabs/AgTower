/**
 * Tauri window focus events — propagates webview window focus state to the
 * Rust PTY layer so:
 *   1. Codex can drive its focus-aware notification path (BEL / OSC-9 is
 *      only emitted when the terminal is unfocused).
 *   2. All providers benefit from the auto-idle-on-focus behaviour: when
 *      the user opens a NeedsAttention session, the backend transitions
 *      it to Idle so the notification badge clears on view.
 *
 * The backend `set_session_focused` command writes the corresponding
 * `\x1b[I` / `\x1b[O` CSI sequence into the PTY input (harmlessly
 * ignored by providers that don't use focus reporting).
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSessionStore } from "@/stores/session-store";

async function sendFocus(sessionId: string, focused: boolean): Promise<void> {
  try {
    await invoke("set_session_focused", { sessionId, focused });
  } catch {
    // Command may not be registered yet during early startup or the session
    // may have been torn down between lookup and invoke — both benign.
  }
}

/**
 * On window blur: send `focused: false` to every active session.
 * Codex will re-enable its notification path; other providers simply
 * receive a harmless CSI sequence.
 */
async function onWindowBlurred(): Promise<void> {
  const sessions = useSessionStore.getState().sessions;
  for (const session of Object.values(sessions)) {
    if (!session.ptyActive) continue;
    await sendFocus(session.id, false);
  }
}

/**
 * On window focus: only signal `focused: true` for the session the user is
 * ACTUALLY viewing (tracked as `activeSessionId`). Broadcasting true to
 * every session would incorrectly clear NeedsAttention on sessions the user
 * can't see — e.g., when they're on the dashboard and a background session
 * finishes a turn.
 *
 * If the user isn't on a session route (`activeSessionId == null`), this is
 * a no-op and any pending NeedsAttention badges stay visible.
 */
async function onWindowFocused(): Promise<void> {
  const { activeSessionId, sessions } = useSessionStore.getState();
  if (!activeSessionId) return;
  const session = sessions[activeSessionId];
  if (!session?.ptyActive) return;
  await sendFocus(session.id, true);
}

/**
 * Subscribe to Tauri's window focus events. Returns a cleanup function that
 * detaches the listener. Safe to call more than once — each call installs a
 * fresh subscription bound to the current webview window.
 */
export async function setupTauriWindowFocusEvents(): Promise<() => void> {
  const currentWindow = getCurrentWebviewWindow();
  const unlisten = await currentWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      void onWindowFocused();
    } else {
      void onWindowBlurred();
    }
  });
  return unlisten;
}
