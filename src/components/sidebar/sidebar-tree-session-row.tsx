import { Columns2, MoreHorizontal } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { SessionContextMenu } from "@/components/sidebar/session-context-menu";
import { Input } from "@/components/ui/input";
import { interactiveStyles } from "@/components/ui/interactive-styles";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useSessionDrag } from "@/hooks/use-session-drag";
import { formatTimeAgo, sessionDisplayTitle } from "@/lib/session-helpers";
import { getSplitPaneSide } from "@/lib/split-view";
import { StatusDot, statusDotAnimationClass } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSplitViewStore } from "@/stores/split-view-store";
import type { SidebarSessionBucket } from "@/types/sidebar";

interface SidebarTreeSessionRowProps {
  nodeId: string;
  sessionId: string;
  bucket: SidebarSessionBucket;
  isFocused: boolean;
  focusMode: boolean;
  onRequestFocus: (nodeId: string) => void;
}

export const SidebarTreeSessionRow = forwardRef<HTMLButtonElement, SidebarTreeSessionRowProps>(
  function SidebarTreeSessionRow(
    { nodeId, sessionId, bucket, isFocused, focusMode, onRequestFocus },
    ref,
  ) {
    const session = useSessionStore((s) => s.sessions[sessionId]);
    const navigate = useNavigate();
    const params = useParams<{ id?: string }>();
    const renameSession = useSessionStore((s) => s.renameSession);
    const removeSession = useSessionStore((s) => s.removeSession);
    const renamingSessionId = useSidebarStore((s) => s.renamingSessionId);
    const setRenamingSessionId = useSidebarStore((s) => s.setRenamingSessionId);

    const [renameValue, setRenameValue] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const contextTriggerRef = useRef<HTMLLIElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const isRenaming = renamingSessionId === sessionId;
    const splitPair = useSplitViewStore((s) => s.splitPair);
    const focusedPaneId = useSplitViewStore((s) => s.focusedPaneId);
    const replaceSplitPane = useSplitViewStore((s) => s.replaceSplitPane);
    const draggingSessionId = useSplitViewStore((s) => s.draggingSessionId);
    const isBeingDragged = draggingSessionId === sessionId;
    const isInSplit =
      splitPair !== null && (splitPair.left === sessionId || splitPair.right === sessionId);
    const isActive = params.id === sessionId || isInSplit;
    const { onMouseDown: handleDragMouseDown, onClickCapture: handleDragClickCapture } =
      useSessionDrag(sessionId, !isRenaming);

    useEffect(() => {
      if (isRenaming && renameInputRef.current) {
        renameInputRef.current.focus();
        renameInputRef.current.select();
      }
    }, [isRenaming]);

    if (!session) return null;

    const isRunning = session.status === "running";
    const isAttention = session.status === "needsAttention";
    // "Live" = the agent could still produce work: an active status or an
    // attached PTY. Liveness — not recency — is what earns full color and
    // brightness in the list.
    const isLive = isRunning || isAttention || session.ptyActive;
    const showStatusIndicator =
      isRunning || isAttention || (session.status === "idle" && session.ptyActive);
    const timeAgo = formatTimeAgo(session.endedAt ?? session.createdAt);
    const rowFocused = isFocused && focusMode;
    const isHistory = bucket === "history";
    // Inactive rows recede in two tiers (recent-closed, then history) so the
    // eye partitions "working / needs me" from "done" at a glance. Hover and
    // the active route always restore full strength.
    const isInactive = !isLive && !isActive;
    const inactiveTextStyles = isInactive
      ? isHistory
        ? "text-sidebar-foreground/52 hover:text-sidebar-foreground"
        : "text-sidebar-foreground/65 hover:text-sidebar-foreground"
      : null;
    const displayTitle = sessionDisplayTitle(session);
    const isUntitled = displayTitle === "Untitled Session";

    function startRename() {
      setRenameValue(session.title);
      setRenamingSessionId(sessionId);
    }

    function finishRename() {
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== session.title) {
        renameSession(sessionId, trimmed);
      }
      setRenamingSessionId(null);
    }

    function handleOpen(e?: React.MouseEvent) {
      if (isRenaming) return;
      onRequestFocus(nodeId);
      useRepoStore.getState().setActiveRepo(session.repoId);

      if (e?.altKey && params.id) {
        if (splitPair && (splitPair.left === params.id || splitPair.right === params.id)) {
          const targetSessionId =
            (focusedPaneId &&
            (splitPair.left === focusedPaneId || splitPair.right === focusedPaneId)
              ? focusedPaneId
              : params.id) ?? params.id;
          const targetSide = getSplitPaneSide(splitPair, targetSessionId);

          if (targetSide) {
            const replacedSessionId = splitPair[targetSide];
            replaceSplitPane(targetSide, sessionId);
            if (replacedSessionId === params.id && replacedSessionId !== sessionId) {
              navigate(`/session/${sessionId}`, { replace: true });
            }
            return;
          }
        }

        if (params.id !== sessionId) {
          useSplitViewStore.getState().openSplit(params.id, sessionId);
          navigate(`/session/${params.id}`);
          return;
        }

        return;
      }

      navigate(`/session/${sessionId}`);
    }

    function openContextMenu() {
      const trigger = contextTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: rect.right,
          clientY: rect.top + 10,
        }),
      );
    }

    return (
      <>
        <SessionContextMenu
          session={session}
          onStartRename={startRename}
          onRequestDelete={() => setDeleteTarget({ id: sessionId, title: displayTitle })}
        >
          <SidebarMenuItem
            ref={contextTriggerRef}
            role="none"
            className="px-0"
            data-focused={rowFocused ? "true" : "false"}
            data-dragging={isBeingDragged ? "true" : "false"}
          >
            <SidebarMenuButton
              asChild
              isActive={isActive}
              size="sm"
              className={cn(
                "h-7 min-w-0 gap-2 py-0 pl-3.5 pr-8 text-left transition-[background-color,border-color,color,opacity] duration-100",
                rowFocused && !isActive && interactiveStyles.sidebar.focused,
                inactiveTextStyles,
                // Status gutter: a 2px inset edge marks live rows so the eye
                // can scan the left rail without reading titles. Inset shadow
                // (not border-l) so the row box never reflows, and it stacks
                // cleanly with the selection background tint.
                isRunning && "shadow-[inset_2px_0_0_0_var(--primary)]",
                isAttention && "shadow-[inset_2px_0_0_0_var(--warning)]",
                isBeingDragged &&
                  "border-transparent bg-sidebar-interactive-hover text-sidebar-foreground opacity-60",
              )}
            >
              <button
                ref={ref}
                type="button"
                role="treeitem"
                aria-selected={isActive}
                tabIndex={rowFocused ? 0 : -1}
                onPointerDown={(e) => {
                  // dnd-kit's PointerSensor is attached to the parent workspace
                  // container. Without this, pointerdowns on a session row
                  // start a workspace drag alongside the session drag.
                  e.stopPropagation();
                }}
                onMouseDown={handleDragMouseDown}
                onClickCapture={handleDragClickCapture}
                onFocus={() => onRequestFocus(nodeId)}
                onClick={(e) => handleOpen(e)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startRename();
                }}
              >
                <span className="relative inline-flex w-5 shrink-0 items-center justify-center">
                  {/* Color = alive: only live sessions keep the brand-color
                      logo; inactive rows desaturate so a running session is
                      findable by scanning for color. Hover restores the row
                      to full strength as one unit alongside the text. */}
                  <ProviderIcon
                    provider={session.provider}
                    variant="brand"
                    size={14}
                    className={cn(
                      isInactive && [
                        "grayscale transition-[filter,opacity] duration-100",
                        "group-hover/menu-item:grayscale-0 group-hover/menu-item:opacity-100",
                        isHistory ? "opacity-60" : "opacity-70",
                      ],
                    )}
                  />
                  {showStatusIndicator && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-[1px] -right-[1px] inline-flex items-center justify-center rounded-full bg-sidebar p-[1.5px]"
                    >
                      <StatusDot
                        status={session.status}
                        className={cn(
                          // needsAttention is the one signal that demands
                          // action: bigger dot, warning ring, outward glow.
                          // Running keeps the gentle heartbeat; live-idle is
                          // a static muted dot (paused, not gone).
                          isAttention ? "size-2 ring-1 ring-warning/40" : "size-1.5",
                          isRunning && "ring-1 ring-black/15 dark:ring-white/20",
                          statusDotAnimationClass(session.status),
                        )}
                      />
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  {isRenaming ? (
                    <Input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={finishRename}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishRename();
                        if (e.key === "Escape") setRenamingSessionId(null);
                        e.stopPropagation();
                      }}
                      aria-label="Rename session"
                      className="sidebar-inline-field h-6 px-1.5 text-[13px]"
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[1.05rem]",
                        // Weight backs up the brightness tier: live/selected
                        // rows read medium, settled rows read normal.
                        isLive || isActive ? "font-medium" : "font-normal",
                        isUntitled && "italic text-muted-foreground",
                      )}
                    >
                      <span className="min-w-0 truncate">{displayTitle}</span>
                      {isInSplit && <Columns2 className="size-3 shrink-0 text-primary/70" />}
                    </span>
                  )}
                </span>
              </button>
            </SidebarMenuButton>

            {!isRenaming && (
              <div className="absolute inset-y-0 right-1.5 z-10 flex items-center justify-end">
                {/* History rows drop the timestamp — their group label already
                    carries recency, and a dozen dates on dead rows is noise. */}
                {!isHistory && (
                  <span
                    className={cn(
                      "text-[10px] font-normal tabular-nums text-sidebar-foreground/45 transition-opacity duration-75 group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0",
                      rowFocused && "opacity-0",
                    )}
                  >
                    {timeAgo}
                  </span>
                )}
                <button
                  type="button"
                  data-no-drag
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={cn(
                    "absolute right-0 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/86 outline-none transition-[background-color,color,opacity] duration-75 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground",
                    rowFocused
                      ? "opacity-100"
                      : "opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100",
                  )}
                  aria-label="Session options"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </div>
            )}
          </SidebarMenuItem>
        </SessionContextMenu>

        <DeleteSessionDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          sessionTitle={deleteTarget?.title ?? ""}
          onConfirm={() => {
            if (!deleteTarget) return;
            removeSession(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      </>
    );
  },
);
