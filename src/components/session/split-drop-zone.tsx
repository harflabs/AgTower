import { PanelLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SplitDropOverlayProps {
  dropSide?: "left" | "right" | null;
  label?: string;
  mode?: "create" | "replace";
}

/** Visual overlay shown inside a container that handles its own drag events. */
export function SplitDropOverlay({
  dropSide = null,
  label,
  mode = "create",
}: SplitDropOverlayProps) {
  if (mode === "replace") {
    return (
      <div className="pointer-events-none absolute inset-0 z-40 bg-primary/8 ring-1 ring-inset ring-primary/35">
        <div className="flex h-full items-center justify-center">
          <span className="rounded-[4px] border border-border/65 bg-popover/92 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
            {label ?? "Replace pane"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex">
      <div
        className={cn(
          "relative flex flex-1 items-center justify-center border-r border-border/20 transition-colors duration-100",
          dropSide === "left"
            ? "bg-primary/10 text-foreground"
            : "bg-background/40 text-muted-foreground/45",
        )}
      >
        {dropSide === "left" && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary/60" />}
        <div className="flex items-center gap-2 rounded-[4px] border border-border/55 bg-popover/80 px-2.5 py-1 shadow-sm">
          <PanelLeft
            className={cn(
              "size-4",
              dropSide === "left" ? "text-foreground/70" : "text-muted-foreground/50",
            )}
          />
          <span
            className={cn(
              "text-xs font-medium",
              dropSide === "left" ? "text-foreground/75" : "text-muted-foreground/50",
            )}
          >
            Open left
          </span>
        </div>
      </div>

      <div
        className={cn(
          "relative flex flex-1 items-center justify-center transition-colors duration-100",
          dropSide === "right"
            ? "bg-primary/10 text-foreground"
            : "bg-background/40 text-muted-foreground/45",
        )}
      >
        {dropSide === "right" && (
          <span className="absolute inset-y-0 right-0 w-0.5 bg-primary/60" />
        )}
        <div className="flex items-center gap-2 rounded-[4px] border border-border/55 bg-popover/80 px-2.5 py-1 shadow-sm">
          <PanelRight
            className={cn(
              "size-4",
              dropSide === "right" ? "text-foreground/70" : "text-muted-foreground/50",
            )}
          />
          <span
            className={cn(
              "text-xs font-medium",
              dropSide === "right" ? "text-foreground/75" : "text-muted-foreground/50",
            )}
          >
            Open right
          </span>
        </div>
      </div>
    </div>
  );
}
