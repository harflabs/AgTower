import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<React.ComponentProps<typeof Button>, "aria-label" | "children"> & {
  label: string;
  tooltip?: string | false;
  children: React.ReactNode;
};

function IconButton({ label, tooltip, className, children, ...props }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={tooltip === false ? undefined : (tooltip ?? label)}
      className={cn("shrink-0", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export { IconButton };
