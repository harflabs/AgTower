import { useRef } from "react";
import {
  SessionTerminal,
  type SessionTerminalHandle,
  type SessionTerminationInfo,
} from "@/components/session/session-terminal";
import { TerminalContextMenu } from "@/components/session/terminal-context-menu";
import { TerminalSearchBar } from "@/components/session/terminal-search-bar";
import { cn } from "@/lib/utils";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

interface SessionPaneProps {
  sessionId: string;
  onFocus?: () => void;
  onSearchOpenChange?: (open: boolean) => void;
  onTerminated?: (info: SessionTerminationInfo) => void;
  preferWebgl?: boolean;
  searchOpen?: boolean;
}

export function isSessionLive(session: Session | null | undefined): boolean {
  return !!session && ["running", "needsAttention", "idle"].includes(session.status);
}

export function SessionPane({
  sessionId,
  onFocus,
  onSearchOpenChange,
  onTerminated,
  preferWebgl = true,
  searchOpen = false,
}: SessionPaneProps) {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const termRef = useRef<SessionTerminalHandle>(null);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Session not found.
      </div>
    );
  }

  return (
    <section
      aria-label={session.title || "Session"}
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      onFocusCapture={onFocus}
    >
      <div className={cn("relative flex-1 min-h-0 overflow-hidden")}>
        <TerminalContextMenu terminalRef={termRef}>
          <SessionTerminal
            ref={termRef}
            sessionId={sessionId}
            onFocus={onFocus}
            onTerminated={onTerminated}
            preferWebgl={preferWebgl}
          />
        </TerminalContextMenu>
        {searchOpen && (
          <TerminalSearchBar
            searchAddon={termRef.current?.searchAddon ?? null}
            onClose={() => onSearchOpenChange?.(false)}
            onClosedFocusRestore={() => termRef.current?.focus()}
          />
        )}
      </div>
    </section>
  );
}
