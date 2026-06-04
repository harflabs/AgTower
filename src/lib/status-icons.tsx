import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types/session";

interface StatusDotConfig {
  label: string;
  dotClass: string;
  /** Motion for the dot; only running (heartbeat) and needsAttention (glow ping) move. */
  animationClass: string | null;
}

const STATUS_DOT_CONFIG: Record<SessionStatus, StatusDotConfig> = {
  running: { label: "Running", dotClass: "bg-primary", animationClass: "animate-pulse-dot" },
  idle: { label: "Idle", dotClass: "bg-muted-foreground/60", animationClass: null },
  needsAttention: {
    label: "Needs Attention",
    dotClass: "bg-warning",
    animationClass: "animate-attention-glow",
  },
  closed: { label: "Closed", dotClass: "bg-success", animationClass: null },
  archived: { label: "Archived", dotClass: "bg-muted-foreground/60", animationClass: null },
};

/**
 * Canonical status → dot color mapping, shared across the sidebar dot, the
 * kanban column headers, and the dashboard cards so a given status reads as the
 * same color everywhere: running = primary, needsAttention = warning, idle =
 * muted, closed = success, archived = muted.
 */
export function statusDotClass(status: SessionStatus): string {
  return STATUS_DOT_CONFIG[status].dotClass;
}

/**
 * Canonical status → dot motion mapping, shared by the sidebar rows, split
 * panes, session header, and dashboard cards so a given status moves the
 * same way everywhere: running gets the gentle pulse-dot heartbeat,
 * needsAttention gets the louder outward attention-glow ping (the one
 * signal demanding action), everything else is static.
 */
export function statusDotAnimationClass(status: SessionStatus): string | null {
  return STATUS_DOT_CONFIG[status].animationClass;
}

interface StatusDotProps {
  status: SessionStatus;
  className?: string;
}

/** Tiny colored dot for compact displays (sidebar, etc.) */
export function StatusDot({ status, className = "size-2" }: StatusDotProps) {
  const config = STATUS_DOT_CONFIG[status];
  return (
    <span
      role="status"
      aria-label={config.label}
      className={cn("rounded-full shrink-0 inline-block", className, config.dotClass)}
    />
  );
}
