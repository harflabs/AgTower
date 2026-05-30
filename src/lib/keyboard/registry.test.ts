import { describe, expect, it } from "vitest";
import { formatShortcutLabel, SHORTCUTS } from "@/lib/keyboard/registry";
import type { ShortcutDefinition } from "@/lib/keyboard/types";

// The keydown dispatcher in use-keyboard-shortcuts.ts uses SHORTCUTS.find(...),
// which is first-match-wins: if two entries normalize to the same chord in the
// same scope, the later one silently never fires. These tests guard against that.
//
// The signature below mirrors the dispatcher's real matcher exactly:
//   - key: e.key.length === 1 ? e.key.toLowerCase() : e.key  (eventKey)
//   - meta: s.modifiers?.meta ?? false  (compared to metaKey || ctrlKey)
//   - ctrl: s.modifiers?.ctrl ?? false  (the physical Control key, distinct from
//     meta: matches ctrlKey && !metaKey, used for Ctrl+Tab-style chords)
//   - shift: s.modifiers?.shift ?? false, BUT when the key itself implies shift
//     (an uppercase single char, or one of ?!@#$%^&*()_+{}|:"<>~) the dispatcher
//     ignores the shift modifier, so we normalize the effective shift to true.
//   - alt: s.modifiers?.alt ?? false
//   - scope: s.scope
const SHIFTED_CHARS = '?!@#$%^&*()_+{}|:"<>~';

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function keyImpliesShift(key: string): boolean {
  const isShiftedChar = key.length === 1 && key !== key.toLowerCase();
  return isShiftedChar || SHIFTED_CHARS.includes(key);
}

function signature(def: ShortcutDefinition): string {
  const meta = def.modifiers?.meta ?? false;
  const ctrl = def.modifiers?.ctrl ?? false;
  const alt = def.modifiers?.alt ?? false;
  const shift = keyImpliesShift(def.key) ? true : (def.modifiers?.shift ?? false);
  return [
    normalizeKey(def.key),
    `meta:${meta}`,
    `ctrl:${ctrl}`,
    `shift:${shift}`,
    `alt:${alt}`,
    def.scope,
  ].join("|");
}

// Two scopes "collide" only if both can be active simultaneously. The dispatcher
// always includes "global" plus exactly one of "session"/"dashboard", so a global
// shortcut shares a chord-space with both session and dashboard shortcuts, but
// session and dashboard never coexist.
function scopesCanOverlap(a: ShortcutDefinition, b: ShortcutDefinition): boolean {
  if (a.scope === b.scope) return true;
  return a.scope === "global" || b.scope === "global";
}

describe("SHORTCUTS registry integrity", () => {
  it("has unique ids", () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const def of SHORTCUTS) {
      const count = (seen.get(def.id) ?? 0) + 1;
      seen.set(def.id, count);
      if (count === 2) dupes.push(def.id);
    }
    expect(dupes, `duplicate shortcut ids: ${dupes.join(", ")}`).toEqual([]);
  });

  it("has no two non-leader shortcuts sharing a normalized chord in overlapping scopes", () => {
    const nonLeader = SHORTCUTS.filter((s) => !s.leader);
    const collisions: string[] = [];

    for (let i = 0; i < nonLeader.length; i++) {
      for (let j = i + 1; j < nonLeader.length; j++) {
        const a = nonLeader[i];
        const b = nonLeader[j];
        if (a.actionId === b.actionId) continue; // intentional aliases for one action
        if (!scopesCanOverlap(a, b)) continue;
        if (signature(a) === signature(b)) {
          collisions.push(`${a.id} <-> ${b.id} (${signature(a)})`);
        }
      }
    }

    expect(collisions, `colliding chords: ${collisions.join("; ")}`).toEqual([]);
  });

  it("has no two leader+key combos colliding within an overlapping scope", () => {
    const leaderShortcuts = SHORTCUTS.filter((s) => s.leader);
    const collisions: string[] = [];

    for (let i = 0; i < leaderShortcuts.length; i++) {
      for (let j = i + 1; j < leaderShortcuts.length; j++) {
        const a = leaderShortcuts[i];
        const b = leaderShortcuts[j];
        if (a.actionId === b.actionId) continue;
        if (!scopesCanOverlap(a, b)) continue;
        if (a.leader === b.leader && normalizeKey(a.key) === normalizeKey(b.key)) {
          collisions.push(`${a.id} <-> ${b.id} (${a.leader} then ${normalizeKey(a.key)})`);
        }
      }
    }

    expect(collisions, `colliding leader sequences: ${collisions.join("; ")}`).toEqual([]);
  });

  it("binds Ctrl+Tab / Ctrl+Shift+Tab to the open-session cycle", () => {
    const next = SHORTCUTS.find((s) => s.id === "nav.next-open-tab");
    const prev = SHORTCUTS.find((s) => s.id === "nav.prev-open-tab");

    // Reuse the same actions as Cmd+] / Cmd+[ so the behavior stays identical.
    expect(next?.actionId).toBe("next-open-session");
    expect(prev?.actionId).toBe("prev-open-session");

    // Ctrl-specific (not meta) so they don't collide with Cmd shortcuts.
    expect(next?.modifiers).toEqual({ ctrl: true });
    expect(prev?.modifiers).toEqual({ ctrl: true, shift: true });
    expect(next?.key).toBe("Tab");
    expect(prev?.key).toBe("Tab");

    // The chord must render in the help modal / shortcut bar (Tab + the Ctrl
    // modifier), independent of the macOS vs. non-macOS label style.
    expect(formatShortcutLabel(next as ShortcutDefinition)).toMatch(/Tab|⇥/);
    expect(formatShortcutLabel(next as ShortcutDefinition)).toMatch(/Ctrl|⌃/);
    expect(formatShortcutLabel(prev as ShortcutDefinition)).toMatch(/Shift|⇧/);
  });

  it("populates the required fields on every entry", () => {
    const invalid: string[] = [];
    for (const def of SHORTCUTS) {
      const ok =
        typeof def.id === "string" &&
        def.id.length > 0 &&
        typeof def.key === "string" &&
        def.key.length > 0 &&
        typeof def.label === "string" &&
        def.label.length > 0 &&
        typeof def.actionId === "string" &&
        def.actionId.length > 0 &&
        (def.scope === "global" || def.scope === "session" || def.scope === "dashboard");
      if (!ok) invalid.push(def.id || "<missing id>");
    }
    expect(invalid, `entries missing required fields: ${invalid.join(", ")}`).toEqual([]);
  });
});
