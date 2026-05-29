import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getStepLabel, type SetupAssistantStep } from "./setup-assistant-model";

export function StepShell({
  align = "start",
  containerClassName,
  eyebrow,
  eyebrowClassName,
  headerClassName,
  titleClassName,
  titleWrapperClassName,
  descriptionClassName,
  title,
  description,
  children,
}: {
  align?: "start" | "center";
  containerClassName?: string;
  eyebrow?: ReactNode;
  eyebrowClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  titleWrapperClassName?: string;
  descriptionClassName?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        align === "center" ? "justify-center" : "justify-start",
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-8 pt-6 lg:px-10",
          containerClassName,
        )}
      >
        <div className={cn("space-y-2.5", headerClassName)}>
          {eyebrow ? (
            <div
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
                eyebrowClassName,
              )}
            >
              {eyebrow}
            </div>
          ) : null}
          <div className={cn("max-w-3xl space-y-2", titleWrapperClassName)}>
            <h1
              className={cn(
                "font-heading text-2xl font-semibold text-foreground sm:text-3xl",
                titleClassName,
              )}
            >
              {title}
            </h1>
            {description ? (
              <p
                className={cn(
                  "max-w-xl text-sm leading-6 text-muted-foreground",
                  descriptionClassName,
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StepFooter({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm leading-6 text-muted-foreground">{hint ?? <span />}</div>
      <div className="flex shrink-0 justify-end">{children}</div>
    </div>
  );
}

export function StepFooterDock({
  children,
  sticky = false,
}: {
  children: ReactNode;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        sticky && "sticky bottom-0 z-10 mt-auto border-t border-border/40 bg-background pb-2 pt-5",
      )}
    >
      {children}
    </div>
  );
}

export function SettingsStepCard({
  action,
  children,
  description,
  footer,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  title: string;
}) {
  return (
    <section className="setup-assistant-panel native-panel">
      <header className="border-b border-border/60 px-5 py-3.5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="font-heading text-base font-medium">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </header>
      <div className="space-y-5 px-5 py-4">
        {children}
        {footer ? <div className="border-t border-border/70 pt-5">{footer}</div> : null}
      </div>
    </section>
  );
}

export function ProgressRail({
  currentStep,
  steps,
  onStepSelect,
}: {
  currentStep: SetupAssistantStep;
  steps: SetupAssistantStep[];
  onStepSelect?: (step: SetupAssistantStep) => void;
}) {
  const currentIndex = steps.indexOf(currentStep);

  return (
    <nav
      aria-label="Onboarding progress"
      className="scrollbar-hide flex max-w-full overflow-x-auto overscroll-x-contain"
    >
      <div className="flex w-max items-center gap-1.5">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isUpcoming = index > currentIndex;

          return (
            <div key={step} className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={!isCompleted}
                onClick={() => onStepSelect?.(step)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium control-transition-native outline-none focus-ring-default",
                  isCurrent &&
                    "border-interactive-selected-border bg-interactive-selected text-foreground",
                  isCompleted &&
                    "cursor-pointer border-transparent bg-transparent text-foreground hover:bg-muted/55",
                  isUpcoming &&
                    "cursor-default border-transparent bg-transparent text-muted-foreground/76",
                )}
              >
                <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                  {isCompleted ? (
                    <Check aria-hidden="true" className="size-3.5 stroke-[3]" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 rounded-full border",
                        isCurrent ? "border-foreground/45" : "border-muted-foreground/35",
                      )}
                    />
                  )}
                </span>
                {getStepLabel(step)}
              </button>
              {index < steps.length - 1 ? (
                <ChevronRight
                  className={cn(
                    "size-3",
                    index < currentIndex ? "text-foreground/45" : "text-muted-foreground/55",
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
