import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "native-text-field h-7 w-full min-w-0 rounded-md px-2 py-0.5 text-[13px] leading-[1.15rem] control-transition-native outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-ring-default disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
