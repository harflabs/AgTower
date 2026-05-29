import { AGTOWER_RECENT_COMMANDS_KEY } from "@/lib/storage-keys";
import type { PaletteItem, PaletteItemKind, RecentPaletteEntry } from "./model";

const RECENTS_KEY = AGTOWER_RECENT_COMMANDS_KEY;
const MAX_RECENTS = 12;

function inferKind(id: string): PaletteItemKind {
  if (id.startsWith("session:")) return "session";
  if (id.startsWith("workspace:")) return "workspace";
  if (id.startsWith("provider:")) return "provider";
  if (id.startsWith("danger:")) return "danger";
  if (id.startsWith("setting:")) return "setting";
  return "command";
}

export function getRecentEntries(): RecentPaletteEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];

    if (parsed.every((entry) => typeof entry === "string")) {
      const now = Date.now();
      return (parsed as string[]).slice(0, MAX_RECENTS).map((id, index) => ({
        id,
        kind: inferKind(id),
        lastUsedAt: now - index,
        useCount: 1,
      }));
    }

    return parsed
      .filter(
        (entry): entry is RecentPaletteEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentPaletteEntry).id === "string" &&
          typeof (entry as RecentPaletteEntry).kind === "string",
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function saveRecentEntries(entries: RecentPaletteEntry[]) {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)));
}

export function pushRecentItem(item: PaletteItem) {
  const next = getRecentEntries();
  const existingIndex = next.findIndex((entry) => entry.id === item.id);
  const existing = existingIndex >= 0 ? next.splice(existingIndex, 1)[0] : null;
  next.unshift({
    id: item.id,
    kind: item.kind,
    lastUsedAt: Date.now(),
    useCount: (existing?.useCount ?? 0) + 1,
  });
  saveRecentEntries(next);
}

export function getRecentBoost(itemId: string, recents: RecentPaletteEntry[]): number {
  const entry = recents.find((recent) => recent.id === itemId);
  if (!entry) return 0;

  const ageMinutes = Math.max((Date.now() - entry.lastUsedAt) / 60000, 1);
  const freshness = Math.max(0, 18 - Math.log2(ageMinutes + 1) * 4);
  return freshness + Math.min(entry.useCount * 1.5, 12);
}
