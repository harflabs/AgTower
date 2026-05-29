import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

interface BreadcrumbSegment {
  label: string;
  onClick: () => void;
  ariaLabel?: string;
}

interface BreadcrumbProps {
  parents: BreadcrumbSegment[];
  current: ReactNode;
}

export function Breadcrumb({ parents, current }: BreadcrumbProps) {
  if (parents.length === 0) {
    return <>{current}</>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {parents.map((parent) => (
        <Fragment key={parent.label}>
          <button
            type="button"
            onClick={parent.onClick}
            aria-label={parent.ariaLabel ?? `Go to ${parent.label}`}
            className="window-toolbar-title-button max-w-[12rem] shrink-0 truncate rounded-md px-1 py-0 text-[13px] font-medium leading-none"
            style={{ color: "var(--window-toolbar-caption-foreground)" }}
          >
            {parent.label}
          </button>
          <ChevronRight
            className="size-3 shrink-0"
            style={{ color: "var(--window-toolbar-caption-foreground)" }}
            aria-hidden
          />
        </Fragment>
      ))}
      <div className="min-w-0 flex-1">{current}</div>
    </div>
  );
}
