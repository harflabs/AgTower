import type { NavigateFunction } from "react-router";
import { performHaptic } from "@/lib/haptics";
import { useRepoStore } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

type SessionNavigationTarget =
  | {
      kind: "session";
      repoId: string;
      sessionId: string;
    }
  | {
      kind: "dashboard";
    };

interface SessionRouteOptions {
  resume?: boolean;
}

export function buildSessionPath(sessionId: string, options: SessionRouteOptions = {}): string {
  const params = new URLSearchParams();
  if (options.resume) {
    params.set("resume", "1");
  }
  const query = params.toString();
  return query ? `/session/${sessionId}?${query}` : `/session/${sessionId}`;
}

function getAttentionSessionsByRecency(
  sessions: Record<string, Session>,
  excludeSessionId?: string | null,
): Session[] {
  return Object.values(sessions)
    .filter((session) => session.status === "needsAttention" && session.id !== excludeSessionId)
    .sort((left, right) => right.createdAt - left.createdAt);
}

function isOpenSession(session: Session): boolean {
  return (
    session.status === "running" || session.status === "idle" || session.status === "needsAttention"
  );
}

export function getOpenSessionsByRecency(
  sessions: Record<string, Session>,
  excludeSessionId?: string | null,
): Session[] {
  return Object.values(sessions)
    .filter((session) => isOpenSession(session) && session.id !== excludeSessionId)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function resolveCloseCurrentSessionTarget(
  sessions: Record<string, Session>,
  currentSessionId: string | null | undefined,
): SessionNavigationTarget {
  const nextAttentionSession = getAttentionSessionsByRecency(sessions, currentSessionId)[0];

  if (nextAttentionSession) {
    return {
      kind: "session",
      repoId: nextAttentionSession.repoId,
      sessionId: nextAttentionSession.id,
    };
  }

  return { kind: "dashboard" };
}

export function resolveAdjacentOpenSessionTarget(
  sessions: Record<string, Session>,
  currentSessionId: string | null | undefined,
  direction: "next" | "prev",
): SessionNavigationTarget | null {
  const openSessions = getOpenSessionsByRecency(sessions);
  if (openSessions.length === 0) return null;

  const currentIndex = currentSessionId
    ? openSessions.findIndex((session) => session.id === currentSessionId)
    : -1;

  const targetIndex =
    currentIndex < 0
      ? direction === "next"
        ? 0
        : openSessions.length - 1
      : direction === "next"
        ? (currentIndex + 1) % openSessions.length
        : (currentIndex - 1 + openSessions.length) % openSessions.length;

  const target = openSessions[targetIndex];
  if (!target) return null;

  return {
    kind: "session",
    repoId: target.repoId,
    sessionId: target.id,
  };
}

export function navigateToSessionTarget(
  target: SessionNavigationTarget,
  navigate: NavigateFunction,
  options: SessionRouteOptions = {},
): void {
  if (target.kind === "session") {
    useRepoStore.getState().setActiveRepo(target.repoId);
    useSessionStore.getState().setActiveSession(target.sessionId);
    navigate(buildSessionPath(target.sessionId, options));
    return;
  }

  useSessionStore.getState().setActiveSession(null);
  navigate("/");
}

export function closeCurrentSessionAndAdvance(
  currentSessionId: string,
  navigate: NavigateFunction,
): SessionNavigationTarget {
  const target = resolveCloseCurrentSessionTarget(
    useSessionStore.getState().sessions,
    currentSessionId,
  );
  navigateToSessionTarget(target, navigate);
  return target;
}

export function archiveAndAdvance(
  currentSessionId: string,
  navigate: NavigateFunction,
): SessionNavigationTarget {
  useSessionStore.getState().archiveSession(currentSessionId);
  performHaptic("generic");
  const target = resolveCloseCurrentSessionTarget(
    useSessionStore.getState().sessions,
    currentSessionId,
  );
  navigateToSessionTarget(target, navigate);
  return target;
}
