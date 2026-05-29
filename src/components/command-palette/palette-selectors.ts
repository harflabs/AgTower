import { useRef } from "react";
import { type Session, useSessionStore } from "@/stores/session-store";

// Fields that mutate constantly while an agent streams. The palette does not
// display them and doesn't need to rebuild items/ranking when they change.
const SESSION_TRANSIENT_FIELDS: ReadonlySet<keyof Session> = new Set([
  "totalInputTokens",
  "totalOutputTokens",
  "totalCacheReadTokens",
  "totalCacheWriteTokens",
  "liveProviderData",
  "ptyActive",
]);

export function sessionStructurallyEqual(a: Session, b: Session): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as Array<keyof Session>;
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (SESSION_TRANSIENT_FIELDS.has(key)) continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function sessionsStructurallyEqual(
  a: Record<string, Session>,
  b: Record<string, Session>,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const aSession = a[key];
    const bSession = b[key];
    if (!bSession) return false;
    if (!sessionStructurallyEqual(aSession, bSession)) return false;
  }
  return true;
}

/**
 * Subscribes to the session store but returns a structurally-stable reference:
 * when only transient fields (tokens, liveProviderData, ptyActive) change, the
 * previous reference is returned so downstream useMemo chains skip their work.
 *
 * Components still re-render on every store update, but expensive derived work
 * (the palette item rebuild + ranking pass, and the sidebar sort/tree memos) is
 * gated by this reference. Shared by the command palette and the sidebar.
 */
export function useStableSessions(): Record<string, Session> {
  const sessions = useSessionStore((state) => state.sessions);
  const stableRef = useRef(sessions);
  if (!sessionsStructurallyEqual(stableRef.current, sessions)) {
    stableRef.current = sessions;
  }
  return stableRef.current;
}
