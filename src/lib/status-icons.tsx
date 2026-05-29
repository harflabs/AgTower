import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types/session";

interface StatusDotConfig {
  label: string;
  dotClass: string;
}

const STATUS_DOT_CONFIG: Record<SessionStatus, StatusDotConfig> = {
  running: { label: "Running", dotClass: "bg-primary" },
  idle: { label: "Idle", dotClass: "bg-muted-foreground/60" },
  needsAttention: { label: "Needs Attention", dotClass: "bg-warning" },
  closed: { label: "Closed", dotClass: "bg-success" },
  archived: { label: "Archived", dotClass: "bg-muted-foreground/60" },
};

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
