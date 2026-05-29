import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SplitDropOverlay } from "@/components/session/split-drop-zone";
import { IconButton } from "@/components/ui/icon-button";
import { SESSION_DROP_EVENT, type SessionDropDetail } from "@/hooks/use-session-drag";
import type { SplitPaneSide } from "@/lib/split-view";
import { StatusDot } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/session-store";
import { useSplitViewStore } from "@/stores/split-view-store";

interface SplitPaneContainerProps {
  focusedPaneId: string | null;
  leftSessionId: string;
  onClosePane: (sessionId: string) => void;
  onFocusPane: (sessionId: string) => void;
  onReplacePane: (side: SplitPaneSide, sessionId: string) => void;
  renderPane: (sessionId: string, side: SplitPaneSide) => React.ReactNode;
  rightSessionId: string;
}

const DIVIDER_WIDTH = 10;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const KEYBOARD_RATIO_STEP = 0.05;

interface PaneHeaderProps {
  focused: boolean;
  onClose: () => void;
  onFocus: () => void;
  sessionId: string;
  side: SplitPaneSide;
}

interface ReplacePaneDropTargetProps {
  children: React.ReactNode;
  onDropSession: (side: SplitPaneSide, sessionId: string) => void;
  sessionId: string;
  side: SplitPaneSide;
  siblingSessionId: string;
}

function clampSplitRatio(ratio: number): number {
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, ratio));
}

function PaneHeader({ focused, onClose, onFocus, sessionId, side }: PaneHeaderProps) {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  if (!session) return null;

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border-b px-2.5 transition-colors duration-100",
        focused
          ? "border-border/65 bg-background text-foreground"
          : "border-border/45 bg-background text-muted-foreground/82",
      )}
      onFocusCapture={onFocus}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-1 py-1 text-left focus-ring-default"
        onClick={onFocus}
      >
        <StatusDot
          status={session.status}
          className={cn("size-2 shrink-0", session.status === "running" && "animate-pulse-dot")}
        />
        <span className="min-w-0 truncate text-xs font-medium">{session.title}</span>
      </button>
      <IconButton
        className="size-6 rounded-[4px] border-none bg-transparent text-muted-foreground/72 shadow-none hover:bg-muted/65 hover:text-foreground"
        label={`Close ${side} pane`}
        size="icon-sm"
        tooltip={false}
        variant="ghost"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}

function ReplacePaneDropTarget({
  children,
  onDropSession,
  sessionId,
  side,
  siblingSessionId,
}: ReplacePaneDropTargetProps) {
  const draggingSessionId = useSplitViewStore((s) => s.draggingSessionId);
  const [isOver, setIsOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = !!draggingSessionId && draggingSessionId !== sessionId;
  const overlayLabel =
    draggingSessionId === siblingSessionId
      ? "Swap panes"
      : side === "left"
        ? "Replace left pane"
        : "Replace right pane";

  useEffect(() => {
    if (!isActive) {
      setIsOver(false);
      return;
    }

    function isOverElement(clientX: number, clientY: number): boolean {
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
      setIsOver(isOverElement(event.clientX, event.clientY));
    }

    function handleDrop(event: Event) {
      const detail = (event as CustomEvent<SessionDropDetail>).detail;
      if (detail.sessionId === sessionId) return;
      if (!isOverElement(detail.clientX, detail.clientY)) return;

      onDropSession(side, detail.sessionId);
      setIsOver(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener(SESSION_DROP_EVENT, handleDrop);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener(SESSION_DROP_EVENT, handleDrop);
    };
  }, [isActive, onDropSession, sessionId, side]);

  return (
    <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden">
      {children}
      {isOver && <SplitDropOverlay label={overlayLabel} mode="replace" />}
    </div>
  );
}

export function SplitPaneContainer({
  focusedPaneId,
  leftSessionId,
  onClosePane,
  onFocusPane,
  onReplacePane,
  renderPane,
  rightSessionId,
}: SplitPaneContainerProps) {
  const splitRatio = useSplitViewStore((s) => s.splitRatio);
  const setSplitRatio = useSplitViewStore((s) => s.setSplitRatio);

  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRatioRef = useRef(splitRatio);
  const startRatioRef = useRef(splitRatio);
  const startXRef = useRef(0);
  const containerWidthRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const applyLiveRatio = useCallback(
    (ratio: number) => {
      const nextRatio = clampSplitRatio(ratio);
      pendingRatioRef.current = nextRatio;
      setSplitRatio(nextRatio);
      return nextRatio;
    },
    [setSplitRatio],
  );

  useEffect(() => {
    pendingRatioRef.current = splitRatio;
    if (!dragging) {
      startRatioRef.current = splitRatio;
    }
  }, [dragging, splitRatio]);

  useEffect(() => {
    if (!dragging) return;

    function handleMouseMove(event: MouseEvent) {
      event.preventDefault();
      const containerWidth = containerWidthRef.current;
      if (containerWidth <= 0) return;

      const deltaX = event.clientX - startXRef.current;
      pendingRatioRef.current = startRatioRef.current + deltaX / containerWidth;
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applyLiveRatio(pendingRatioRef.current);
      });
    }

    function handleMouseUp() {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      applyLiveRatio(pendingRatioRef.current);
      setDragging(false);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [applyLiveRatio, dragging]);

  const handleDividerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLHRElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const width = container.getBoundingClientRect().width;
      if (width <= 0) return;

      startXRef.current = event.clientX;
      startRatioRef.current = splitRatio;
      pendingRatioRef.current = splitRatio;
      containerWidthRef.current = width;
      setDragging(true);
    },
    [splitRatio],
  );

  const handleDividerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLHRElement>) => {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          applyLiveRatio(splitRatio - KEYBOARD_RATIO_STEP);
          break;
        case "ArrowRight":
          event.preventDefault();
          applyLiveRatio(splitRatio + KEYBOARD_RATIO_STEP);
          break;
        case "Home":
          event.preventDefault();
          applyLiveRatio(MIN_SPLIT_RATIO);
          break;
        case "End":
          event.preventDefault();
          applyLiveRatio(MAX_SPLIT_RATIO);
          break;
      }
    },
    [applyLiveRatio, splitRatio],
  );

  const leftWidth = `calc(${splitRatio * 100}% - ${DIVIDER_WIDTH / 2}px)`;
  const rightWidth = `calc(${(1 - splitRatio) * 100}% - ${DIVIDER_WIDTH / 2}px)`;
  const dividerValue = Math.round(splitRatio * 100);

  return (
    <div
      ref={containerRef}
      className={cn("flex flex-1 min-h-0 overflow-hidden", dragging && "select-none")}
    >
      <div className="flex min-h-0" style={{ width: leftWidth }}>
        <ReplacePaneDropTarget
          sessionId={leftSessionId}
          siblingSessionId={rightSessionId}
          side="left"
          onDropSession={onReplacePane}
        >
          <section
            aria-label="Left split pane"
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background transition-colors",
              focusedPaneId === leftSessionId && "bg-background",
            )}
          >
            <PaneHeader
              focused={focusedPaneId === leftSessionId}
              sessionId={leftSessionId}
              side="left"
              onClose={() => onClosePane(leftSessionId)}
              onFocus={() => onFocusPane(leftSessionId)}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              {renderPane(leftSessionId, "left")}
            </div>
          </section>
        </ReplacePaneDropTarget>
      </div>

      <div className="group relative flex shrink-0 items-center justify-center">
        <hr
          aria-label="Resize split panes"
          aria-orientation="vertical"
          aria-valuemax={MAX_SPLIT_RATIO * 100}
          aria-valuemin={MIN_SPLIT_RATIO * 100}
          aria-valuenow={dividerValue}
          className={cn(
            "flex h-full w-[10px] cursor-col-resize items-center justify-center border-0 transition-colors duration-100 focus-ring-default",
            dragging ? "bg-muted/55" : "bg-transparent group-hover:bg-muted/32",
          )}
          tabIndex={0}
          onKeyDown={handleDividerKeyDown}
          onMouseDown={handleDividerMouseDown}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
            dragging ? "bg-muted-foreground/55" : "bg-border/80 group-hover:bg-muted-foreground/34",
          )}
        />
      </div>

      <div className="flex min-h-0" style={{ width: rightWidth }}>
        <ReplacePaneDropTarget
          sessionId={rightSessionId}
          siblingSessionId={leftSessionId}
          side="right"
          onDropSession={onReplacePane}
        >
          <section
            aria-label="Right split pane"
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background transition-colors",
              focusedPaneId === rightSessionId && "bg-background",
            )}
          >
            <PaneHeader
              focused={focusedPaneId === rightSessionId}
              sessionId={rightSessionId}
              side="right"
              onClose={() => onClosePane(rightSessionId)}
              onFocus={() => onFocusPane(rightSessionId)}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              {renderPane(rightSessionId, "right")}
            </div>
          </section>
        </ReplacePaneDropTarget>
      </div>
    </div>
  );
}
