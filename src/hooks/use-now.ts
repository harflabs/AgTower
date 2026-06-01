import { useSyncExternalStore } from "react";

/**
 * A single app-wide 1-second clock. Components that need a ticking "now" (e.g.
 * live session durations on the dashboard) subscribe to this shared store rather
 * than each spinning up their own `setInterval` — with many cards that would be N
 * timers and N independent re-renders. One interval runs only while at least one
 * subscriber is active, and is torn down when the last unsubscribes.
 */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Stable no-op subscribe for inactive consumers, so React doesn't re-subscribe
// every render when `active` is false.
const NOOP_SUBSCRIBE = (): (() => void) => () => {};
const getSnapshot = (): number => now;

/**
 * Returns a value that updates ~once per second while `active` is true. When
 * `active` is false the component does not subscribe and won't re-render on tick.
 */
export function useNow(active = true): number {
  return useSyncExternalStore(active ? subscribe : NOOP_SUBSCRIBE, getSnapshot, getSnapshot);
}
