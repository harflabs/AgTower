import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md border font-mono font-medium tabular-nums text-muted-foreground leading-none whitespace-nowrap select-none",
  {
    variants: {
      tone: {
        default: "border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        subtle: "border-border/55 bg-background/55",
      },
      size: {
        xs: "min-h-4 px-1 text-[10px]",
        sm: "min-h-5 px-1.5 text-[10px]",
      },
    },
    defaultVariants: {
      tone: "default",
      size: "sm",
    },
  },
);

function Kbd({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) {
  return <kbd className={cn(kbdVariants({ tone, size }), className)} {...props} />;
}

export { Kbd };
