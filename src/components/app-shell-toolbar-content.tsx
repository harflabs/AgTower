import type { ReactNode } from "react";
import { SIDEBAR_MOTION_DURATION_MS, SIDEBAR_MOTION_EASING } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AppShellTitleToolbar({ detail, title }: { detail?: string; title: string }) {
  return (
    <div className="selection-chrome flex min-w-0 flex-1 items-center justify-center px-4">
      <div className="flex min-w-0 max-w-[min(32rem,calc(100%-7rem))] items-center justify-center gap-2">
        <div className="window-toolbar-title max-w-[18rem] text-center sm:max-w-[22rem]">
          {title}
        </div>
        {detail ? (
          <div className="window-toolbar-caption hidden max-w-[14rem] truncate lg:block">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AppShellToolbarActionRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      style={{
        transform: "translate3d(calc(var(--sidebar-inset-offset) * -1), 0, 0)",
        transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
        transitionTimingFunction: SIDEBAR_MOTION_EASING,
      }}
      className={cn(
        "flex shrink-0 items-center transition-transform will-change-transform motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
