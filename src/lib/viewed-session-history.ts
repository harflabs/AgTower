import { AGTOWER_VIEWED_SESSIONS_KEY as VIEWED_SESSIONS_KEY } from "@/lib/storage-keys";
import type { SessionStatus } from "@/types/session";

const MAX_VIEWED_SESSIONS = 20;

const OPEN_STATUSES: ReadonlySet<SessionStatus> = new Set(["running", "idle", "needsAttention"]);

export function readViewedSessions(): string[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(VIEWED_SESSIONS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .slice(0, MAX_VIEWED_SESSIONS);
  } catch {
    return [];
  }
}

function saveViewedSessions(sessionIds: string[]) {
  if (typeof localStorage === "undefined") return;

  localStorage.setItem(
    VIEWED_SESSIONS_KEY,
    JSON.stringify(sessionIds.filter(Boolean).slice(0, MAX_VIEWED_SESSIONS)),
  );
}

export function recordViewedSession(sessionId: string) {
  if (!sessionId) return;
  const next = readViewedSessions().filter((id) => id !== sessionId);
  next.unshift(sessionId);
  saveViewedSessions(next);
}

/**
 * Walks the viewed-session history and returns the first id that still
 * resolves to an open session (running / idle / needsAttention), excluding
 * the current session. Skips stale ids that no longer exist and ids whose
 * sessions have since closed/archived — these would otherwise be invisible
 * targets when the palette auto-selects a "previous" row.
 */
export function getLastOpenViewedSessionId(
  sessions: Record<string, { status: SessionStatus }>,
  currentSessionId?: string | null,
): string | null {
  const viewed = readViewedSessions();
  for (const id of viewed) {
    if (id === currentSessionId) continue;
    const session = sessions[id];
    if (!session) continue;
    if (!OPEN_STATUSES.has(session.status)) continue;
    return id;
  }
  return null;
}
