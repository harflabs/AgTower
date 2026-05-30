import { IS_MACOS } from "@/lib/platform";
import type { ShortcutDefinition } from "./types";

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "system.command-palette",
    key: "k",
    modifiers: { meta: true },
    scope: "global",
    label: "Command palette",
    actionId: "command-palette",
  },
  {
    id: "system.new-session",
    key: "t",
    modifiers: { meta: true },
    scope: "global",
    label: "New session",
    actionId: "new-session",
  },
  {
    id: "system.new-terminal",
    key: "t",
    modifiers: { meta: true, shift: true },
    scope: "global",
    label: "New terminal",
    actionId: "new-terminal",
  },
  {
    id: "system.close-context",
    key: "w",
    modifiers: { meta: true },
    scope: "global",
    label: "Close current context",
    actionId: "close-context",
  },
  {
    id: "system.preferences",
    key: ",",
    modifiers: { meta: true },
    scope: "global",
    label: "Settings",
    actionId: "preferences",
  },
  {
    id: "system.shortcut-help",
    key: "?",
    scope: "global",
    label: "Keyboard shortcuts",
    actionId: "shortcut-help",
  },
  {
    id: "system.shortcut-help-menu",
    key: "/",
    modifiers: { meta: true },
    scope: "global",
    label: "Keyboard shortcuts",
    actionId: "shortcut-help",
  },
  {
    id: "system.search",
    key: "f",
    modifiers: { meta: true },
    scope: "session",
    label: "Search terminal",
    actionId: "toggle-search",
  },
  // Triage — work in both terminal and app context (modifier-based)
  {
    id: "system.mark-done-advance",
    key: "e",
    modifiers: { meta: true },
    scope: "global",
    label: "Archive and Advance",
    actionId: "mark-done-advance",
  },
  {
    id: "system.focus-sidebar",
    key: "Escape",
    modifiers: { meta: true },
    scope: "global",
    label: "Focus sidebar",
    actionId: "focus-sidebar",
  },
  {
    id: "system.focus-sidebar-search",
    key: "f",
    modifiers: { meta: true, shift: true },
    scope: "global",
    label: "Search sessions in sidebar",
    actionId: "focus-sidebar-search",
  },

  // Attention cycling
  {
    id: "nav.next-attention",
    key: "j",
    modifiers: { meta: true },
    scope: "global",
    label: "Next attention session",
    actionId: "next-attention-session",
  },
  {
    id: "nav.prev-attention",
    key: "j",
    modifiers: { meta: true, shift: true },
    scope: "global",
    label: "Previous attention session",
    actionId: "prev-attention-session",
  },
  {
    id: "nav.next-open",
    key: "]",
    modifiers: { meta: true },
    scope: "global",
    label: "Next open session",
    actionId: "next-open-session",
  },
  {
    id: "nav.prev-open",
    key: "[",
    modifiers: { meta: true },
    scope: "global",
    label: "Previous open session",
    actionId: "prev-open-session",
  },
  // Tab-switcher aliases for the open-session cycle, matching the Ctrl+Tab
  // convention from terminals and tab-based apps. Ctrl is distinct from Cmd
  // (Cmd+Tab is the macOS app switcher), so these use the `ctrl` modifier.
  {
    id: "nav.next-open-tab",
    key: "Tab",
    modifiers: { ctrl: true },
    scope: "global",
    label: "Next open session",
    actionId: "next-open-session",
  },
  {
    id: "nav.prev-open-tab",
    key: "Tab",
    modifiers: { ctrl: true, shift: true },
    scope: "global",
    label: "Previous open session",
    actionId: "prev-open-session",
  },

  // Navigation — leader sequences
  {
    id: "nav.dashboard",
    key: "d",
    leader: "g",
    scope: "global",
    label: "Go to Dashboard",
    actionId: "go-dashboard",
  },
  {
    id: "nav.settings",
    key: "s",
    leader: "g",
    scope: "global",
    label: "Go to Settings",
    actionId: "go-settings",
  },
  {
    id: "nav.new-session-go",
    key: "n",
    leader: "g",
    scope: "global",
    label: "Go to New Session",
    actionId: "go-new-session",
  },

  // Actions
  {
    id: "action.new-session",
    key: "n",
    scope: "dashboard",
    label: "New session",
    actionId: "new-session-quick",
  },
  {
    id: "session.terminal-scale-up",
    key: "=",
    modifiers: { meta: true },
    scope: "session",
    label: "Increase terminal font size",
    actionId: "terminal-scale-up",
  },
  // Shift+Cmd+= produces `+` — alias so both key combinations zoom in.
  {
    id: "session.terminal-scale-up-plus",
    key: "+",
    modifiers: { meta: true },
    scope: "session",
    label: "Increase terminal font size",
    actionId: "terminal-scale-up",
  },
  {
    id: "session.terminal-scale-down",
    key: "-",
    modifiers: { meta: true },
    scope: "session",
    label: "Decrease terminal font size",
    actionId: "terminal-scale-down",
  },
  {
    id: "session.terminal-scale-reset",
    key: "0",
    modifiers: { meta: true },
    scope: "session",
    label: "Reset terminal font size",
    actionId: "terminal-scale-reset",
  },
  {
    id: "system.sync-cli-sessions",
    key: "s",
    modifiers: { meta: true, shift: true },
    scope: "global",
    label: "Sync CLI sessions",
    actionId: "sync-cli-sessions",
  },

  // Sidebar actions
  {
    id: "sidebar.rename-session",
    key: "F2",
    scope: "global",
    label: "Rename session",
    actionId: "rename-session",
  },
  {
    id: "sidebar.toggle",
    key: "b",
    modifiers: { meta: true },
    scope: "global",
    label: "Toggle sidebar",
    actionId: "toggle-sidebar",
  },
];

export function getShortcutLabel(actionId: string): string | undefined {
  const def = SHORTCUTS.find((s) => s.actionId === actionId);
  if (!def) return undefined;
  return formatShortcutLabel(def);
}

export function formatShortcutLabel(def: ShortcutDefinition): string {
  if (IS_MACOS) {
    const parts: string[] = [];
    if (def.leader) {
      parts.push(def.leader.toUpperCase());
      parts.push(" then ");
    }
    // Order follows the macOS convention: \u2303\u2325\u21e7\u2318.
    if (def.modifiers?.ctrl) parts.push("\u2303");
    if (def.modifiers?.alt) parts.push("\u2325");
    if (def.modifiers?.shift) parts.push("\u21e7");
    if (def.modifiers?.meta) parts.push("\u2318");
    parts.push(formatMacKey(def.key));
    return parts.join("");
  }

  const parts: string[] = [];
  if (def.leader) {
    parts.push(def.leader.toUpperCase());
    parts.push(" then ");
  }
  if (def.modifiers?.meta || def.modifiers?.ctrl) parts.push("Ctrl+");
  if (def.modifiers?.shift) parts.push("Shift+");
  if (def.modifiers?.alt) parts.push("Alt+");
  parts.push(def.key.length === 1 ? def.key.toUpperCase() : def.key);
  return parts.join("");
}

function formatMacKey(key: string): string {
  if (key === "Escape") return "Esc";
  if (key === "ArrowUp") return "\u2191";
  if (key === "ArrowDown") return "\u2193";
  if (key === "ArrowLeft") return "\u2190";
  if (key === "ArrowRight") return "\u2192";
  if (key === "Enter") return "\u21b5";
  if (key === "Tab") return "\u21e5";
  if (key === "Backspace") return "\u232b";
  if (key === "Delete") return "\u2326";
  return key.length === 1 ? key.toUpperCase() : key;
}
