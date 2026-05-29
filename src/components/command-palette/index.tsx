import {
  AlertTriangle,
  Archive,
  Bell,
  BellRing,
  ChevronsUpDown,
  ClipboardCopy,
  CornerDownRight,
  Cpu,
  DatabaseZap,
  ExternalLink,
  Files,
  Folder,
  FolderPlus,
  History,
  Keyboard,
  Laptop,
  Layers3,
  LayoutDashboard,
  Moon,
  OctagonX,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Terminal,
  TerminalSquare,
  Volume2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useRepo } from "@/hooks/use-repo";
import { useSession } from "@/hooks/use-session";
import { clearClientSessionState, resetClientAppState } from "@/lib/app-reset";
import {
  clearSessionCache as clearEngineSessionCache,
  resetEverything as resetEngineEverything,
} from "@/lib/engine";
import { getShortcutLabel } from "@/lib/keyboard/registry";
import { confirmDestructiveAction } from "@/lib/native-dialog";
import { getSplitPaneSide } from "@/lib/split-view";
import { StatusDot } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import { getLastOpenViewedSessionId, readViewedSessions } from "@/lib/viewed-session-history";
import { useAvailableProviders } from "@/providers/registry";
import { useModalStore } from "@/stores/modal-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSplitViewStore } from "@/stores/split-view-store";
import type { SessionStatus } from "@/types/session";
import { getPaletteItems } from "./command-actions";
import { armDangerAction, disarmDangerAction, isDangerActionConfirmed } from "./danger";
import type { PaletteContext, PaletteItem, PaletteMatch, PalettePreviewSection } from "./model";
import { useStableSessions } from "./palette-selectors";
import { parsePaletteQuery } from "./query";
import { rankPaletteItems } from "./ranking";
import { getRecentEntries, pushRecentItem } from "./recents";

const ICONS: Record<string, React.ElementType> = {
  AlertTriangle,
  Archive,
  Bell,
  BellRing,
  ChevronsUpDown,
  ClipboardCopy,
  CornerDownRight,
  Cpu,
  DatabaseZap,
  ExternalLink,
  Files,
  Folder,
  FolderPlus,
  History,
  Keyboard,
  Laptop,
  Layers3,
  LayoutDashboard,
  Moon,
  OctagonX,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Reply,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Terminal,
  TerminalSquare,
  Volume2,
};

const HOME_SECTION_ORDER = [
  "Open Sessions",
  "Continue",
  "Create",
  "Quick Settings",
  "Workspaces",
] as const;

const MAX_QUERY_RESULTS = 40;
const TOP_HITS_LIMIT = 6;

const ITEM_KIND_LABELS: Record<PaletteItem["kind"], string> = {
  command: "Command",
  setting: "Setting",
  session: "Session",
  workspace: "Workspace",
  provider: "Provider",
  danger: "System",
};

type PaletteFocusZone = "input" | "list";

function getPaletteOptionId(itemId: string) {
  return `command-palette-option-${itemId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function isEditablePaletteKey(event: React.KeyboardEvent) {
  return !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1;
}

function groupBy<T, K extends string>(items: T[], getKey: (item: T) => K): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const key = getKey(item);
      if (acc[key]) {
        acc[key].push(item);
      } else {
        acc[key] = [item];
      }
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

function sectionLimit(section: (typeof HOME_SECTION_ORDER)[number]): number {
  switch (section) {
    case "Open Sessions":
      // Match viewed-session-history's cap so every recently-visited session
      // is reachable from the home view without typing.
      return 20;
    case "Continue":
      return 6;
    case "Create":
      return 4;
    case "Quick Settings":
      return 6;
    case "Workspaces":
      return 6;
    default:
      return 6;
  }
}

function getItemKindLabel(item: PaletteItem) {
  return ITEM_KIND_LABELS[item.kind];
}

function formatItemStatus(status?: string | null) {
  switch (status) {
    case "needsattention":
    case "needsAttention":
      return "Needs Attention";
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "closed":
      return "Closed";
    case "archived":
      return "Archived";
    default:
      return status ?? null;
  }
}

function getItemRepo(item: PaletteItem, repos: PaletteContext["repos"]) {
  const repoId = item.meta?.repoId;
  return repoId ? (repos[repoId] ?? null) : null;
}

function getItemProviderLabel(item: PaletteItem, providers: PaletteContext["providers"]) {
  const providerId = item.meta?.providerId;
  if (!providerId) return null;
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

function RepoBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <PaletteBadge className={cn("gap-1.5", className)}>
      <span
        className="size-1.5 rounded-full"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{name}</span>
    </PaletteBadge>
  );
}

function PaletteBadge({
  tone = "default",
  className,
  children,
}: React.ComponentProps<typeof Badge> & {
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/30 bg-warning/10 text-warning"
      : tone === "danger"
        ? "border-destructive/25 bg-destructive/10 text-destructive"
        : "border-border/55 bg-background/50 text-tertiary-info";

  return (
    <Badge variant="outline" className={cn("px-2 font-normal", toneClass, className)}>
      {children}
    </Badge>
  );
}

export function CommandPalette() {
  const open = useModalStore((state) => state.commandPaletteOpen);
  const setOpen = useModalStore((state) => state.setCommandPaletteOpen);

  if (!open) return null;

  return <MountedCommandPalette setOpen={setOpen} />;
}

function MountedCommandPalette({ setOpen }: { setOpen: (open: boolean) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessions = useStableSessions();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const repos = useRepoStore((state) => state.repos);
  const activeRepoId = useRepoStore((state) => state.activeRepoId);
  const settings = useSettingsStore(
    useShallow((state) => ({
      archiveAfterDays: state.archiveAfterDays,
      defaultProvider: state.defaultProvider,
      notifications: state.notifications,
      providerSettings: state.providerSettings,
      sidebarProviderFilter: state.sidebarProviderFilter,
      startupBehavior: state.startupBehavior,
      theme: state.theme,
    })),
  );

  const { addRepository } = useRepo();
  const {
    restartSession,
    startSession,
    startTerminalSession,
    stopAllSessions,
    stopSession,
    stopSessionsInRepo,
  } = useSession();

  // Snapshot the MRU list at palette mount. The palette only mounts when the
  // dialog opens, so each open gets a fresh read; freezing through the open
  // lifecycle prevents jarring reshuffles if external code (e.g. session
  // page mount) writes to viewed-session-history while the palette is open.
  // useState (not useMemo) — useMemo may discard its cache under memory
  // pressure and re-run the factory, which would break the snapshot.
  const [viewedSessionIds] = useState<readonly string[]>(() => readViewedSessions());

  // Resolved once at mount: the previously-visited OPEN session that isn't
  // the current one. Drives auto-selection so Cmd+K → Enter jumps straight
  // back to the user's previous session. Null when there is none.
  const [preferredInitialSelectionId] = useState<string | null>(() => {
    const sessionsSnapshot = useSessionStore.getState().sessions;
    const activeId = useSessionStore.getState().activeSessionId;
    const previousId = getLastOpenViewedSessionId(sessionsSnapshot, activeId);
    return previousId ? `session:${previousId}` : null;
  });

  const [search, setSearch] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dangerState, setDangerState] = useState(disarmDangerAction());
  const [focusZone, setFocusZone] = useState<PaletteFocusZone>("input");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // Provider-aware actions in the palette (create session, switch
  // default, filter sidebar, etc.) operate on currently-available
  // providers only. Name resolution for sessions whose provider is no
  // longer available still works because the shared helpers fall back to
  // the full registry via getProvider(id).
  const providers = useAvailableProviders();
  const activeSession = activeSessionId ? (sessions[activeSessionId] ?? null) : null;
  const activeRepo = activeRepoId ? (repos[activeRepoId] ?? null) : null;

  const focusElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }, []);

  const registerItemRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) {
        itemRefs.current.set(id, node);
      } else {
        itemRefs.current.delete(id);
      }
    },
    [],
  );

  const scrollSelectedIntoView = useCallback((element: HTMLElement) => {
    const list = listRef.current;
    if (!list) return;

    const listRect = list.getBoundingClientRect();
    const selectedRect = element.getBoundingClientRect();
    const topInset = 16;
    const bottomInset = 16;

    if (selectedRect.top < listRect.top + topInset) {
      list.scrollTop -= listRect.top + topInset - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom - bottomInset) {
      list.scrollTop += selectedRect.bottom - (listRect.bottom - bottomInset);
    }
  }, []);

  const clearSessionCache = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: "Clear session cache?",
      message:
        "This will delete all session data from the app database. On restart, sessions will be re-imported from agent files with correct session IDs. Your workspaces and agent conversation history are not affected.",
      okLabel: "Clear Cache",
    });
    if (!confirmed) return;

    await clearEngineSessionCache();
    clearClientSessionState();
    toast.success("Session cache cleared. Restart the app to re-import sessions.");
  }, []);

  const resetEverything = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: "Reset everything?",
      message:
        "This will delete the entire app database, including sessions, workspace state, and settings. Agent conversation data is not affected. You will need to re-add your workspaces after restarting the app.",
      okLabel: "Reset Everything",
    });
    if (!confirmed) return;

    await resetEngineEverything();
    resetClientAppState();
    toast.success("Everything reset. Restart the app now.");
  }, []);

  const ctx: PaletteContext = useMemo(
    () => ({
      activeRepo,
      activeRepoId,
      activeSession,
      activeSessionId,
      addRepository,
      clearSessionCache,
      isOnSession: location.pathname.startsWith("/session/") && Boolean(activeSessionId),
      navigate,
      providers,
      repos,
      resetEverything,
      restartSession,
      startSession,
      startTerminalSession,
      sessions,
      settings,
      stopAllSessions,
      stopSession,
      stopSessionsInRepo,
      viewedSessionIds,
    }),
    [
      activeRepo,
      activeRepoId,
      activeSession,
      activeSessionId,
      addRepository,
      clearSessionCache,
      location.pathname,
      navigate,
      providers,
      repos,
      resetEverything,
      restartSession,
      startSession,
      startTerminalSession,
      sessions,
      settings,
      stopAllSessions,
      stopSession,
      stopSessionsInRepo,
      viewedSessionIds,
    ],
  );

  const items = useMemo(() => getPaletteItems(ctx), [ctx]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const recents = useMemo(() => getRecentEntries(), []);
  const query = useMemo(() => parsePaletteQuery(search), [search]);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setSelectedValue("");
    setDangerState(disarmDangerAction());
    setFocusZone("input");
  }, []);

  const queryMode =
    query.normalizedText.length > 0 ||
    query.filters.types.length > 0 ||
    query.filters.providers.length > 0 ||
    query.filters.repos.length > 0 ||
    query.filters.statuses.length > 0 ||
    query.filters.pinned !== null;

  const rankedMatches = useMemo(
    () => (queryMode ? rankPaletteItems(items, query, ctx, recents) : []),
    [ctx, items, query, queryMode, recents],
  );

  const limitedMatches = useMemo(() => rankedMatches.slice(0, MAX_QUERY_RESULTS), [rankedMatches]);
  const hiddenResultsCount = Math.max(rankedMatches.length - limitedMatches.length, 0);
  const topHits = useMemo(() => limitedMatches.slice(0, TOP_HITS_LIMIT), [limitedMatches]);
  const topHitIds = useMemo(() => new Set(topHits.map((match) => match.item.id)), [topHits]);
  const groupedMatches = useMemo(
    () =>
      groupBy(
        limitedMatches.filter((match) => !topHitIds.has(match.item.id)),
        (match) => match.item.group,
      ),
    [limitedMatches, topHitIds],
  );

  const homeSections = useMemo(() => {
    const bySection = groupBy(
      items.filter((item) => item.homeSection && (!item.when || item.when(ctx))),
      (item) => item.homeSection as Exclude<PaletteItem["homeSection"], undefined>,
    );

    return HOME_SECTION_ORDER.map((section) => {
      const sectionItems = (bySection[section] ?? [])
        .slice()
        .sort((left, right) => (left.homeOrder ?? 999) - (right.homeOrder ?? 999))
        .slice(0, sectionLimit(section));

      return {
        section,
        items: sectionItems,
      };
    }).filter((entry) => entry.items.length > 0);
  }, [ctx, items]);

  const visibleItems = useMemo(() => {
    if (queryMode) {
      const flat = [...topHits, ...Object.values(groupedMatches).flat()];
      return flat.map((match) => match.item);
    }

    return homeSections.flatMap((section) => section.items);
  }, [groupedMatches, homeSections, queryMode, topHits]);

  const activeFilterBadges = useMemo(() => {
    const badges: Array<{ key: string; label: string; tone?: "default" | "warning" }> = [];

    for (const type of query.filters.types) {
      badges.push({ key: `type:${type}`, label: `Type: ${ITEM_KIND_LABELS[type]}` });
    }

    for (const repoFilter of query.filters.repos) {
      const repo =
        Object.values(repos).find(
          (candidate) =>
            candidate.id === repoFilter ||
            candidate.name.toLowerCase().includes(repoFilter) ||
            candidate.path.toLowerCase().includes(repoFilter),
        ) ?? null;
      badges.push({
        key: `repo:${repoFilter}`,
        label: `Repo: ${repo?.name ?? repoFilter}`,
      });
    }

    for (const providerFilter of query.filters.providers) {
      const provider =
        providers.find(
          (candidate) =>
            candidate.id.toLowerCase().includes(providerFilter) ||
            candidate.displayName.toLowerCase().includes(providerFilter),
        ) ?? null;
      badges.push({
        key: `provider:${providerFilter}`,
        label: `Provider: ${provider?.displayName ?? providerFilter}`,
      });
    }

    for (const statusFilter of query.filters.statuses) {
      badges.push({
        key: `status:${statusFilter}`,
        label: `Status: ${formatItemStatus(statusFilter) ?? statusFilter}`,
        tone: statusFilter.includes("attention") ? "warning" : "default",
      });
    }

    if (query.filters.pinned !== null) {
      badges.push({
        key: "pinned",
        label: query.filters.pinned ? "Pinned only" : "Unpinned only",
      });
    }

    return badges;
  }, [
    providers,
    query.filters.pinned,
    query.filters.providers,
    query.filters.repos,
    query.filters.statuses,
    query.filters.types,
    repos,
  ]);

  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);

  const selectedItem = selectedValue ? (itemMap.get(selectedValue) ?? null) : null;
  const previewItem =
    previewOpen && selectedItem?.preview
      ? selectedItem
      : previewOpen && selectedValue
        ? (itemMap.get(selectedValue) ?? null)
        : null;

  const selectItemByIndex = useCallback(
    (index: number) => {
      if (visibleItemIds.length === 0) return;
      const clampedIndex = Math.max(0, Math.min(visibleItemIds.length - 1, index));
      setSelectedValue(visibleItemIds[clampedIndex] ?? "");
      setFocusZone("list");
    },
    [visibleItemIds],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (visibleItemIds.length === 0) return;
      const currentIndex = selectedValue ? visibleItemIds.indexOf(selectedValue) : -1;
      const nextIndex =
        currentIndex < 0
          ? delta >= 0
            ? 0
            : visibleItemIds.length - 1
          : Math.max(0, Math.min(visibleItemIds.length - 1, currentIndex + delta));
      selectItemByIndex(nextIndex);
    },
    [selectItemByIndex, selectedValue, visibleItemIds],
  );

  const focusInput = useCallback(
    (caretPosition?: number) => {
      setFocusZone("input");
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        focusElement(input);
        const nextCaret = caretPosition ?? input.value.length;
        try {
          input.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // Ignore input types that do not support selection.
        }
      });
    },
    [focusElement],
  );

  const handleHoverItem = useCallback((id: string) => {
    setSelectedValue(id);
  }, []);

  const handleFocusItem = useCallback((id: string) => {
    setSelectedValue(id);
    setFocusZone("list");
  }, []);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    return () => {
      if (previousFocusRef.current) {
        const element = previousFocusRef.current;
        previousFocusRef.current = null;
        requestAnimationFrame(() => focusElement(element));
      }
    };
  }, [focusElement]);

  useEffect(() => {
    setSearch("");
    setSelectedValue("");
    setPreviewOpen(false);
    setDangerState(disarmDangerAction());
    setFocusZone("input");
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    if (visibleItemIds.length === 0) {
      setSelectedValue("");
      return;
    }
    if (!selectedValue || !visibleItemIds.includes(selectedValue)) {
      // In home mode, prefer the resolved "previous session" so Cmd+K → Enter
      // jumps back. In query mode the top fuzzy match wins instead — picking
      // a non-top item there would feel like a ranking bug.
      const preferred =
        !queryMode &&
        preferredInitialSelectionId &&
        visibleItemIds.includes(preferredInitialSelectionId)
          ? preferredInitialSelectionId
          : visibleItemIds[0];
      setSelectedValue(preferred);
    }
  }, [preferredInitialSelectionId, queryMode, selectedValue, visibleItemIds]);

  useEffect(() => {
    if (visibleItemIds.length === 0) return;

    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;

      const firstVisibleId = visibleItemIds[0];
      if (!selectedValue || selectedValue === firstVisibleId) {
        list.scrollTop = 0;
      }

      if (focusZone !== "list" || !selectedValue) return;

      const selected = itemRefs.current.get(selectedValue);
      if (!selected) return;

      focusElement(selected);
      if (selectedValue !== firstVisibleId) {
        scrollSelectedIntoView(selected);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [focusElement, focusZone, scrollSelectedIntoView, selectedValue, visibleItemIds]);

  useEffect(() => {
    const retrigger = () => {
      if (search.trim() || previewOpen || dangerState.armedId) {
        setSearch("");
        setPreviewOpen(false);
        setDangerState(disarmDangerAction());
        setSelectedValue("");
        setFocusZone("input");
        focusInput(0);
        return;
      }
      setOpen(false);
    };

    window.addEventListener("command-palette-retrigger", retrigger);
    return () => window.removeEventListener("command-palette-retrigger", retrigger);
  }, [dangerState.armedId, focusInput, previewOpen, search, setOpen]);

  useEffect(() => {
    if (!dangerState.armedId) return;
    if (!selectedValue || selectedValue === dangerState.armedId) return;
    setDangerState(disarmDangerAction());
  }, [dangerState.armedId, selectedValue]);

  // Cmd+Enter on a session row: open the target alongside the current session
  // in the split pane. Mirrors the sidebar Alt+Click flow in
  // sidebar-tree-session-row.tsx — replaces the focused pane when a split is
  // already open, otherwise opens a fresh split with the current session on
  // the left. Returns false to signal the caller should fall through to a
  // plain navigate (no active session, same session, or non-session item).
  const handleSessionSplitOpen = useCallback(
    (item: PaletteItem): boolean => {
      if (item.kind !== "session") return false;
      const targetId = item.meta?.sessionId;
      const currentId = ctx.activeSessionId;
      if (!targetId || !currentId) return false;
      if (currentId === targetId) return false;

      const splitState = useSplitViewStore.getState();
      const { splitPair, focusedPaneId } = splitState;

      if (splitPair) {
        // Replace the focused pane when it's part of the split; otherwise
        // replace whichever pane is currently showing our active session.
        // The "right" fallback only kicks in if neither matches — practically
        // unreachable since activeSessionId always points to one of the panes
        // while a split is open.
        const focusedSide = focusedPaneId ? getSplitPaneSide(splitPair, focusedPaneId) : null;
        const side = focusedSide ?? getSplitPaneSide(splitPair, currentId) ?? "right";
        splitState.replaceSplitPane(side, targetId);
      } else {
        splitState.openSplit(currentId, targetId);
      }

      pushRecentItem(item);
      setOpen(false);
      return true;
    },
    [ctx.activeSessionId, setOpen],
  );

  const runItem = useCallback(
    async (item: PaletteItem) => {
      if (item.dangerLevel === "guarded" && !isDangerActionConfirmed(dangerState, item.id)) {
        setDangerState(armDangerAction(dangerState, item.id));
        setPreviewOpen(true);
        return;
      }

      pushRecentItem(item);
      setOpen(false);
      setPreviewOpen(false);
      setDangerState(disarmDangerAction());

      try {
        await item.perform(ctx);

        if (item.kind === "setting") {
          toast.success(item.title);
        }
      } catch (error) {
        toast.error(`Failed to run "${item.title}": ${String(error)}`);
      }
    },
    [ctx, dangerState, setOpen],
  );

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      };

      const target = event.target as HTMLElement;
      const targetIsInput = target === inputRef.current;

      if (event.key === "Escape" && dangerState.armedId) {
        claim();
        setDangerState(disarmDangerAction());
        return;
      }

      if (event.key === "Escape" && previewOpen) {
        claim();
        setPreviewOpen(false);
        return;
      }

      if (event.key === "Escape") {
        claim();
        setOpen(false);
        return;
      }

      if (targetIsInput) {
        if (event.key === "ArrowDown") {
          claim();
          moveSelection(1);
          return;
        }

        if (event.key === "ArrowUp") {
          claim();
          moveSelection(-1);
          return;
        }

        if (event.key === "PageDown") {
          claim();
          moveSelection(5);
          return;
        }

        if (event.key === "PageUp") {
          claim();
          moveSelection(-5);
          return;
        }

        if (event.key === "Enter" && selectedItem) {
          claim();
          if (event.metaKey && handleSessionSplitOpen(selectedItem)) return;
          void runItem(selectedItem);
        }
        return;
      }

      if (isEditablePaletteKey(event)) {
        claim();
        const nextSearch = `${search}${event.key}`;
        handleSearchChange(nextSearch);
        focusInput(nextSearch.length);
        return;
      }

      if (event.key === "Backspace") {
        claim();
        const nextSearch = search.slice(0, -1);
        handleSearchChange(nextSearch);
        focusInput(nextSearch.length);
        return;
      }

      if (event.key === "ArrowDown") {
        claim();
        moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        claim();
        moveSelection(-1);
        return;
      }

      if (event.key === "Home") {
        claim();
        selectItemByIndex(0);
        return;
      }

      if (event.key === "End") {
        claim();
        selectItemByIndex(visibleItemIds.length - 1);
        return;
      }

      if (event.key === "PageDown") {
        claim();
        moveSelection(5);
        return;
      }

      if (event.key === "PageUp") {
        claim();
        moveSelection(-5);
        return;
      }

      if (event.key === "ArrowRight" && selectedItem?.preview) {
        claim();
        setPreviewOpen(true);
        return;
      }

      if (event.key === "ArrowLeft" && previewOpen) {
        claim();
        setPreviewOpen(false);
        return;
      }

      if (event.key === "Enter" && selectedItem) {
        claim();
        if (event.metaKey && handleSessionSplitOpen(selectedItem)) return;
        void runItem(selectedItem);
      }
    },
    [
      dangerState.armedId,
      focusInput,
      handleSearchChange,
      handleSessionSplitOpen,
      moveSelection,
      previewOpen,
      runItem,
      search,
      selectItemByIndex,
      selectedItem,
      setOpen,
      visibleItemIds.length,
    ],
  );

  return (
    <CommandDialog open onOpenChange={setOpen}>
      <div className="command-palette-frame" onKeyDownCapture={handleKeyDownCapture}>
        <div className="command-palette-header">
          <CommandInput
            ref={inputRef}
            placeholder="Type a command or search sessions"
            value={search}
            onValueChange={handleSearchChange}
            onFocus={() => setFocusZone("input")}
            aria-activedescendant={
              focusZone === "input" && selectedValue ? getPaletteOptionId(selectedValue) : undefined
            }
          />

          {(activeFilterBadges.length > 0 || (queryMode && hiddenResultsCount > 0)) && (
            <div className="command-palette-filter-row">
              {activeFilterBadges.map((badge) => (
                <PaletteBadge
                  key={badge.key}
                  tone={badge.tone === "warning" ? "warning" : "default"}
                >
                  {badge.label}
                </PaletteBadge>
              ))}
              {queryMode && hiddenResultsCount > 0 && (
                <span className="text-secondary-info">Showing top {MAX_QUERY_RESULTS}</span>
              )}
            </div>
          )}
        </div>

        <div className="command-palette-body">
          <div className="command-palette-panel">
            <CommandList ref={listRef} className="min-h-0 flex-1">
              {queryMode && rankedMatches.length === 0 ? (
                <CommandEmpty className="flex h-full items-center justify-center px-4 py-10">
                  <div className="flex min-h-36 w-full max-w-md flex-col items-center justify-center gap-1 px-6 text-center">
                    <span className="text-sm font-medium text-foreground">No matching results</span>
                    <span className="text-xs text-muted-foreground">
                      Try a broader query like "session", "theme", or "provider"
                    </span>
                  </div>
                </CommandEmpty>
              ) : queryMode ? (
                <>
                  {topHits.length > 0 && (
                    <>
                      <CommandGroup heading="Top Hits">
                        {topHits.map((match) => (
                          <PaletteRow
                            key={match.item.id}
                            item={match.item}
                            match={match}
                            armed={dangerState.armedId === match.item.id}
                            repos={repos}
                            selected={selectedValue === match.item.id}
                            registerRef={registerItemRef}
                            onHover={handleHoverItem}
                            onFocus={handleFocusItem}
                            onSelect={runItem}
                          />
                        ))}
                      </CommandGroup>
                      {Object.keys(groupedMatches).length > 0 && <CommandSeparator />}
                    </>
                  )}

                  {Object.entries(groupedMatches).map(([group, matches]) => (
                    <CommandGroup key={group} heading={group}>
                      {matches.map((match) => (
                        <PaletteRow
                          key={match.item.id}
                          item={match.item}
                          match={match}
                          armed={dangerState.armedId === match.item.id}
                          repos={repos}
                          selected={selectedValue === match.item.id}
                          registerRef={registerItemRef}
                          onHover={handleHoverItem}
                          onFocus={handleFocusItem}
                          onSelect={runItem}
                        />
                      ))}
                    </CommandGroup>
                  ))}
                </>
              ) : (
                homeSections.map((section, index) => (
                  <div key={section.section}>
                    {index > 0 && <CommandSeparator />}
                    <CommandGroup heading={section.section}>
                      {section.items.map((item) => (
                        <PaletteRow
                          key={item.id}
                          item={item}
                          armed={dangerState.armedId === item.id}
                          repos={repos}
                          selected={selectedValue === item.id}
                          registerRef={registerItemRef}
                          onHover={handleHoverItem}
                          onFocus={handleFocusItem}
                          onSelect={runItem}
                        />
                      ))}
                    </CommandGroup>
                  </div>
                ))
              )}
            </CommandList>
          </div>

          {previewOpen && previewItem?.preview && (
            <aside className="command-palette-preview-rail">
              <PalettePreviewPanel
                item={previewItem}
                armed={dangerState.armedId === previewItem.id}
                repos={repos}
                providers={providers}
              />
            </aside>
          )}
        </div>
      </div>
    </CommandDialog>
  );
}

function PalettePreviewPanel({
  item,
  armed = false,
  repos,
  providers,
}: {
  item: PaletteItem;
  armed?: boolean;
  repos: PaletteContext["repos"];
  providers: PaletteContext["providers"];
}) {
  const repo = getItemRepo(item, repos);
  const providerLabel = getItemProviderLabel(item, providers);
  const statusLabel = formatItemStatus(item.meta?.status ?? item.status);

  return (
    <div
      data-selection="content"
      data-select-all-scope
      className={cn(
        "command-palette-preview outline-none",
        armed && "border-destructive/25 bg-destructive/5 dark:bg-destructive/10",
      )}
    >
      <div className="flex items-start gap-3">
        <PaletteItemGlyph item={item} repos={repos} className="size-6" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PaletteBadge>{getItemKindLabel(item)}</PaletteBadge>
            {repo && <RepoBadge name={repo.name} color={repo.color} />}
            {providerLabel && item.kind !== "provider" && (
              <PaletteBadge>{providerLabel}</PaletteBadge>
            )}
            {item.kind === "session" && statusLabel && <PaletteBadge>{statusLabel}</PaletteBadge>}
            {item.currentValue && <PaletteBadge>{item.currentValue}</PaletteBadge>}
            {armed && <PaletteBadge tone="danger">Armed</PaletteBadge>}
          </div>
          <div>
            <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
              {item.preview?.title ?? item.title}
            </h3>
          </div>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {item.preview?.summary && <p className="text-secondary-info">{item.preview.summary}</p>}

        {item.preview?.sections && item.preview.sections.length > 0 && (
          <div className={cn("space-y-2.5", item.preview.summary && "mt-4")}>
            {item.preview.sections.map((section) => (
              <PreviewSection key={`${item.id}-${section.label}`} section={section} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-4 text-secondary-info">
        <Kbd tone="subtle" size="xs">
          ↵
        </Kbd>
        <span>{armed ? "Confirm action" : "Run selected item"}</span>
      </div>
    </div>
  );
}

function PreviewSection({ section }: { section: PalettePreviewSection }) {
  return (
    <div className="border-t border-border/60 pt-3">
      <p className="text-ui-label">{section.label}</p>
      <p className="mt-1 text-sm text-foreground">{section.value}</p>
    </div>
  );
}

function PaletteItemGlyph({
  item,
  repos,
  className,
}: {
  item: PaletteItem;
  repos?: PaletteContext["repos"];
  className?: string;
}) {
  const Icon = item.iconName ? ICONS[item.iconName] : null;
  const repo = repos ? getItemRepo(item, repos) : null;
  const accentColor = item.kind === "workspace" ? repo?.color : null;

  return (
    <div
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-selected/command-item:text-interactive-selected-foreground",
        className,
      )}
      style={accentColor ? { color: accentColor } : undefined}
    >
      {item.kind === "session" ? (
        <StatusDot status={(item.status ?? "closed") as SessionStatus} className="size-2.5" />
      ) : Icon ? (
        <Icon className="size-4" />
      ) : (
        <Search className="size-4" />
      )}
    </div>
  );
}

const PaletteRow = memo(function PaletteRow({
  item,
  match,
  armed = false,
  repos,
  selected = false,
  registerRef,
  onHover,
  onFocus,
  onSelect,
}: {
  item: PaletteItem;
  match?: PaletteMatch;
  armed?: boolean;
  repos: PaletteContext["repos"];
  selected?: boolean;
  registerRef: (id: string) => (node: HTMLDivElement | null) => void;
  onHover: (id: string) => void;
  onFocus: (id: string) => void;
  onSelect: (item: PaletteItem) => void;
}) {
  const repo = getItemRepo(item, repos);
  const shortcutLabel = item.shortcutActionId ? getShortcutLabel(item.shortcutActionId) : undefined;
  const title =
    armed && item.dangerLevel === "guarded"
      ? `${item.title} (Press Enter Again to Confirm)`
      : match?.matchedAlias
        ? `${item.title} (${match.matchedAlias})`
        : item.title;

  const isSession = item.kind === "session";
  // Dim the current session — initial auto-select prefers the previous one,
  // so the dim acts as a "you are here" anchor — and closed/archived sessions
  // that surface in search results.
  const isDimmed =
    isSession &&
    (item.isCurrent === true || item.status === "closed" || item.status === "archived");

  // Sessions show "repo · provider" right-aligned next to the title and use
  // the second line for live activity. Non-session items render the subtitle
  // in the second line as before.
  const sessionSubtitle = isSession ? item.subtitle : undefined;
  const secondaryLine = isSession ? item.activity : item.subtitle;

  return (
    <CommandItem
      id={getPaletteOptionId(item.id)}
      ref={registerRef(item.id)}
      selected={selected}
      onSelect={() => onSelect(item)}
      onMouseMove={() => onHover(item.id)}
      onFocus={() => onFocus(item.id)}
      className={cn(
        "items-start gap-3",
        isDimmed && "opacity-60",
        armed &&
          "data-selected:bg-destructive/12 data-selected:border-destructive/30 data-selected:[&_svg]:text-destructive",
      )}
    >
      <PaletteItemGlyph item={item} repos={repos} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground group-data-selected/command-item:text-sidebar-interactive-selected-foreground">
            {title}
          </span>
          {isSession && item.isCurrent && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-tertiary-info">
              Current
            </span>
          )}
          {armed && <PaletteBadge tone="danger">Armed</PaletteBadge>}
        </div>
        {secondaryLine && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-info group-data-selected/command-item:text-sidebar-interactive-selected-foreground/80">
            {!isSession && repo?.color && (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: repo.color }}
              />
            )}
            <p className="truncate">{secondaryLine}</p>
          </div>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        {sessionSubtitle && (
          <span className="max-w-44 truncate text-secondary-info group-data-selected/command-item:text-sidebar-interactive-selected-foreground/80">
            {sessionSubtitle}
          </span>
        )}
        {item.currentValue && (
          <span className="max-w-36 truncate text-secondary-info group-data-selected/command-item:text-sidebar-interactive-selected-foreground/80">
            {item.currentValue}
          </span>
        )}
        {shortcutLabel && !item.currentValue && !sessionSubtitle && (
          <Kbd
            tone="default"
            size="xs"
            className={cn(
              "command-palette-shortcut",
              selected && "command-palette-shortcut-selected",
            )}
          >
            {shortcutLabel}
          </Kbd>
        )}
      </div>
    </CommandItem>
  );
});
