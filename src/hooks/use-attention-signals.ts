import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";
import { useSessionStore } from "@/stores/session-store";

export function useAttentionSignals() {
  const rawCount = useSessionStore(
    (state) =>
      Object.values(state.sessions).filter((session) => session.status === "needsAttention").length,
  );
  const activeIsAttention = useSessionStore((state) => {
    const id = state.activeSessionId;
    return id ? state.sessions[id]?.status === "needsAttention" : false;
  });

  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document !== "undefined" ? document.hasFocus() : true,
  );
  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Don't count the session the user is actively viewing while the window is
  // focused — its toast is already suppressed (notifications.ts), so the badge
  // should agree. When the window is backgrounded, count it again so a blocked
  // agent still shows on the dock.
  const needsAttentionCount =
    windowFocused && activeIsAttention ? Math.max(0, rawCount - 1) : rawCount;

  const previousCountRef = useRef(needsAttentionCount);

  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) return;

    const currentWindow = getCurrentWindow();

    invoke("update_tray_count", { count: needsAttentionCount }).catch(console.error);
    currentWindow
      .setBadgeLabel(needsAttentionCount > 0 ? String(needsAttentionCount) : undefined)
      .catch(console.error);

    // Fire on every increase in the blocked-agent count, not just the 0→positive
    // edge, so a newly-blocked second/third agent still alerts instead of only
    // bumping the badge number silently.
    if (IS_MACOS && needsAttentionCount > previousCountRef.current) {
      // Critical bounces the dock icon until the user focuses the app.
      // Informational only bounces once — not enough signal for an agent
      // that's blocked waiting on input and may sit idle for minutes.
      currentWindow.requestUserAttention(UserAttentionType.Critical).catch(console.error);
    }

    previousCountRef.current = needsAttentionCount;
  }, [needsAttentionCount]);
}
