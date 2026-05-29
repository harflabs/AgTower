import { describe, expect, it } from "vitest";
import { getShortcutHelpSections } from "@/lib/keyboard/help";

describe("getShortcutHelpSections", () => {
  it("returns the major help sections in a stable user-facing order", () => {
    expect(getShortcutHelpSections().map((section) => section.id)).toEqual([
      "app-navigation",
      "session",
      "sidebar",
      "search",
      "command-palette",
    ]);
  });

  it("includes the keyboard help entry with both local and menu shortcuts", () => {
    const appSection = getShortcutHelpSections().find((section) => section.id === "app-navigation");
    const helpEntry = appSection?.entries.find((entry) => entry.id === "system.shortcut-help");

    expect(helpEntry?.shortcuts).toHaveLength(2);
    expect(helpEntry?.shortcuts[0]).toBe("?");
    expect(helpEntry?.shortcuts[1]).toContain("/");
  });

  it("resolves every registryEntry reference without throwing", () => {
    // registryEntry() throws if an actionId has no matching SHORTCUT. Calling
    // getShortcutHelpSections() exercises every reference, so this test guards
    // against orphaned help entries after shortcut renames/removals.
    expect(() => getShortcutHelpSections()).not.toThrow();
  });

  it("exposes the terminal scaling shortcuts in the Session section", () => {
    const session = getShortcutHelpSections().find((s) => s.id === "session");
    const ids = session?.entries.map((e) => e.id) ?? [];
    const scaleUp = session?.entries.find((e) => e.id === "session.terminal-scale-up");

    expect(ids).toContain("session.terminal-scale-up");
    expect(ids).toContain("session.terminal-scale-down");
    expect(ids).toContain("session.terminal-scale-reset");
    expect(scaleUp?.shortcuts).toHaveLength(2);
  });

  it("does not list stale feed shortcuts in the terminal-focused Session section", () => {
    const session = getShortcutHelpSections().find((s) => s.id === "session");
    const ids = session?.entries.map((e) => e.id) ?? [];

    expect(ids).not.toContain("action.reply");
    expect(ids).not.toContain("action.done");
    expect(ids).not.toContain("system.stop-agent");
    expect(ids).not.toContain("session.toggle-tool-group");
    expect(ids).not.toContain("session.toggle-file-changes");
  });
});
