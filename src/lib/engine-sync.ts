/**
 * Engine sync — listens for Rust engine events and updates Zustand stores.
 *
 * The Rust engine is the source of truth for sessions, repos, workspace state,
 * and backend-owned lifecycle settings. This module bridges Rust events into
 * Zustand mirrors so React components re-render automatically.
 */

import { listen } from "@tauri-apps/api/event";
import { clearClientSessionState } from "@/lib/app-reset";
import { notifyNeedsAttention, notifySessionCompleted } from "@/lib/notifications";
import type { Repository } from "@/stores/repo-store";
import { useRepoStore } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

/** Set up all engine event listeners. Call once during app init. */
export async function setupEngineSync(): Promise<() => void> {
  const unlisteners: Array<() => void> = [];

  // ── Session events ──
  const u1 = await listen<Session>("session:updated", (event) => {
    // Detect active → closed transitions for dashboard toast
    const prev = useSessionStore.getState().sessions[event.payload.id];
    const wasActive =
      prev &&
      (prev.status === "running" || prev.status === "idle" || prev.status === "needsAttention");
    const isNowClosed = event.payload.status === "closed";
    if (wasActive && isNowClosed) {
      notifySessionCompleted(event.payload as Session);
    }

    useSessionStore.getState()._updateFromEngine(event.payload.id, event.payload);
  });
  unlisteners.push(u1);

  const u2 = await listen<Session>("session:added", (event) => {
    useSessionStore.getState()._addFromEngine(event.payload);
  });
  unlisteners.push(u2);

  const u3 = await listen<{ id: string }>("session:removed", (event) => {
    useSessionStore.getState()._removeFromEngine(event.payload.id);
  });
  unlisteners.push(u3);

  const u4 = await listen("sessions:cleared", () => {
    clearClientSessionState();
  });
  unlisteners.push(u4);

  // ── Repo events ──
  const u5 = await listen<Repository>("repo:updated", (event) => {
    useRepoStore.getState()._updateFromEngine(event.payload);
  });
  unlisteners.push(u5);

  const u6 = await listen<Repository>("repo:added", (event) => {
    useRepoStore.getState()._addFromEngine(event.payload);
  });
  unlisteners.push(u6);

  const u7 = await listen<{ id: string }>("repo:removed", (event) => {
    useRepoStore.getState()._removeFromEngine(event.payload.id);
  });
  unlisteners.push(u7);

  // ── Notification events (Rust decides when to notify, TS shows toast + sound) ──
  const u8 = await listen<Session>("notification:attention", (event) => {
    notifyNeedsAttention(event.payload);
  });
  unlisteners.push(u8);

  return () => {
    for (const u of unlisteners) u();
  };
}
