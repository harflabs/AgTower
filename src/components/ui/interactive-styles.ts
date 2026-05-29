export const interactiveStyles = {
  default: {
    item: "interactive-base interactive-surface-default interactive-focus-visible-default",
    rovingFocus: "interactive-roving-focus-default",
    dataSelected: "interactive-data-selected-default",
  },
  sidebar: {
    item: "interactive-base interactive-surface-sidebar interactive-focus-visible-sidebar",
    control:
      "control-transition-native hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-ring-sidebar",
    focused: "interactive-focused-sidebar",
    dataActive: "interactive-data-active-sidebar",
  },
} as const;
