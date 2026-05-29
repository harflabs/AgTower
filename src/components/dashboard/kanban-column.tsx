import { CheckCircle2, CircleDot, type OctagonX as OctagonXType } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { createContextMenuHandler, type NativeMenuItemSpec } from "@/lib/native-menu";
import type { KanbanColumnKey } from "@/lib/session-helpers";
import { cn } from "@/lib/utils";

const COLUMN_CONFIG: Record<
  KanbanColumnKey,
  {
    badgeClass: string;
    dotClass: string;
  }
> = {
  running: {
    badgeClass: "border-border/70 bg-background/70 text-muted-foreground",
    dotClass: "bg-success",
  },
  attention: {
    badgeClass: "border-border/70 bg-background/70 text-muted-foreground",
    dotClass: "bg-warning",
  },
  idle: {
    badgeClass: "border-border/70 bg-background/70 text-muted-foreground",
    dotClass: "bg-muted-foreground/50",
  },
};

interface KanbanColumnProps {
  columnKey: KanbanColumnKey;
  label: string;
  count: number;
  action?: {
    label: string;
    icon: typeof OctagonXType;
    onClick: () => void;
    variant?: "destructive" | "ghost";
  };
  children: React.ReactNode;
}

export function KanbanColumn({ columnKey, label, count, action, children }: KanbanColumnProps) {
  const config = COLUMN_CONFIG[columnKey];

  const handleHeaderContextMenu = createContextMenuHandler(() => {
    if (!action || count === 0) return [];
    const specs: NativeMenuItemSpec[] = [
      { kind: "item", text: action.label, action: action.onClick },
    ];
    return specs;
  });

  return (
    <div className="flex h-full min-h-0 min-w-[17rem] flex-1 basis-0 flex-col overflow-hidden border-r border-border/55 text-sm last:border-r-0">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: native column header context menu */}
      <div
        onContextMenu={handleHeaderContextMenu}
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", config.dotClass)} />
          <span className="truncate text-[12px] font-medium text-foreground">{label}</span>
          {count > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 h-5 shrink-0 rounded-md px-1.5 text-[10px] font-medium tabular-nums shadow-none",
                config.badgeClass,
              )}
            >
              {count}
            </Badge>
          )}
        </div>
        {action && count > 0 ? (
          <IconButton
            label={action.label}
            variant="ghost"
            size="icon-xs"
            className={cn(
              "size-6 border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted/55 hover:text-foreground",
              action.variant === "destructive" &&
                "text-destructive/80 hover:bg-destructive/10 hover:text-destructive",
            )}
            onClick={action.onClick}
          >
            <action.icon className="size-3.5" />
          </IconButton>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-2">
        {count === 0 ? (
          <EmptyState columnKey={columnKey} />
        ) : (
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            <AnimatePresence mode="popLayout">{children}</AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ columnKey }: { columnKey: KanbanColumnKey }) {
  const messages: Record<KanbanColumnKey, { icon: typeof CircleDot; text: string }> = {
    running: { icon: CircleDot, text: "No agents running" },
    idle: { icon: CircleDot, text: "No idle sessions" },
    attention: { icon: CheckCircle2, text: "All clear" },
  };
  const { icon: MsgIcon, text } = messages[columnKey];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-muted-foreground/55">
      <div className="flex items-center gap-2">
        <MsgIcon className="size-4" />
        <p className="text-xs">{text}</p>
      </div>
    </div>
  );
}
