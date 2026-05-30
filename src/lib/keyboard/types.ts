export type ShortcutScope = "global" | "session" | "dashboard";

export interface ShortcutDefinition {
  /** Unique identifier, e.g. "nav.dashboard" */
  id: string;
  /** The key to match (e.g. "k", "n", "Escape", "?") */
  key: string;
  /** Required modifier keys */
  modifiers?: {
    /**
     * Primary modifier — Cmd on macOS, Ctrl elsewhere. The dispatcher treats
     * metaKey and ctrlKey interchangeably for this flag.
     */
    meta?: boolean;
    /**
     * The physical Control key, distinct from {@link meta}. Matches only when
     * Ctrl is held without Cmd, so Ctrl-specific chords (e.g. Ctrl+Tab) don't
     * collide with macOS Cmd shortcuts.
     */
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  };
  /** Leader key prefix (e.g. "g" for G+D sequences) */
  leader?: string;
  /** Where this shortcut is active */
  scope: ShortcutScope;
  /** Human-readable label for ? modal and command palette */
  label: string;
  /** The action to invoke — looked up by the hook at dispatch time */
  actionId: string;
}
