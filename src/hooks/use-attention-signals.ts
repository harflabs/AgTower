import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { deriveAttentionSignals } from "@/hooks/use-attention-signals-helpers";
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

  // Edge detection tracks the RAW count — see deriveAttentionSignals for why
  // the bounce must not key off the focus-adjusted badge count.
  const previousRawCountRef = useRef(rawCount);

  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) return;

    const currentWindow = getCurrentWindow();
    const { badgeCount, requestAttention } = deriveAttentionSignals({
      rawCount,
      previousRawCount: previousRawCountRef.current,
      activeIsAttention,
      windowFocused,
    });

    invoke("update_tray_count", { count: badgeCount }).catch(console.error);
    currentWindow
      .setBadgeLabel(badgeCount > 0 ? String(badgeCount) : undefined)
      .catch(console.error);

    if (IS_MACOS && requestAttention) {
      // Critical bounces the dock icon until the user focuses the app.
      // Informational only bounces once — not enough signal for an agent
      // that's blocked waiting on input and may sit idle for minutes.
      currentWindow.requestUserAttention(UserAttentionType.Critical).catch(console.error);
    }

    previousRawCountRef.current = rawCount;
  }, [rawCount, activeIsAttention, windowFocused]);
}
