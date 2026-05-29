import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { toast } from "sonner";
import { createContextMenuHandler, type NativeMenuItemSpec } from "@/lib/native-menu";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";

interface SessionContextMenuProps {
  session: Session;
  children: ReactNode;
  onStartRename: () => void;
  onRequestDelete: () => void;
}

export function SessionContextMenu({
  session,
  children,
  onStartRename,
  onRequestDelete,
}: SessionContextMenuProps) {
  const isLive =
    session.status === "running" ||
    session.status === "needsAttention" ||
    session.status === "idle";

  const handleContextMenu = createContextMenuHandler(() => {
    const specs: NativeMenuItemSpec[] = [];

    if (isLive) {
      specs.push(
        {
          kind: "item",
          text: "Stop",
          action: () => {
            invoke("kill_pty_session", { sessionId: session.id })
              .then(() => {
                useSessionStore.getState().updateSession(session.id, {
                  status: "closed",
                  endedAt: Date.now(),
                });
              })
              .catch(console.error);
          },
        },
        { kind: "separator" },
      );
    }

    const isPinned = !!useSidebarStore.getState().pinnedSessionIds[session.id];
    specs.push(
      { kind: "item", text: "Rename", accelerator: "F2", action: onStartRename },
      {
        kind: "item",
        text: isPinned ? "Unpin" : "Pin",
        action: () => useSidebarStore.getState().togglePinnedSession(session.id),
      },
      { kind: "separator" },
      {
        kind: "item",
        text: "Copy Session ID",
        action: () => {
          navigator.clipboard.writeText(session.id);
          toast.success("Session ID copied");
        },
      },
      { kind: "separator" },
      { kind: "item", text: "Delete", action: onRequestDelete },
    );

    return specs;
  });

  if (!isValidElement<{ onContextMenu?: (e: ReactMouseEvent) => void }>(children)) {
    return <>{children}</>;
  }

  const existing = children.props.onContextMenu;
  return cloneElement(children, {
    onContextMenu: (event: ReactMouseEvent) => {
      existing?.(event);
      if (event.defaultPrevented) return;
      void handleContextMenu(event);
    },
  });
}
