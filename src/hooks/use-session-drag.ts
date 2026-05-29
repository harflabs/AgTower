import { useCallback, useEffect, useRef } from "react";
import { performHaptic } from "@/lib/haptics";
import { useSplitViewStore } from "@/stores/split-view-store";

const DRAG_THRESHOLD = 6;

/** Custom event dispatched when a session drag ends (mouseup). */
export const SESSION_DROP_EVENT = "session-drag-drop";

export interface SessionDropDetail {
  sessionId: string;
  clientX: number;
  clientY: number;
}

/**
 * Custom mouse-based drag for sidebar session items.
 *
 * HTML5 DnD is broken in Tauri v2's WKWebView (wry intercepts all native
 * drag events). This hook uses mousedown/mousemove/mouseup instead.
 *
 * On mouseup, dispatches a `session-drag-drop` CustomEvent so drop targets
 * can handle the drop without competing window-level listener ordering.
 */
export function useSessionDrag(sessionId: string, enabled = true) {
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const didExceedThreshold = useRef(false);
  const suppressNextClick = useRef(false);
  const activeListeners = useRef<{
    blur: (() => void) | null;
    keyDown: ((e: KeyboardEvent) => void) | null;
    mouseMove: ((e: MouseEvent) => void) | null;
    mouseUp: ((e: MouseEvent) => void) | null;
  }>({ blur: null, keyDown: null, mouseMove: null, mouseUp: null });

  const cleanupDrag = useCallback(() => {
    const { blur, keyDown, mouseMove, mouseUp } = activeListeners.current;
    if (blur) {
      window.removeEventListener("blur", blur);
    }
    if (keyDown) {
      window.removeEventListener("keydown", keyDown);
    }
    if (mouseMove) {
      window.removeEventListener("mousemove", mouseMove);
    }
    if (mouseUp) {
      window.removeEventListener("mouseup", mouseUp);
    }
    activeListeners.current = { blur: null, keyDown: null, mouseMove: null, mouseUp: null };
    isDragging.current = false;
    didExceedThreshold.current = false;
    document.body.style.userSelect = "";
    useSplitViewStore.getState().setDraggingSession(null);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [data-no-drag]")) return;

      // Session rows live inside workspace containers that have dnd-kit's
      // PointerSensor listeners attached. Without this stopPropagation, the
      // same mousedown starts a workspace drag alongside the session drag —
      // the user's intent was session-only.
      e.stopPropagation();

      isDragging.current = true;
      didExceedThreshold.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;

        const dx = moveEvent.clientX - startPos.current.x;
        const dy = moveEvent.clientY - startPos.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!didExceedThreshold.current && dist >= DRAG_THRESHOLD) {
          didExceedThreshold.current = true;
          document.body.style.userSelect = "none";
          useSplitViewStore
            .getState()
            .setDraggingSession(sessionId, { x: moveEvent.clientX, y: moveEvent.clientY });
          return;
        }

        if (didExceedThreshold.current) {
          moveEvent.preventDefault();
          useSplitViewStore
            .getState()
            .setDraggingSessionPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        if (!isDragging.current) {
          cleanupDrag();
          return;
        }

        const shouldDispatchDrop = didExceedThreshold.current;
        if (shouldDispatchDrop) {
          suppressNextClick.current = true;
          performHaptic("alignment");
          window.dispatchEvent(
            new CustomEvent<SessionDropDetail>(SESSION_DROP_EVENT, {
              detail: { sessionId, clientX: upEvent.clientX, clientY: upEvent.clientY },
            }),
          );
        }

        cleanupDrag();
      };

      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          suppressNextClick.current = didExceedThreshold.current;
          cleanupDrag();
        }
      };

      activeListeners.current = {
        blur: cleanupDrag,
        keyDown: handleKeyDown,
        mouseMove: handleMouseMove,
        mouseUp: handleMouseUp,
      };
      window.addEventListener("blur", cleanupDrag);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [cleanupDrag, enabled, sessionId],
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(() => cleanupDrag, [cleanupDrag]);

  return { onMouseDown: handleMouseDown, onClickCapture: handleClick };
}
