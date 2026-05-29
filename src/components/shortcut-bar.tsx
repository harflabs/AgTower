import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Kbd } from "@/components/ui/kbd";
import { activeLeaderKey, onLeaderChange } from "@/hooks/use-keyboard-shortcuts";
import { isTerminalFocused } from "@/lib/keyboard/input-guard";
import { useModalStore } from "@/stores/modal-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";

interface ShortcutHint {
  key: string;
  label: string;
}

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const META = IS_MAC ? "\u2318" : "Ctrl+";

// Static hint arrays — hoisted to module level to avoid recreation on every render
const HINTS_LEADER_G: ShortcutHint[] = [
  { key: "g \u2192 d", label: "Dashboard" },
  { key: "g \u2192 s", label: "Settings" },
  { key: "g \u2192 n", label: "New Session" },
];
const HINTS_PALETTE: ShortcutHint[] = [
  { key: "\u2191\u2193", label: "Navigate" },
  { key: "\u21b5", label: "Select" },
  { key: "Esc", label: "Close" },
];
const HINTS_SEARCH: ShortcutHint[] = [
  { key: "\u21b5", label: "Next match" },
  { key: "Esc", label: "Close" },
];
const HINTS_NAV: ShortcutHint[] = [
  { key: "J/K", label: "Navigate" },
  { key: "\u21b5", label: "Open" },
  { key: "\u232b", label: "Archive" },
  { key: "Esc", label: "Exit" },
];
const HINTS_SETTINGS: ShortcutHint[] = [
  { key: `${META}K`, label: "Commands" },
  { key: `${META}N`, label: "New Session" },
  { key: "?", label: "Help" },
];

function canArchiveStatus(status: string | undefined): boolean {
  return !!status && status !== "running" && status !== "idle" && status !== "archived";
}

function useShortcutContext(): ShortcutHint[] {
  const location = useLocation();
  const commandPaletteOpen = useModalStore((s) => s.commandPaletteOpen);
  const searchOpen = useModalStore((s) => s.searchOpen);
  const keyboardNavActive = useSidebarStore((s) => s.keyboardNavActive);
  const activeSessionStatus = useSessionStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.status : undefined,
  );
  const [leaderKey, setLeaderKey] = useState<string | null>(activeLeaderKey);
  const [termFocused, setTermFocused] = useState(false);

  useEffect(() => onLeaderChange(setLeaderKey), []);

  // Debounced terminal focus detection — check on focus/blur, not click
  useEffect(() => {
    let raf: number;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTermFocused(isTerminalFocused()));
    };
    window.addEventListener("focus", check, true);
    window.addEventListener("blur", check, true);
    check();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focus", check, true);
      window.removeEventListener("blur", check, true);
    };
  }, []);

  // Attention count — returns a primitive so Zustand can skip re-renders when count unchanged
  const attentionCount = useSessionStore((s) => {
    let count = 0;
    for (const session of Object.values(s.sessions)) {
      if (session.status === "needsAttention") {
        count++;
      }
    }
    return count;
  });
  const openCount = useSessionStore((s) => {
    let count = 0;
    for (const session of Object.values(s.sessions)) {
      if (
        session.status === "running" ||
        session.status === "idle" ||
        session.status === "needsAttention"
      ) {
        count++;
      }
    }
    return count;
  });

  // Return static arrays for fixed contexts — zero allocation
  if (leaderKey === "g") return HINTS_LEADER_G;
  if (commandPaletteOpen) return HINTS_PALETTE;
  if (searchOpen) return HINTS_SEARCH;
  if (keyboardNavActive && !termFocused) return HINTS_NAV;

  const isSession = location.pathname.startsWith("/session/");

  // Dynamic hints for contexts that include attention count
  if (isSession && termFocused) {
    const hints: ShortcutHint[] = [];
    if (attentionCount > 0) hints.push({ key: `${META}J`, label: `Next (${attentionCount})` });
    if (openCount > 1) hints.push({ key: `${META}]`, label: "Next Open" });
    if (canArchiveStatus(activeSessionStatus)) {
      hints.push({ key: `${META}E`, label: "Archive and Advance" });
    }
    hints.push({ key: `${META}K`, label: "Commands" });
    hints.push({ key: `${META}F`, label: "Search" });
    hints.push({ key: `${META}Esc`, label: "Sidebar" });
    return hints;
  }

  if (isSession) {
    const hints: ShortcutHint[] = [];
    if (attentionCount > 0) hints.push({ key: `${META}J`, label: `Next (${attentionCount})` });
    if (openCount > 1) hints.push({ key: `${META}]`, label: "Next Open" });
    if (canArchiveStatus(activeSessionStatus)) {
      hints.push({ key: `${META}E`, label: "Archive and Advance" });
    }
    hints.push({ key: `${META}K`, label: "Commands" });
    hints.push({ key: `${META}Esc`, label: "Sidebar" });
    hints.push({ key: "?", label: "Help" });
    return hints;
  }

  if (location.pathname === "/") {
    const hints: ShortcutHint[] = [];
    if (attentionCount > 0) hints.push({ key: `${META}J`, label: `Next (${attentionCount})` });
    if (openCount > 1) hints.push({ key: `${META}]`, label: "Next Open" });
    hints.push({ key: `${META}N`, label: "New Session" });
    hints.push({ key: `${META}K`, label: "Commands" });
    hints.push({ key: `${META}Esc`, label: "Sidebar" });
    hints.push({ key: "?", label: "Help" });
    return hints;
  }

  return HINTS_SETTINGS;
}

export function ShortcutBar() {
  const hints = useShortcutContext();

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-t border-border/70 bg-background px-4">
      {hints.map((hint, i) => (
        <div key={hint.key} className="flex shrink-0 items-center gap-2">
          {i > 0 && <span className="text-muted-foreground/25">&middot;</span>}
          <Kbd tone="subtle" size="xs" className="text-foreground/60">
            {hint.key}
          </Kbd>
          <span className="text-[11px] text-muted-foreground">{hint.label}</span>
        </div>
      ))}
    </div>
  );
}
