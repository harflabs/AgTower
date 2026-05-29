import { formatShortcutLabel, SHORTCUTS } from "@/lib/keyboard/registry";
import { IS_MACOS } from "@/lib/platform";

interface ShortcutHelpEntry {
  id: string;
  label: string;
  note?: string;
  shortcuts: string[];
}

interface ShortcutHelpSection {
  id: string;
  title: string;
  context: string;
  entries: ShortcutHelpEntry[];
}

const META = IS_MACOS ? "\u2318" : "Ctrl+";
const SHIFT = IS_MACOS ? "\u21e7" : "Shift+";

function getShortcutsByAction(actionId: string) {
  return SHORTCUTS.filter((shortcut) => shortcut.actionId === actionId);
}

function registryEntry(
  actionId: string,
  overrides: Partial<ShortcutHelpEntry> = {},
): ShortcutHelpEntry {
  const shortcuts = getShortcutsByAction(actionId);
  const shortcut = shortcuts[0];
  if (!shortcut) {
    throw new Error(`Missing shortcut definition for action "${actionId}"`);
  }

  return {
    id: shortcut.id,
    label: shortcut.label,
    shortcuts: shortcuts.map(formatShortcutLabel),
    ...overrides,
  };
}

export function getShortcutHelpSections(): ShortcutHelpSection[] {
  return [
    {
      id: "app-navigation",
      title: "App",
      context: "Global",
      entries: [
        registryEntry("command-palette"),
        registryEntry("shortcut-help"),
        registryEntry("preferences"),
        registryEntry("new-session"),
        registryEntry("new-terminal"),
        registryEntry("close-context"),
        registryEntry("sync-cli-sessions"),
        registryEntry("next-attention-session"),
        registryEntry("prev-attention-session"),
        registryEntry("next-open-session"),
        registryEntry("prev-open-session"),
        registryEntry("go-dashboard"),
        registryEntry("go-settings"),
        registryEntry("go-new-session"),
        registryEntry("new-session-quick", {
          label: "New session on dashboard",
          shortcuts: ["N"],
        }),
        {
          id: "app.select-all",
          label: "Select current content",
          shortcuts: [`${META}A`],
        },
      ],
    },
    {
      id: "session",
      title: "Session",
      context: "Active session",
      entries: [
        registryEntry("toggle-search"),
        registryEntry("mark-done-advance", {
          note: "Archive and advance",
        }),
        registryEntry("terminal-scale-up"),
        registryEntry("terminal-scale-down"),
        registryEntry("terminal-scale-reset"),
      ],
    },
    {
      id: "sidebar",
      title: "Sidebar",
      context: "Sidebar focus",
      entries: [
        registryEntry("focus-sidebar"),
        registryEntry("focus-sidebar-search"),
        registryEntry("toggle-sidebar"),
        registryEntry("rename-session"),
        {
          id: "sidebar.move-between-rows",
          label: "Navigate rows",
          shortcuts: ["J / K", "\u2191 / \u2193"],
        },
        {
          id: "sidebar.open-or-toggle",
          label: "Open / toggle",
          shortcuts: ["\u21b5"],
        },
        {
          id: "sidebar.expand-or-collapse",
          label: "Expand / collapse",
          shortcuts: ["\u2190 / \u2192"],
        },
        {
          id: "sidebar.toggle-section",
          label: "Toggle section",
          shortcuts: ["Space"],
        },
        {
          id: "sidebar.archive-session",
          label: "Archive the focused session",
          shortcuts: ["Delete", "Backspace"],
        },
        {
          id: "sidebar.exit-focus",
          label: "Exit sidebar focus",
          shortcuts: ["Esc"],
        },
      ],
    },
    {
      id: "search",
      title: "Search",
      context: "Search open",
      entries: [
        {
          id: "search.next-match",
          label: "Next match",
          shortcuts: ["\u21b5"],
        },
        {
          id: "search.prev-match",
          label: "Previous match",
          shortcuts: [`${SHIFT}\u21b5`],
        },
        {
          id: "search.close",
          label: "Close search",
          shortcuts: ["Esc"],
        },
      ],
    },
    {
      id: "command-palette",
      title: "Palette",
      context: "Palette open",
      entries: [
        {
          id: "palette.move-between-results",
          label: "Navigate results",
          shortcuts: ["\u2191 / \u2193"],
        },
        {
          id: "palette.run-selected",
          label: "Run the selected command",
          shortcuts: ["\u21b5"],
        },
        {
          id: "palette.open-session-in-split",
          label: "Open session in split pane",
          shortcuts: [`${META}\u21b5`],
        },
        {
          id: "palette.jump-edges",
          label: "Jump to first / last",
          shortcuts: ["Home / End"],
        },
        {
          id: "palette.jump-pages",
          label: "Jump by page",
          shortcuts: ["PageUp / PageDown"],
        },
        {
          id: "palette.toggle-preview",
          label: "Open / close preview",
          shortcuts: ["\u2192 / \u2190"],
        },
        {
          id: "palette.close",
          label: "Close the palette",
          shortcuts: ["Esc"],
        },
      ],
    },
  ];
}
