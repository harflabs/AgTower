import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] control-transition-native outline-none select-none focus-ring-default disabled:pointer-events-none disabled:opacity-50 focus-ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary/55 bg-primary text-primary-foreground hover:bg-primary/92 active:bg-primary/86",
        outline:
          "border-border/75 bg-input/52 text-foreground hover:bg-input/70 aria-expanded:bg-input/76 aria-expanded:text-foreground dark:bg-input/40 dark:hover:bg-input/56",
        secondary:
          "border-border/55 bg-secondary/72 text-secondary-foreground hover:bg-secondary/86 aria-expanded:bg-secondary/86 aria-expanded:text-secondary-foreground",
        ghost:
          "border-transparent bg-transparent shadow-none hover:bg-muted/55 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground dark:hover:bg-muted/48",
        destructive:
          "border-destructive/24 bg-destructive/10 text-destructive hover:bg-destructive/18 focus-visible:border-destructive/40 focus-visible:ring-destructive/22 dark:bg-destructive/18 dark:hover:bg-destructive/26 dark:focus-visible:ring-destructive/40",
        link: "border-transparent bg-transparent text-primary shadow-none underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        toolbar:
          "h-7 gap-1.5 px-2.5 text-[12px] leading-none has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "toolbar-icon": "size-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      {...(!asChild ? { type: type ?? "button" } : {})}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
