"use client";

import { CheckIcon, SearchIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { interactiveStyles } from "@/components/ui/interactive-styles";
import { menuItemBaseClass } from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

const CommandContext = React.createContext<{ listId: string } | null>(null);

function useCommandContext() {
  return React.useContext(CommandContext);
}

function Command({ className, ...props }: React.ComponentProps<"div">) {
  const listId = React.useId();

  return (
    <CommandContext.Provider value={{ listId }}>
      <div data-slot="command" className={cn("command-palette-root", className)} {...props} />
    </CommandContext.Provider>
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  commandProps,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  title?: string;
  description?: string;
  className?: string;
  commandProps?: React.ComponentProps<"div">;
}) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="command-palette-overlay"
          className="command-palette-overlay"
        />
        <DialogPrimitive.Content
          data-slot="command-palette-shell"
          className={cn("command-palette-shell", className)}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="sr-only">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
          </div>
          <Command {...commandProps}>{children}</Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const CommandInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & {
    onValueChange?: (value: string) => void;
  }
>(({ className, onValueChange, ...props }, ref) => {
  const context = useCommandContext();

  return (
    <div data-slot="command-input-wrapper">
      <InputGroup className="command-palette-search">
        <InputGroupAddon className="pr-0 text-muted-foreground/80">
          <SearchIcon className="size-4 shrink-0" />
        </InputGroupAddon>
        <input
          ref={ref}
          type="text"
          data-slot="command-input"
          className={cn("command-palette-search-input", className)}
          aria-controls={context?.listId}
          aria-label="Search commands"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            props.onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          {...props}
        />
      </InputGroup>
    </div>
  );
});
CommandInput.displayName = "CommandInput";

const CommandList = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ className, ...props }, ref) => {
    const context = useCommandContext();

    return (
      <div
        ref={ref}
        id={context?.listId}
        data-slot="command-list"
        role="listbox"
        aria-label="Command results"
        className={cn("command-palette-list", className)}
        {...props}
      />
    );
  },
);
CommandList.displayName = "CommandList";

function CommandEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-empty"
      className={cn("px-4 py-10 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandGroup({
  heading,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  heading?: React.ReactNode;
}) {
  return (
    <div
      data-slot="command-group"
      className={cn("overflow-hidden px-0 py-1.5 text-foreground", className)}
      {...props}
    >
      {heading ? <div className="command-palette-group-heading">{heading}</div> : null}
      {children}
    </div>
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-separator"
      role="separator"
      className={cn("mx-4 my-1 h-px bg-border/45", className)}
      {...props}
    />
  );
}

const CommandItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    selected?: boolean;
    onSelect?: () => void;
  }
>(({ className, children, selected = false, onSelect, onClick, ...props }, ref) => {
  const keyedChildren = React.Children.toArray(children);

  return (
    <div
      ref={ref}
      data-slot="command-item"
      data-selection="chrome"
      role="option"
      aria-selected={selected}
      data-selected={selected ? "true" : "false"}
      tabIndex={selected ? 0 : -1}
      className={cn(
        menuItemBaseClass,
        interactiveStyles.default.dataSelected,
        "group/command-item min-h-9 rounded-md px-2.5 py-1 transition-none duration-0",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onSelect?.();
        }
      }}
      {...props}
    >
      {keyedChildren}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </div>
  );
});
CommandItem.displayName = "CommandItem";

export {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
