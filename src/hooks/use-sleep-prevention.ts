import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Prevents system sleep while any session is running.
 * Automatically allows sleep when no sessions are running.
 */
export function useSleepPrevention() {
  // Selector computes a stable number — only triggers re-render when the
  // count actually changes, not on every session store update.
  const runningCount = useSessionStore((s) => {
    let count = 0;
    for (const sess of Object.values(s.sessions)) {
      if (sess.status === "running" || sess.status === "idle") count++;
    }
    return count;
  });

  useEffect(() => {
    if (runningCount > 0) {
      invoke("prevent_sleep").catch(console.error);
    } else {
      invoke("allow_sleep").catch(console.error);
    }
  }, [runningCount]);
}
