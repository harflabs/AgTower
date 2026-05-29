import { interactiveStyles } from "@/components/ui/interactive-styles";
import { cn } from "@/lib/utils";

/**
 * Style for a menu-like item row. Kept for the command palette (`command.tsx`)
 * which still uses a Radix list. Native NSMenu items don't go through this —
 * they're rendered by AppKit directly (see `lib/native-menu.ts`).
 */
const menuItemBaseClass = cn(
  interactiveStyles.default.item,
  interactiveStyles.default.rovingFocus,
  "group/menu-item relative flex min-h-8 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium outline-hidden select-none data-inset:pl-8.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/12 data-[variant=destructive]:focus:border-destructive/30 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-[variant=destructive]:[&_svg]:text-destructive",
);

export { menuItemBaseClass };
