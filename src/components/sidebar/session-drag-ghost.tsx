import { createPortal } from "react-dom";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { useSessionStore } from "@/stores/session-store";
import { useSplitViewStore } from "@/stores/split-view-store";

/**
 * Floating translucent preview that follows the cursor while a sidebar
 * session row is being mouse-dragged. Matches Finder's behavior where a
 * small copy of the dragged item trails the cursor — without it, users
 * can't tell the drag registered (the source row just dims).
 *
 * We rely on `useSplitViewStore.draggingSessionId`, which `useSessionDrag`
 * already sets/clears at the drag threshold. Portal-rendered at the body
 * so it escapes any stacking/overflow containers.
 */
export function SessionDragGhost() {
  const draggingSessionId = useSplitViewStore((s) => s.draggingSessionId);
  const position = useSplitViewStore((s) => s.draggingSessionPosition);
  const session = useSessionStore((s) =>
    draggingSessionId ? s.sessions[draggingSessionId] : null,
  );

  if (!draggingSessionId || !session || !position) return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="sidebar-drag-preview pointer-events-none fixed left-0 top-0 z-50 flex h-7 max-w-64 items-center gap-2 px-2.5 text-[13px] font-normal text-foreground select-none"
      style={{
        maxWidth: "16rem",
        transform: `translate3d(${position.x + 10}px, ${position.y + 8}px, 0)`,
        willChange: "transform",
      }}
    >
      <ProviderIcon provider={session.provider} variant="brand" size={14} />
      <span className="min-w-0 truncate">{session.title || "Session"}</span>
    </div>,
    document.body,
  );
}
