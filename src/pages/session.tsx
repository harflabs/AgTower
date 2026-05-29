import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useAppShellToolbar } from "@/components/app-shell-toolbar";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { isSessionLive, SessionPane } from "@/components/session/session-pane";
import { SplitDropOverlay } from "@/components/session/split-drop-zone";
import { SplitPaneContainer } from "@/components/session/split-pane-container";
import { SESSION_DROP_EVENT, type SessionDropDetail } from "@/hooks/use-session-drag";
import { useWindowTitle } from "@/hooks/use-window-title";
import { saveWorkspaceState } from "@/lib/engine";
import {
  closeCurrentSessionAndAdvance,
  resolveCloseCurrentSessionTarget,
} from "@/lib/session-navigation";
import {
  getEffectiveSplitSessionId,
  getRemainingSplitSessionId,
  getValidSplitSessionIds,
  type SplitPaneSide,
} from "@/lib/split-view";
import { recordViewedSession } from "@/lib/viewed-session-history";
import { useModalStore } from "@/stores/modal-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSplitViewStore } from "@/stores/split-view-store";

interface SplitDropTargetProps {
  children: React.ReactNode;
  onDropSession: (side: SplitPaneSide, sessionId: string) => void;
  sessionId: string;
}

function SplitDropTarget({ children, onDropSession, sessionId }: SplitDropTargetProps) {
  const draggingSessionId = useSplitViewStore((s) => s.draggingSessionId);
  const [dropSide, setDropSide] = useState<SplitPaneSide | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = !!draggingSessionId && draggingSessionId !== sessionId;

  useEffect(() => {
    if (!isActive) {
      setDropSide(null);
      return;
    }

    function getSide(clientX: number): SplitPaneSide {
      const el = ref.current;
      if (!el) return "right";
      const rect = el.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2 ? "left" : "right";
    }

    function isOver(clientX: number, clientY: number): boolean {
      const el = ref.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    function handleMouseMove(event: MouseEvent) {
      setDropSide(isOver(event.clientX, event.clientY) ? getSide(event.clientX) : null);
    }

    function handleDrop(event: Event) {
      const detail = (event as CustomEvent<SessionDropDetail>).detail;
      if (detail.sessionId === sessionId) return;
      if (!isOver(detail.clientX, detail.clientY)) return;

      onDropSession(getSide(detail.clientX), detail.sessionId);
      setDropSide(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener(SESSION_DROP_EVENT, handleDrop);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener(SESSION_DROP_EVENT, handleDrop);
    };
  }, [isActive, onDropSession, sessionId]);

  return (
    <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden">
      {children}
      {isActive && <SplitDropOverlay dropSide={dropSide} />}
    </div>
  );
}

export default function Session() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const activeRepoId = useRepoStore((s) => s.activeRepoId);
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionsHydrated = useSessionStore((s) => s._hydrated);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const searchOpen = useModalStore((s) => s.searchOpen);
  const setSearchOpen = useModalStore((s) => s.setSearchOpen);
  const splitPair = useSplitViewStore((s) => s.splitPair);
  const focusedPaneId = useSplitViewStore((s) => s.focusedPaneId);
  const setFocusedPaneId = useSplitViewStore((s) => s.setFocusedPaneId);
  const closeSplit = useSplitViewStore((s) => s.closeSplit);
  const openSplit = useSplitViewStore((s) => s.openSplit);
  const replaceSplitPane = useSplitViewStore((s) => s.replaceSplitPane);

  const routeSession = id ? sessions[id] : undefined;
  const shouldResumeFromQuery = new URLSearchParams(location.search).get("resume") === "1";

  const availableSplitSessionIds = useMemo(() => {
    if (!splitPair) return [];
    return [splitPair.left, splitPair.right].filter((sessionId) => !!sessions[sessionId]);
  }, [sessions, splitPair]);

  const isSplitActive =
    !!splitPair &&
    availableSplitSessionIds.length === 2 &&
    !!id &&
    (splitPair.left === id || splitPair.right === id);

  const effectiveSessionId = getEffectiveSplitSessionId(
    id,
    isSplitActive ? splitPair : null,
    focusedPaneId,
  );
  const effectiveSession = effectiveSessionId ? sessions[effectiveSessionId] : undefined;

  useWindowTitle(
    effectiveSession ? `AgTower — ${effectiveSession.title}` : "AgTower — Session not found",
  );

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteTargetSession = deleteTargetId ? sessions[deleteTargetId] : null;

  useEffect(() => {
    if (!splitPair) return;

    const validSplitSessions = getValidSplitSessionIds(splitPair, sessions);

    if (validSplitSessions.length === 2) {
      if (id && id !== splitPair.left && id !== splitPair.right) {
        closeSplit();
      }
      return;
    }

    closeSplit();

    if (validSplitSessions.length === 1) {
      const survivorId = validSplitSessions[0];
      if (id !== survivorId) {
        navigate(`/session/${survivorId}`, { replace: true });
      }
      return;
    }

    if (id && !sessions[id]) {
      navigate("/", { replace: true });
    }
  }, [closeSplit, id, navigate, sessions, splitPair]);

  useEffect(() => {
    if (!effectiveSessionId) return;
    recordViewedSession(effectiveSessionId);
    setActiveSession(effectiveSessionId);
    saveWorkspaceState("activeSessionId", effectiveSessionId).catch(console.error);
  }, [effectiveSessionId, setActiveSession]);

  useEffect(() => {
    if (!effectiveSession || effectiveSession.repoId === activeRepoId) return;
    setActiveRepo(effectiveSession.repoId);
  }, [activeRepoId, effectiveSession, setActiveRepo]);

  useEffect(
    () => () => {
      setActiveSession(null);
    },
    [setActiveSession],
  );

  useEffect(() => {
    if (!id || !shouldResumeFromQuery) return;
    navigate(`/session/${id}`, { replace: true });
  }, [id, navigate, shouldResumeFromQuery]);

  // Auto-redirect when the session disappears out from under us. The
  // empty-session auto-prune (and any other removal path) yanks the row
  // while the user is still on /session/:id; rather than parking them on a
  // "Session not found" screen, send them back to the dashboard. Guard on
  // hydration so we don't bounce off the page during initial DB load when
  // the store hasn't been populated yet.
  useEffect(() => {
    if (!sessionsHydrated || !id) return;
    if (routeSession) return;
    navigate("/", { replace: true });
  }, [id, navigate, routeSession, sessionsHydrated]);

  useEffect(
    () => () => {
      setSearchOpen(false);
    },
    [setSearchOpen],
  );

  const collapseSplitPane = useCallback(
    (sessionId: string) => {
      if (!splitPair) return;
      const remainingId = getRemainingSplitSessionId(splitPair, sessionId);
      closeSplit();
      if (remainingId && id !== remainingId) {
        navigate(`/session/${remainingId}`, { replace: true });
      }
    },
    [closeSplit, id, navigate, splitPair],
  );

  const handleStop = useCallback(async () => {
    if (!effectiveSessionId) return;
    const session = sessions[effectiveSessionId];
    if (!session) return;

    try {
      await invoke("kill_pty_session", { sessionId: effectiveSessionId });
    } catch (err) {
      console.error("[session] Stop failed:", err);
    }

    const now = Date.now();
    const createdAt = session.createdAt ?? now;
    useSessionStore.getState().updateSession(effectiveSessionId, {
      durationMs: now - createdAt,
      endedAt: now,
      ptyActive: false,
      status: "closed",
    });
  }, [effectiveSessionId, sessions]);

  const handleRequestDelete = useCallback(() => {
    if (!effectiveSessionId) return;
    setDeleteTargetId(effectiveSessionId);
  }, [effectiveSessionId]);

  const handleArchive = useCallback(() => {
    if (!effectiveSessionId) return;
    useSessionStore.getState().archiveSession(effectiveSessionId);
  }, [effectiveSessionId]);

  const handleClose = useCallback(() => {
    if (!effectiveSessionId) return;
    if (isSplitActive) {
      collapseSplitPane(effectiveSessionId);
      return;
    }
    closeCurrentSessionAndAdvance(effectiveSessionId, navigate);
  }, [collapseSplitPane, effectiveSessionId, isSplitActive, navigate]);

  const handleDeleteSession = useCallback(() => {
    if (!deleteTargetId) return;

    const targetSession = sessions[deleteTargetId];
    if (targetSession && isSessionLive(targetSession)) {
      invoke("kill_pty_session", { sessionId: deleteTargetId }).catch((err) => {
        console.error("[kill session]", err);
        toast.error("Failed to stop session");
      });
    }

    const nextSplitPair = splitPair;
    removeSession(deleteTargetId);
    setDeleteTargetId(null);

    if (nextSplitPair) {
      const remainingId = getRemainingSplitSessionId(nextSplitPair, deleteTargetId);
      if (remainingId) {
        closeSplit();
        if (id !== remainingId) {
          navigate(`/session/${remainingId}`, { replace: true });
        }
        return;
      }
    }

    if (id === deleteTargetId) {
      const target = resolveCloseCurrentSessionTarget(
        useSessionStore.getState().sessions,
        deleteTargetId,
      );
      if (target.kind === "session") {
        navigate(`/session/${target.sessionId}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    }
  }, [closeSplit, deleteTargetId, id, navigate, removeSession, sessions, splitPair]);

  const handleSplitDrop = useCallback(
    (side: SplitPaneSide, droppedSessionId: string) => {
      if (!id || droppedSessionId === id) return;
      if (side === "left") {
        openSplit(droppedSessionId, id);
      } else {
        openSplit(id, droppedSessionId);
      }
    },
    [id, openSplit],
  );

  const handleReplacePane = useCallback(
    (side: SplitPaneSide, sessionIdToPlace: string) => {
      if (!splitPair) return;
      const targetSessionId = splitPair[side];
      replaceSplitPane(side, sessionIdToPlace);
      if (id === targetSessionId) {
        navigate(`/session/${sessionIdToPlace}`, { replace: true });
      }
    },
    [id, navigate, replaceSplitPane, splitPair],
  );

  const shellToolbarDescriptor = useMemo(() => {
    if (!id) {
      return {
        detail: "Open a session from the sidebar",
        kind: "title" as const,
        title: "Session",
      };
    }

    if (!routeSession && !effectiveSession) {
      return {
        detail: "This session may have been removed",
        kind: "title" as const,
        title: "Session",
      };
    }

    if (!effectiveSessionId || !effectiveSession) {
      return {
        detail: "This session may have been removed",
        kind: "title" as const,
        title: "Session",
      };
    }

    return {
      kind: "session" as const,
      sessionId: effectiveSessionId,
      onArchive: handleArchive,
      onClose: handleClose,
      onDelete: handleRequestDelete,
      onStop: handleStop,
    };
  }, [
    effectiveSession,
    effectiveSessionId,
    handleArchive,
    handleClose,
    handleRequestDelete,
    handleStop,
    id,
    routeSession,
  ]);
  useAppShellToolbar(shellToolbarDescriptor);

  if (!id || !routeSession) {
    // The redirect effect above sends us to "/" once the store is hydrated.
    // Render nothing in the meantime — a "Session not found" screen would
    // only flash for a single frame on the way out.
    return null;
  }

  if (isSplitActive && splitPair) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <SplitPaneContainer
          focusedPaneId={effectiveSessionId ?? focusedPaneId}
          leftSessionId={splitPair.left}
          rightSessionId={splitPair.right}
          onClosePane={collapseSplitPane}
          onFocusPane={setFocusedPaneId}
          onReplacePane={handleReplacePane}
          renderPane={(sessionId) => (
            <SessionPane
              key={sessionId}
              sessionId={sessionId}
              onFocus={() => setFocusedPaneId(sessionId)}
              onSearchOpenChange={setSearchOpen}
              onTerminated={(info) => {
                if (info.requestedByUser) {
                  collapseSplitPane(sessionId);
                }
              }}
              preferWebgl={false}
              searchOpen={searchOpen && effectiveSessionId === sessionId}
            />
          )}
        />

        <DeleteSessionDialog
          open={deleteTargetId !== null}
          onOpenChange={(open) => !open && setDeleteTargetId(null)}
          sessionTitle={deleteTargetSession?.title ?? ""}
          onConfirm={handleDeleteSession}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <SplitDropTarget sessionId={id} onDropSession={handleSplitDrop}>
        <SessionPane
          key={id}
          sessionId={id}
          onSearchOpenChange={setSearchOpen}
          onTerminated={(info) => {
            if (info.requestedByUser) {
              navigate("/", { replace: true });
            }
          }}
          searchOpen={searchOpen}
        />
      </SplitDropTarget>

      <DeleteSessionDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        sessionTitle={deleteTargetSession?.title ?? ""}
        onConfirm={handleDeleteSession}
      />
    </div>
  );
}
