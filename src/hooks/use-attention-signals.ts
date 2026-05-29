import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";
import { useSessionStore } from "@/stores/session-store";

export function useAttentionSignals() {
  const needsAttentionCount = useSessionStore(
    (state) =>
      Object.values(state.sessions).filter((session) => session.status === "needsAttention").length,
  );
  const previousCountRef = useRef(needsAttentionCount);

  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) return;

    const currentWindow = getCurrentWindow();

    invoke("update_tray_count", { count: needsAttentionCount }).catch(console.error);
    currentWindow
      .setBadgeLabel(needsAttentionCount > 0 ? String(needsAttentionCount) : undefined)
      .catch(console.error);

    if (IS_MACOS && previousCountRef.current === 0 && needsAttentionCount > 0) {
      // Critical bounces the dock icon until the user focuses the app.
      // Informational only bounces once — not enough signal for an agent
      // that's blocked waiting on input and may sit idle for minutes.
      currentWindow.requestUserAttention(UserAttentionType.Critical).catch(console.error);
    }

    previousCountRef.current = needsAttentionCount;
  }, [needsAttentionCount]);
}
