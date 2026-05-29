import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowUpDown,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Funnel,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStableSessions } from "@/components/command-palette/palette-selectors";
import { getProviderMenuPngUrl, ProviderIcon } from "@/components/icons/provider-icon";
import { RemoveWorkspaceDialog } from "@/components/sidebar/remove-workspace-dialog";
import { SidebarTreeSessionRow } from "@/components/sidebar/sidebar-tree-session-row";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  SIDEBAR_MOTION_DURATION_MS,
  SIDEBAR_MOTION_EASING,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuAction,
  SidebarResizeHandle,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { UpdatePill } from "@/components/update-pill";
import {
  useNativeWindowDrag,
  useNativeWindowTitlebarDoubleClick,
} from "@/hooks/use-native-window-drag";
import { useRepo } from "@/hooks/use-repo";
import { SESSION_DROP_EVENT, type SessionDropDetail } from "@/hooks/use-session-drag";
import { getSidebarTree } from "@/lib/engine";
import { performHaptic } from "@/lib/haptics";
import {
  createContextMenuHandler,
  type NativeMenuItemSpec,
  showNativeMenuForElement,
} from "@/lib/native-menu";
import { IS_MACOS } from "@/lib/platform";
import { StatusDot } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import { getProvider, useAvailableProviders } from "@/providers/registry";
import { useModalStore } from "@/stores/modal-store";
import { useProviderAvailabilityStore } from "@/stores/provider-availability-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import {
  type SessionSortOrder,
  useSettingsStore,
  type WorkspaceSortOrder,
} from "@/stores/settings-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSplitViewStore } from "@/stores/split-view-store";
import type { SidebarTree, SidebarWorkspaceNode } from "@/types/sidebar";

/** Shorten an absolute path for display: replace $HOME with ~ */
function shortenPath(p: string): string {
  const match = p.match(/^\/Users\/[^/]+\/(.+)$/) ?? p.match(/^\/home\/[^/]+\/(.+)$/);
  return match ? `~/${match[1]}` : p;
}

type FocusableNode =
  | { id: `workspace:${string}`; kind: "workspace"; workspaceKey: string }
  | { id: `history:${string}`; kind: "history"; workspaceKey: string }
  | {
      id: `session:${string}`;
      kind: "session";
      workspaceKey: string;
      sessionId: string;
      bucket: "attention" | "active" | "recentClosed" | "history";
    };

function buildFocusableNodes(
  tree: SidebarTree,
  collapsedWorkspaces: Record<string, boolean>,
  expandedHistoryByWorkspace: Record<string, boolean>,
) {
  const nodes: FocusableNode[] = [];
  const allWorkspaces = [...tree.pinnedWorkspaces, ...tree.workspaces];

  for (const workspace of allWorkspaces) {
    nodes.push({
      id: `workspace:${workspace.key}`,
      kind: "workspace",
      workspaceKey: workspace.key,
    });

    const expanded = !(collapsedWorkspaces[workspace.key] ?? true);
    if (!expanded) continue;

    for (const sessionNode of workspace.visibleSessions) {
      nodes.push({
        id: `session:${sessionNode.id}`,
        kind: "session",
        workspaceKey: workspace.key,
        sessionId: sessionNode.id,
        bucket: sessionNode.bucket,
      });
    }

    if (workspace.historyCount > 0) {
      const historyExpanded = expandedHistoryByWorkspace[workspace.key] ?? false;

      if (historyExpanded) {
        for (const group of workspace.historyGroups) {
          for (const sessionNode of group.sessions) {
            nodes.push({
              id: `session:${sessionNode.id}`,
              kind: "session",
              workspaceKey: workspace.key,
              sessionId: sessionNode.id,
              bucket: sessionNode.bucket,
            });
          }
        }
      }

      nodes.push({
        id: `history:${workspace.key}`,
        kind: "history",
        workspaceKey: workspace.key,
      });
    }
  }

  return nodes;
}

function WorkspaceTreeGroup({
  workspace,
  expanded,
  historyExpanded,
  focusedNodeId,
  focusMode,
  searchActive,
  registerNodeRef,
  onRequestFocus,
  onToggleWorkspace,
  onToggleAllForWorkspace,
  onToggleHistory,
  onCreateSession,
  onCreateTerminal,
  onRemoveWorkspace,
}: {
  workspace: SidebarWorkspaceNode;
  expanded: boolean;
  historyExpanded: boolean;
  focusedNodeId: string | null;
  focusMode: boolean;
  searchActive: boolean;
  registerNodeRef: (id: string) => (node: HTMLButtonElement | null) => void;
  onRequestFocus: (id: string) => void;
  onToggleWorkspace: (workspaceKey: string) => void;
  onToggleAllForWorkspace: (workspaceKey: string) => void;
  onToggleHistory: (workspaceKey: string) => void;
  onCreateSession: (workspaceKey: string, providerId?: string) => void;
  onCreateTerminal: (workspaceKey: string) => void;
  onRemoveWorkspace: (workspace: SidebarWorkspaceNode) => void;
}) {
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);
  const repo = useRepoStore((s) => (workspace.repoId ? s.repos[workspace.repoId] : null));
  const togglePin = useRepoStore((s) => s.togglePin);
  const sessions = useSessionStore((s) => s.sessions);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  // While the sidebar is filtered to a specific provider, hovering the
  // workspace's "+" should advertise — and create — sessions with *that*
  // provider, not the user's persisted default. The user's default
  // setting is never written; the override is purely scoped to the
  // duration of the filter.
  const providerFilter = useSettingsStore((s) => s.sidebarProviderFilter);
  const availableProviders = useAvailableProviders();
  const isAvailable = useProviderAvailabilityStore((s) => s.isAvailable);
  // Resolve the provider the "+" should commit to. Prefer the filter
  // override (when available), then the user's default (when available),
  // then the first available provider as a last resort. If nothing is
  // available, returns null and the "+" / chevron get hidden entirely
  // below — the user must install a CLI before we can spawn a session.
  const filterOverride = providerFilter && isAvailable(providerFilter) ? providerFilter : undefined;
  const effectiveProvider =
    filterOverride ??
    (defaultProvider && isAvailable(defaultProvider) ? defaultProvider : null) ??
    availableProviders[0]?.id ??
    null;

  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.key,
    disabled: searchActive || workspace.isMissing,
  });

  // Source-row dim while the row is being dragged — the row stays in its
  // slot (Apple Mail / NSOutlineView idiom: nothing reflows during the
  // drag), it just fades to ~40% so the user sees a "ghost" left behind.
  // The shared insertion line at the tree level is what tells them where
  // the drop will land.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const effectiveExpanded = expanded && !isDragging;

  const headerNodeId = `workspace:${workspace.key}`;
  const rowFocused = focusedNodeId === headerNodeId && focusMode;
  const historyNodeId = `history:${workspace.key}`;
  const historyFocused = focusedNodeId === historyNodeId && focusMode;
  const collapsedStatus = !effectiveExpanded
    ? workspace.visibleSessions.some(
        (sessionNode) => sessions[sessionNode.id]?.status === "needsAttention",
      )
      ? "needsAttention"
      : workspace.visibleSessions.some(
            (sessionNode) => sessions[sessionNode.id]?.status === "running",
          )
        ? "running"
        : null
    : null;

  const isDraggable = !searchActive && !workspace.isMissing;

  const handleWorkspaceContextMenu = createContextMenuHandler(() => {
    if (workspace.isMissing || !workspace.repoId) return [];
    const repoId = workspace.repoId;
    const specs: NativeMenuItemSpec[] = [
      {
        kind: "item",
        text: repo?.pinned ? "Unpin" : "Pin",
        action: () => togglePin(repoId),
      },
      // Hide "New Session" when no provider's CLI is currently available —
      // there's nothing to launch with. The Settings page tells the user
      // how to fix it (refresh / install a CLI).
      ...(effectiveProvider !== null
        ? [
            {
              kind: "item" as const,
              text: "New Session",
              action: () => onCreateSession(workspace.key, filterOverride),
            },
          ]
        : []),
      { kind: "item", text: "New Terminal", action: () => onCreateTerminal(workspace.key) },
    ];
    if (workspace.path) {
      const path = workspace.path;
      specs.push(
        { kind: "separator" },
        {
          kind: "item",
          text: IS_MACOS ? "Show in Finder" : "Reveal in File Manager",
          action: () => void revealItemInDir(path),
        },
      );
    }
    specs.push(
      { kind: "separator" },
      { kind: "item", text: "Remove", action: () => onRemoveWorkspace(workspace) },
    );
    return specs;
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative px-3 py-px transition-opacity duration-150 ease-out motion-reduce:transition-none"
      data-workspace-key={workspace.key}
    >
      <div className="min-w-0">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: native context menu attached to wrapper surrounding button */}
        <div
          className="group/workspace sidebar-workspace-header-sticky relative min-w-0"
          onContextMenu={handleWorkspaceContextMenu}
        >
          <button
            ref={registerNodeRef(headerNodeId)}
            type="button"
            role="treeitem"
            aria-expanded={effectiveExpanded}
            tabIndex={rowFocused ? 0 : -1}
            className={cn(
              "flex h-7 min-h-7 w-full min-w-0 select-none items-center gap-2 rounded-md border border-transparent py-0 pl-1.5 pr-8 text-left text-sidebar-foreground outline-none transition-[background-color,border-color,color] duration-100 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground",
              rowFocused &&
                "border-transparent bg-sidebar-interactive-hover text-sidebar-foreground",
              workspace.isMissing && "opacity-70",
            )}
            onFocus={() => onRequestFocus(headerNodeId)}
            {...(isDraggable ? listeners : {})}
            onClick={(e) => {
              onRequestFocus(headerNodeId);
              if (workspace.repoId) {
                setActiveRepo(workspace.repoId);
              }
              if (searchActive) return;
              // Option+click: expand/collapse workspace AND its history in one
              // step — matches NSOutlineView's "expand all descendants" default.
              if (e.altKey) {
                onToggleAllForWorkspace(workspace.key);
              } else {
                onToggleWorkspace(workspace.key);
              }
            }}
          >
            <span
              className="relative inline-flex w-5 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              {effectiveExpanded ? (
                <FolderOpen className="size-4 text-current" />
              ) : (
                <Folder className="size-4 text-current" />
              )}
              {collapsedStatus && (
                <span className="absolute -bottom-0.5 -right-0.5">
                  <StatusDot status={collapsedStatus} className="size-2" />
                </span>
              )}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[1.05rem]"
              title={workspace.path ? shortenPath(workspace.path) : undefined}
            >
              {workspace.name}
            </span>
          </button>
          <div
            className={cn(
              "absolute right-1.5 top-1/2 z-20 flex -translate-y-1/2 items-center justify-end gap-0.5 transition-opacity duration-100",
              rowFocused
                ? "opacity-100"
                : "opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100",
            )}
          >
            {!workspace.isMissing &&
              effectiveProvider !== null &&
              (() => {
                // The "+" reflects the *effective* provider (filter override
                // when active, persisted default otherwise), so a filtered
                // sidebar advertises sessions that match what the user is
                // currently looking at. The provider setting itself is not
                // mutated — clearing the filter snaps the badge back.
                const effectiveProviderModule = getProvider(effectiveProvider);
                const providerLabel = effectiveProviderModule?.displayName;

                // Chevron menu lists only providers whose CLI was found by
                // the most recent availability probe. If we're down to a
                // single provider, the chevron itself is redundant and
                // hides further down — there's nothing to choose between.
                const handleChevronClick = (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  const trigger = e.currentTarget;
                  const items: NativeMenuItemSpec[] = availableProviders.map((provider) => ({
                    kind: "item",
                    text: `New ${provider.displayName} session`,
                    action: () => onCreateSession(workspace.key, provider.id),
                    iconUrl: getProviderMenuPngUrl(provider.id) ?? undefined,
                  }));
                  void showNativeMenuForElement(trigger, items);
                };
                const showChevron = availableProviders.length > 1;

                return (
                  <>
                    <SidebarMenuAction
                      placement="inline"
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateSession(workspace.key, filterOverride);
                      }}
                      className="group/new-session size-5 overflow-visible px-0 text-sidebar-foreground/82"
                      aria-label={
                        providerLabel
                          ? `New ${providerLabel} session in ${workspace.name}`
                          : `New session in ${workspace.name}`
                      }
                    >
                      <span className="relative inline-flex items-center justify-center">
                        <Plus className="size-3" />
                        {providerLabel && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-full left-1/2 z-30 mt-1 inline-flex h-5 -translate-x-1/2 -translate-y-1 items-center gap-1.5 whitespace-nowrap rounded-md border border-sidebar-border/70 bg-sidebar px-1.5 text-[11px] font-medium text-sidebar-foreground opacity-0 shadow-sm transition-[opacity,transform] duration-100 group-hover/new-session:translate-y-0 group-hover/new-session:opacity-100 group-focus-visible/new-session:translate-y-0 group-focus-visible/new-session:opacity-100"
                          >
                            <ProviderIcon
                              provider={effectiveProvider}
                              variant="brand"
                              size={12}
                              className="shrink-0"
                            />
                            <span>{providerLabel}</span>
                          </span>
                        )}
                      </span>
                    </SidebarMenuAction>
                    {showChevron && (
                      <SidebarMenuAction
                        placement="inline"
                        type="button"
                        title="Choose provider"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={handleChevronClick}
                        className="size-5 px-0 text-sidebar-foreground/82"
                        aria-label={`Choose provider for new session in ${workspace.name}`}
                        aria-haspopup="menu"
                      >
                        <ChevronDown className="size-3" />
                      </SidebarMenuAction>
                    )}
                  </>
                );
              })()}
          </div>
        </div>

        {effectiveExpanded && (
          // biome-ignore lint/a11y/useSemanticElements: tree widgets require role="group" for nested items
          <ul role="group" className="sidebar-tree-branch mt-0.5 space-y-0.5">
            {workspace.visibleSessions.map((sessionNode) => (
              <SidebarTreeSessionRow
                key={sessionNode.id}
                ref={registerNodeRef(`session:${sessionNode.id}`)}
                nodeId={`session:${sessionNode.id}`}
                sessionId={sessionNode.id}
                bucket={sessionNode.bucket}
                isFocused={focusedNodeId === `session:${sessionNode.id}`}
                focusMode={focusMode}
                onRequestFocus={onRequestFocus}
              />
            ))}

            {historyExpanded &&
              workspace.historyGroups.map((group) => (
                <Fragment key={group.label}>
                  <li role="none" className="pt-1.5">
                    <button
                      type="button"
                      className="block w-full pl-8 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/88 hover:text-sidebar-foreground"
                      onClick={() => onToggleHistory(workspace.key)}
                    >
                      {group.label}
                    </button>
                  </li>
                  {group.sessions.map((sessionNode) => (
                    <SidebarTreeSessionRow
                      key={sessionNode.id}
                      ref={registerNodeRef(`session:${sessionNode.id}`)}
                      nodeId={`session:${sessionNode.id}`}
                      sessionId={sessionNode.id}
                      bucket={sessionNode.bucket}
                      isFocused={focusedNodeId === `session:${sessionNode.id}`}
                      focusMode={focusMode}
                      onRequestFocus={onRequestFocus}
                    />
                  ))}
                </Fragment>
              ))}

            {workspace.historyCount > 0 && (
              <li role="none" className="pt-0.5">
                <button
                  ref={registerNodeRef(`history:${workspace.key}`)}
                  type="button"
                  role="treeitem"
                  aria-expanded={historyExpanded}
                  tabIndex={historyFocused ? 0 : -1}
                  className={cn(
                    "flex h-7 min-h-7 w-full min-w-0 items-center rounded-md border border-transparent py-0 pl-8 pr-2 text-left text-[11px] font-medium text-sidebar-foreground/88 outline-none transition-[background-color,border-color,color] duration-100 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground",
                    historyFocused &&
                      "border-transparent bg-sidebar-interactive-hover text-sidebar-foreground",
                    searchActive && "cursor-default",
                  )}
                  onFocus={() => onRequestFocus(`history:${workspace.key}`)}
                  onClick={() => {
                    onRequestFocus(`history:${workspace.key}`);
                    if (!searchActive) {
                      onToggleHistory(workspace.key);
                    }
                  }}
                >
                  <span className="flex-1">
                    {historyExpanded ? "Show less" : `Show more (${workspace.historyCount})`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProviderFilterButton() {
  const providerFilter = useSettingsStore((s) => s.sidebarProviderFilter);
  const setProviderFilter = useSettingsStore((s) => s.setSidebarProviderFilter);
  // Only show currently-available providers in the filter menu — listing
  // an unreachable provider would let the user filter to an empty list
  // with no way to create new sessions of that kind.
  const providers = useAvailableProviders();
  const current = providers.find((provider) => provider.id === providerFilter);
  const isFiltered = providerFilter !== "";
  const label = isFiltered
    ? `Filter: ${current?.displayName ?? providerFilter}`
    : "Filter by provider";

  // If a previously-set filter points at a provider that's no longer
  // available, snap back to "All Providers" rather than silently filter
  // to nothing. This catches the case where the user uninstalls a CLI
  // between launches.
  useEffect(() => {
    if (providerFilter && !current) {
      setProviderFilter("");
    }
  }, [providerFilter, current, setProviderFilter]);

  if (providers.length < 2) return null;

  const openFilterMenu = (trigger: HTMLElement) => {
    // "All Providers" stays as a CheckMenuItem so the native checkmark
    // glyph confirms "no filter is active" at a glance. Provider entries
    // use monochrome IconMenuItems; the funnel button below already shows
    // the active provider, so the menu does not need a redundant marker.
    const specs: NativeMenuItemSpec[] = [
      {
        kind: "check",
        text: "All Providers",
        checked: providerFilter === "",
        action: () => setProviderFilter(""),
      },
      ...providers.map<NativeMenuItemSpec>((provider) => ({
        kind: "item",
        text: provider.displayName,
        action: () => setProviderFilter(provider.id),
        iconUrl: getProviderMenuPngUrl(provider.id) ?? undefined,
      })),
    ];
    void showNativeMenuForElement(trigger, specs);
  };

  return (
    <IconButton
      label={label}
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn("sidebar-header-control-button relative", isFiltered && "text-foreground")}
      onClick={(event) => openFilterMenu(event.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openFilterMenu(e.currentTarget);
      }}
    >
      <Funnel className="size-3.5" />
      {isFiltered && (
        // Provider badge tells the user which filter is active without
        // opening the menu.
        <ProviderIcon
          provider={providerFilter}
          variant="brand"
          size={9}
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 -right-1 rounded-[2px] drop-shadow-[0_0_1.5px_var(--sidebar)]"
        />
      )}
    </IconButton>
  );
}

function SortMenuButton() {
  const sessionSort = useSettingsStore((s) => s.sessionSortOrder);
  const setSessionSort = useSettingsStore((s) => s.setSessionSortOrder);
  const workspaceSort = useSettingsStore((s) => s.workspaceSortOrder);
  const setWorkspaceSort = useSettingsStore((s) => s.setWorkspaceSortOrder);
  const isDefault = sessionSort === "recent" && workspaceSort === "manual";

  const openSortMenu = (trigger: HTMLElement) => {
    // Native NSMenu has no dedicated "section header" item, so we fake one
    // with a disabled MenuItem — a long-standing convention in Cocoa apps.
    const specs: NativeMenuItemSpec[] = [
      { kind: "item", text: "Sort workspaces", action: () => {}, enabled: false },
      ...(["recent", "createdAt", "alphabetical", "manual"] as const).map<NativeMenuItemSpec>(
        (value) => ({
          kind: "check",
          text: WORKSPACE_SORT_LABELS[value],
          checked: workspaceSort === value,
          action: () => setWorkspaceSort(value),
        }),
      ),
      { kind: "separator" },
      { kind: "item", text: "Sort sessions", action: () => {}, enabled: false },
      ...(["recent", "createdAt", "oldest", "title", "status"] as const).map<NativeMenuItemSpec>(
        (value) => ({
          kind: "check",
          text: SESSION_SORT_LABELS[value],
          checked: sessionSort === value,
          action: () => setSessionSort(value),
        }),
      ),
    ];
    void showNativeMenuForElement(trigger, specs);
  };

  return (
    <IconButton
      label="Sort"
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn("sidebar-header-control-button relative", !isDefault && "text-foreground")}
      onClick={(event) => openSortMenu(event.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openSortMenu(e.currentTarget);
      }}
    >
      <ArrowUpDown className="size-3.5" />
      {!isDefault && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
        />
      )}
    </IconButton>
  );
}

const SESSION_SORT_LABELS: Record<SessionSortOrder, string> = {
  recent: "Last activity",
  createdAt: "Created at",
  oldest: "Oldest first",
  title: "Title",
  status: "Status",
};

const WORKSPACE_SORT_LABELS: Record<WorkspaceSortOrder, string> = {
  recent: "Last activity",
  createdAt: "Created at",
  alphabetical: "Alphabetical",
  manual: "Manual",
};

interface FlatSearchResultsProps {
  entries: FlatSessionEntry[];
  focusedNodeId: string | null;
  focusMode: boolean;
  onRequestFocus: (nodeId: string) => void;
  registerNodeRef: (id: string) => (node: HTMLButtonElement | null) => void;
}

/**
 * Flat list view shown when the sidebar search input has a query. All
 * matching sessions from every workspace are shown as one list, with no
 * workspace chrome or groupings — users care about finding the session,
 * not where it lives. Empty query restores the workspace tree.
 */
function FlatSearchResults({
  entries,
  focusedNodeId,
  focusMode,
  onRequestFocus,
  registerNodeRef,
}: FlatSearchResultsProps) {
  if (entries.length === 0) {
    return (
      <div className="px-3 pt-4">
        <p className="text-xs text-sidebar-foreground/84">No matches.</p>
      </div>
    );
  }
  return (
    <ul className="group/menu flex min-w-0 flex-col gap-0.5 px-3">
      {entries.map((entry) => {
        const nodeId = `session:${entry.id}`;
        return (
          <SidebarTreeSessionRow
            key={entry.id}
            ref={registerNodeRef(nodeId)}
            nodeId={nodeId}
            sessionId={entry.id}
            bucket={entry.bucket}
            isFocused={focusedNodeId === nodeId}
            focusMode={focusMode}
            onRequestFocus={onRequestFocus}
          />
        );
      })}
    </ul>
  );
}

const EMPTY_TREE: SidebarTree = { pinnedWorkspaces: [], workspaces: [] };

/** Sentinel drop-zone id — `handleDragEnd` pins the dragged workspace on drop. */
const PINNED_DROPZONE_ID = "__pinned_dropzone__";

/** Sentinel drop-zone id — `handleDragEnd` unpins the dragged workspace on drop. */
const WORKSPACES_DROPZONE_ID = "__workspaces_dropzone__";

/**
 * The pinned section is a drop target for two drag systems at once:
 * - Workspace rows use dnd-kit's `useDroppable` (the `isOver` flag below).
 * - Session rows use our custom `session-drag-drop` CustomEvent (bounding-box
 *   hit-test on mouseup — dnd-kit never sees those drags).
 *
 * `hasContent` controls the visual: an explicit dashed card when the section
 * is empty, or a thin highlight when the cursor hovers over an active section.
 */
function PinnedSectionDropZone({
  hasContent,
  children,
}: {
  hasContent: boolean;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: PINNED_DROPZONE_ID });
  const hostRef = useRef<HTMLDivElement>(null);
  const [sessionHover, setSessionHover] = useState(false);
  const draggingSessionId = useSplitViewStore((s) => s.draggingSessionId);

  useEffect(() => {
    if (!draggingSessionId) {
      setSessionHover(false);
      return;
    }
    function hits(clientX: number, clientY: number) {
      const el = hostRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }
    function handleMouseMove(event: MouseEvent) {
      setSessionHover(hits(event.clientX, event.clientY));
    }
    function handleDrop(event: Event) {
      const detail = (event as CustomEvent<SessionDropDetail>).detail;
      const inside = hits(detail.clientX, detail.clientY);
      const sidebar = useSidebarStore.getState();
      const isPinned = Boolean(sidebar.pinnedSessionIds[detail.sessionId]);

      // "Drop the standalone pin back onto the parent workspace" gesture.
      // When a session's parent workspace is itself pinned, both rows live
      // in this same Pinned section, so the existing inside/outside toggle
      // can't see the difference between "drag to reorder within pinned
      // sessions" and "drag onto the parent folder to collapse back into
      // it". Hit-test the workspace rows explicitly: if the drop landed on
      // the dragged session's parent workspace row, unpin the session so
      // it nests under that workspace again.
      const dropTarget = document.elementFromPoint(detail.clientX, detail.clientY);
      const workspaceRowKey =
        dropTarget?.closest<HTMLElement>("[data-workspace-key]")?.dataset.workspaceKey;
      if (workspaceRowKey && isPinned) {
        const session = useSessionStore.getState().sessions[detail.sessionId];
        if (session && session.repoId === workspaceRowKey) {
          sidebar.setSessionPinned(detail.sessionId, false);
          performHaptic("level-change");
          return;
        }
      }

      // Dock-style toggle: inside PINNED pins, outside PINNED unpins (only
      // meaningful for a session that was already pinned — otherwise the
      // drag had nothing to do with this section).
      if (inside && !isPinned) {
        sidebar.setSessionPinned(detail.sessionId, true);
        performHaptic("level-change");
      } else if (!inside && isPinned) {
        sidebar.setSessionPinned(detail.sessionId, false);
        performHaptic("level-change");
      }
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener(SESSION_DROP_EVENT, handleDrop);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener(SESSION_DROP_EVENT, handleDrop);
    };
  }, [draggingSessionId]);

  const highlight = isOver || sessionHover;

  // Empty pinned section: keep an explicit drop target visible so users can
  // discover pinning without needing to start a drag first.
  if (!hasContent) {
    return (
      <div
        ref={(node) => {
          setNodeRef(node);
          hostRef.current = node;
        }}
        className={cn(
          "mx-3 mb-1 flex min-h-7 items-center rounded-md border border-dashed px-2.5 py-1 text-[11px] leading-tight transition-[background-color,border-color,color] duration-100",
          highlight
            ? "border-sidebar-border/70 bg-sidebar-interactive-hover text-sidebar-foreground"
            : "border-sidebar-border/60 bg-transparent text-sidebar-foreground/84",
        )}
      >
        Drag a workspace or session here to pin it.
      </div>
    );
  }

  // Non-empty: wrap existing content. Shows a subtle outline while hovered.
  // `py-1` adds a small vertical "drop tolerance" inside the wrapper — the
  // dropzone's bounding rect now extends a few pixels above the topmost
  // pinned row and below the bottommost. Without it, dropping a session a
  // pixel above a pinned workspace's row falls outside the wrapper and
  // the pin silently no-ops; the user has to land on the row itself.
  // The padding is invisible at rest and only colors in (with the
  // hover-bg) while a session is being dragged over the section.
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        hostRef.current = node;
      }}
      className={cn(
        "rounded-md py-1.5 transition-[background-color] duration-100",
        highlight && "bg-sidebar-interactive-hover",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Explicit unpin drop target — mirror of the empty-state pill on
 * `PinnedSectionDropZone`. Visible only while a pinned workspace is being
 * dragged, so users get a discoverable "drop here to unpin" target without
 * any section-wide chrome shifting in the idle state.
 *
 * Note: the wrapper stays mounted in both states so `setNodeRef` keeps a
 * stable DOM ref. `useDroppable` registers position from that ref; if we
 * conditionally returned null, the ref would only attach mid-drag and
 * dnd-kit's collision detection could miss the pill. CSS handles the
 * visual show/hide so the rect is always available when needed.
 */
function UnpinDropPill({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: WORKSPACES_DROPZONE_ID,
    disabled: !visible,
  });

  return (
    <div
      ref={setNodeRef}
      aria-hidden={!visible}
      className={cn(
        "mx-3 flex items-center overflow-hidden rounded-md border px-2.5 text-[11px] leading-tight transition-[max-height,margin-bottom,padding,border-color,background-color,color,opacity] duration-150",
        visible
          ? "mb-1 max-h-7 border-dashed py-1 opacity-100"
          : "mb-0 max-h-0 border-transparent py-0 opacity-0",
        visible &&
          (isOver
            ? "border-sidebar-border/70 bg-sidebar-interactive-hover text-sidebar-foreground"
            : "border-sidebar-border/60 bg-transparent text-sidebar-foreground/84"),
      )}
    >
      Drop here to unpin.
    </div>
  );
}

/**
 * Shared insertion line for workspace drag-and-drop reorder. One element
 * in the tree, animating its `top` between drop positions — this is the
 * FLIP-style behavior used by Apple Mail's mailbox sidebar, Finder list
 * view, and NSOutlineView in general:
 *
 *   - Source row stays in its slot, ghosted (handled in WorkspaceTreeGroup).
 *   - Other rows never shift to make space — no reflow during the drag.
 *   - A single •—• indicator slides smoothly between gaps as the cursor
 *     moves, giving an unambiguous "the drop will land here" cue.
 *
 * Position is computed in handleDragOver from `over.rect` and the cursor's
 * direction (drop above the over-row's center → top edge; below → bottom),
 * then converted to a tree-local Y so a single CSS `top` transition can
 * carry the line between any two positions.
 */
function DropIndicator({ top, visible }: { top: number; visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-3 z-10 flex -translate-y-1/2 items-center",
        "transition-[top,opacity] duration-150 ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ top }}
    >
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--macos-accent)" }}
      />
      <div
        className="h-0.5 flex-1 rounded-full"
        style={{ backgroundColor: "var(--macos-accent)" }}
      />
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--macos-accent)" }}
      />
    </div>
  );
}

/** Rank status buckets for the "Status" sort: attention first, then active, then closed. */
const STATUS_RANK: Record<string, number> = {
  needsAttention: 0,
  running: 1,
  idle: 2,
  closed: 3,
  archived: 4,
};

type FlatSessionEntry = {
  id: string;
  bucket: import("@/types/sidebar").SidebarSessionBucket;
};

/**
 * Re-order a workspace's visible + history sessions according to the user's
 * sort preference. `recent` is a no-op since the Rust tree already orders by
 * recency — the sort still runs so the function stays pure/simple.
 */
function sortSessionList(
  entries: FlatSessionEntry[],
  order: SessionSortOrder,
  sessions: Record<string, import("@/stores/session-store").Session>,
): FlatSessionEntry[] {
  if (order === "recent") return entries;
  const withMeta = entries
    .map((entry) => ({ entry, session: sessions[entry.id] }))
    .filter((x) => x.session);
  if (order === "createdAt") {
    withMeta.sort((a, b) => b.session.createdAt - a.session.createdAt);
  } else if (order === "oldest") {
    withMeta.sort((a, b) => {
      const aTime = a.session.endedAt ?? a.session.createdAt;
      const bTime = b.session.endedAt ?? b.session.createdAt;
      return aTime - bTime;
    });
  } else if (order === "title") {
    withMeta.sort((a, b) =>
      (a.session.title ?? "").localeCompare(b.session.title ?? "", undefined, {
        sensitivity: "base",
      }),
    );
  } else if (order === "status") {
    withMeta.sort((a, b) => {
      const ra = STATUS_RANK[a.session.status] ?? 99;
      const rb = STATUS_RANK[b.session.status] ?? 99;
      if (ra !== rb) return ra - rb;
      const aTime = a.session.endedAt ?? a.session.createdAt;
      const bTime = b.session.endedAt ?? b.session.createdAt;
      return bTime - aTime;
    });
  }
  return withMeta.map((x) => x.entry);
}

function latestSessionTime(
  ws: SidebarWorkspaceNode,
  sessions: Record<string, import("@/stores/session-store").Session>,
): number {
  let max = 0;
  const consider = (id: string) => {
    const s = sessions[id];
    if (!s) return;
    const t = s.endedAt ?? s.createdAt;
    if (t > max) max = t;
  };
  for (const entry of ws.visibleSessions) consider(entry.id);
  for (const group of ws.historyGroups) {
    for (const entry of group.sessions) consider(entry.id);
  }
  return max;
}

function sortWorkspaceList(
  workspaces: SidebarWorkspaceNode[],
  order: WorkspaceSortOrder,
  sessions: Record<string, import("@/stores/session-store").Session>,
  repos: Record<string, import("@/stores/repo-store").Repository>,
): SidebarWorkspaceNode[] {
  if (order === "manual") return workspaces;
  const copy = [...workspaces];
  if (order === "alphabetical") {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else if (order === "recent") {
    copy.sort((a, b) => latestSessionTime(b, sessions) - latestSessionTime(a, sessions));
  } else if (order === "createdAt") {
    copy.sort((a, b) => {
      const at = a.repoId ? (repos[a.repoId]?.addedAt ?? 0) : 0;
      const bt = b.repoId ? (repos[b.repoId]?.addedAt ?? 0) : 0;
      return bt - at;
    });
  }
  return copy;
}

function sortTree(
  tree: SidebarTree,
  sessionOrder: SessionSortOrder,
  workspaceOrder: WorkspaceSortOrder,
  sessions: Record<string, import("@/stores/session-store").Session>,
  repos: Record<string, import("@/stores/repo-store").Repository>,
): SidebarTree {
  if (sessionOrder === "recent" && workspaceOrder === "manual") return tree;
  const sortInsideWorkspace = (ws: SidebarWorkspaceNode): SidebarWorkspaceNode =>
    sessionOrder === "recent"
      ? ws
      : {
          ...ws,
          visibleSessions: sortSessionList(ws.visibleSessions, sessionOrder, sessions),
          historyGroups: ws.historyGroups.map((group) => ({
            ...group,
            sessions: sortSessionList(group.sessions, sessionOrder, sessions),
          })),
        };
  const pinned = tree.pinnedWorkspaces.map(sortInsideWorkspace);
  const unpinned = tree.workspaces.map(sortInsideWorkspace);
  return {
    pinnedWorkspaces: sortWorkspaceList(pinned, workspaceOrder, sessions, repos),
    workspaces: sortWorkspaceList(unpinned, workspaceOrder, sessions, repos),
  };
}

/** Collect every session node from the tree (used for flat search rendering). */
function flattenSessions(tree: SidebarTree): FlatSessionEntry[] {
  const out: FlatSessionEntry[] = [];
  const pushAll = (ws: SidebarWorkspaceNode) => {
    for (const s of ws.visibleSessions) out.push(s);
    for (const group of ws.historyGroups) {
      for (const s of group.sessions) out.push(s);
    }
  };
  for (const ws of tree.pinnedWorkspaces) pushAll(ws);
  for (const ws of tree.workspaces) pushAll(ws);
  return out;
}

export default function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const { addRepository } = useRepo();

  const repos = useRepoStore((s) => s.repos);
  const activeSessionId = useSessionStore((s) => s.activeSessionId) ?? params.id ?? null;
  // Structurally-stable reference: skips re-sorting the whole tree on every
  // transient (token/pty/live) update. Per-row live data comes from each row's
  // own store slice, so the sidebar still updates live.
  const sessions = useStableSessions();
  const collapsedWorkspaces = useSidebarStore((s) => s.collapsedWorkspaces);
  const expandedHistoryByWorkspace = useSidebarStore((s) => s.expandedHistoryByWorkspace);
  const focusedNodeId = useSidebarStore((s) => s.focusedNodeId);
  const setFocusedNodeId = useSidebarStore((s) => s.setFocusedNodeId);
  const sidebarFocusMode = useSidebarStore((s) => s.sidebarFocusMode);
  const setSidebarFocusMode = useSidebarStore((s) => s.setSidebarFocusMode);
  const sidebarProviderFilter = useSettingsStore((s) => s.sidebarProviderFilter);

  const [tree, setTree] = useState<SidebarTree>(EMPTY_TREE);
  const [loading, setLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<SidebarWorkspaceNode | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Position + visibility of the shared insertion indicator. `top` is in
  // tree-local pixels (relative to treeRef). We always update `top` even
  // when invisible, so when the indicator becomes visible it shows up at
  // the right place instead of sliding from a stale Y.
  const [dropIndicator, setDropIndicator] = useState<{ top: number; visible: boolean }>({
    top: 0,
    visible: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());

  // Debounce the search input so we don't re-fetch the sidebar tree on every
  // keystroke. 150ms is tight enough to feel live, slow enough to batch typing.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 150);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  // Cmd+F dispatches focus-sidebar-search — focus the input and select its
  // contents so the user can start typing or overwrite an existing query.
  useEffect(() => {
    function handleFocusSearch() {
      const el = searchInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    window.addEventListener("focus-sidebar-search", handleFocusSearch);
    return () => window.removeEventListener("focus-sidebar-search", handleFocusSearch);
  }, []);

  const searchActive = debouncedQuery.length > 0;
  const sessionSortOrder = useSettingsStore((s) => s.sessionSortOrder);
  const workspaceSortOrder = useSettingsStore((s) => s.workspaceSortOrder);
  const pinnedSessionIds = useSidebarStore((s) => s.pinnedSessionIds);
  // Typeahead buffer: a Finder-style "type letters to jump to matching row"
  // accumulator. Resets 1s after the last keystroke.
  const typeaheadBufferRef = useRef<string>("");
  const typeaheadTimerRef = useRef<number | null>(null);

  // Clean up the typeahead timer if we unmount mid-search.
  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
    },
    [],
  );

  const focusSidebarNode = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
    node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, []);

  const repoSignature = useMemo(() => {
    return Object.values(repos)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (repo) =>
          `${repo.id}:${repo.sortOrder ?? "x"}:${repo.pinned ? "p" : ""}:${repo.name}:${repo.path}`,
      )
      .join("|");
  }, [repos]);

  const sortedTree = useMemo(
    () => sortTree(tree, sessionSortOrder, workspaceSortOrder, sessions, repos),
    [tree, sessionSortOrder, workspaceSortOrder, sessions, repos],
  );

  // Pinned sessions render in the PINNED section, not in their workspace's
  // list. Strip them from each workspace's visible + history entries and
  // collect them as standalone rows (in their existing sort order).
  const displayTree = useMemo(() => {
    if (Object.keys(pinnedSessionIds).length === 0) return sortedTree;
    const strip = (ws: SidebarWorkspaceNode): SidebarWorkspaceNode => ({
      ...ws,
      visibleSessions: ws.visibleSessions.filter((s) => !pinnedSessionIds[s.id]),
      historyGroups: ws.historyGroups
        .map((group) => ({
          ...group,
          sessions: group.sessions.filter((s) => !pinnedSessionIds[s.id]),
        }))
        .filter((group) => group.sessions.length > 0),
    });
    return {
      pinnedWorkspaces: sortedTree.pinnedWorkspaces.map(strip),
      workspaces: sortedTree.workspaces.map(strip),
    };
  }, [sortedTree, pinnedSessionIds]);

  const pinnedSessionEntries = useMemo(() => {
    if (Object.keys(pinnedSessionIds).length === 0) return [] as FlatSessionEntry[];
    // Take every pinned id that still resolves to a known session and emit
    // it in the user's chosen session sort order.
    const entries: FlatSessionEntry[] = [];
    for (const id of Object.keys(pinnedSessionIds)) {
      if (sessions[id]) entries.push({ id, bucket: "active" });
    }
    // `sortSessionList` is a no-op for "recent" (the Rust tree is already
    // recency-sorted). Pinned ids come from Object.keys in insertion order,
    // so we sort explicitly to match the rest of the sidebar.
    if (sessionSortOrder === "recent") {
      entries.sort((a, b) => {
        const aTime = sessions[a.id].endedAt ?? sessions[a.id].createdAt;
        const bTime = sessions[b.id].endedAt ?? sessions[b.id].createdAt;
        return bTime - aTime;
      });
      return entries;
    }
    return sortSessionList(entries, sessionSortOrder, sessions);
  }, [pinnedSessionIds, sessions, sessionSortOrder]);

  const flatSearchResults = useMemo(
    () =>
      searchActive ? sortSessionList(flattenSessions(sortedTree), sessionSortOrder, sessions) : [],
    [sortedTree, searchActive, sessionSortOrder, sessions],
  );

  const visibleNodes = useMemo(() => {
    // In search mode the render path bypasses workspace chrome — build the
    // matching focusable-node list so j/k navigation follows the flat results.
    if (searchActive) {
      return flatSearchResults.map(
        (entry) =>
          ({
            id: `session:${entry.id}`,
            kind: "session",
            workspaceKey: "",
            sessionId: entry.id,
            bucket: entry.bucket,
          }) as const,
      );
    }
    return buildFocusableNodes(displayTree, collapsedWorkspaces, expandedHistoryByWorkspace);
  }, [
    searchActive,
    flatSearchResults,
    displayTree,
    collapsedWorkspaces,
    expandedHistoryByWorkspace,
  ]);

  const focusableNodeIds = useMemo(() => visibleNodes.map((node) => node.id), [visibleNodes]);

  const registerNodeRef = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        nodeRefs.current.set(id, node);
      } else {
        nodeRefs.current.delete(id);
      }
    },
    [],
  );

  const fetchTree = useCallback(async () => {
    try {
      const nextTree = await getSidebarTree(debouncedQuery, sidebarProviderFilter || null, 5, true);
      setTree(nextTree);
    } catch (error) {
      console.error("[sidebar] Failed to load tree:", error);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, sidebarProviderFilter]);

  useEffect(() => {
    // Re-run when `repoSignature` changes so any repo edit refetches the tree.
    void repoSignature;
    void fetchTree();
  }, [fetchTree, repoSignature]);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    async function setup() {
      const viewsDirty = await listen("engine:views-dirty", () => {
        if (active) void fetchTree();
      });
      unlisteners.push(viewsDirty);
    }

    void setup();

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [fetchTree]);

  useEffect(() => {
    const activeSession = activeSessionId ? sessions[activeSessionId] : null;
    if (!activeSession) return;

    const sidebar = useSidebarStore.getState();
    if (sidebar.collapsedWorkspaces[activeSession.repoId] ?? true) {
      sidebar.setWorkspaceCollapsed(activeSession.repoId, false);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (!sidebarFocusMode) return;
    if (loading) return;
    if (focusedNodeId && focusableNodeIds.some((nodeId) => nodeId === focusedNodeId)) return;
    setFocusedNodeId(focusableNodeIds[0] ?? null);
  }, [sidebarFocusMode, loading, focusedNodeId, focusableNodeIds, setFocusedNodeId]);

  useEffect(() => {
    if (!sidebarFocusMode || !focusedNodeId) return;
    const element = nodeRefs.current.get(focusedNodeId);
    if (!element) return;
    focusSidebarNode(element);
  }, [focusSidebarNode, focusedNodeId, sidebarFocusMode]);

  useEffect(() => {
    function handleFocusTree() {
      setSidebarFocusMode(true);
      setFocusedNodeId(focusableNodeIds[0] ?? null);
    }

    function handleMouseDown(event: MouseEvent) {
      const sidebar = sidebarRef.current;
      if (sidebar && !sidebar.contains(event.target as Node)) {
        setSidebarFocusMode(false);
      }
    }

    window.addEventListener("focus-sidebar-tree", handleFocusTree as EventListener);
    window.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("focus-sidebar-tree", handleFocusTree as EventListener);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [focusableNodeIds, setFocusedNodeId, setSidebarFocusMode]);

  const moveFocus = useCallback(
    (delta: number) => {
      if (focusableNodeIds.length === 0) return;
      const currentIndex = focusedNodeId
        ? focusableNodeIds.indexOf(focusedNodeId as (typeof focusableNodeIds)[number])
        : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : Math.max(0, Math.min(focusableNodeIds.length - 1, currentIndex + delta));
      setFocusedNodeId(focusableNodeIds[nextIndex] ?? null);
      setSidebarFocusMode(true);
    },
    [focusableNodeIds, focusedNodeId, setFocusedNodeId, setSidebarFocusMode],
  );

  const handleRequestFocus = useCallback(
    (nodeId: string) => {
      setFocusedNodeId(nodeId);
    },
    [setFocusedNodeId],
  );

  const handleTreeMouseDownCapture = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea") || target?.isContentEditable) return;
      setSidebarFocusMode(false);
    },
    [setSidebarFocusMode],
  );

  const handleToggleWorkspace = useCallback((workspaceKey: string) => {
    useSidebarStore.getState().toggleWorkspaceCollapsed(workspaceKey);
  }, []);

  const handleToggleHistory = useCallback((workspaceKey: string) => {
    useSidebarStore.getState().toggleWorkspaceHistory(workspaceKey);
  }, []);

  // Option+click / recursive expand: bring the workspace and its history
  // into the same state. If either is collapsed, expand both; otherwise
  // collapse both. Matches NSOutlineView's Option-click expand-all.
  const handleToggleAllForWorkspace = useCallback((workspaceKey: string) => {
    const state = useSidebarStore.getState();
    const isCollapsed = state.collapsedWorkspaces[workspaceKey] ?? true;
    const historyExpanded = state.expandedHistoryByWorkspace[workspaceKey] ?? false;
    const shouldExpand = isCollapsed || !historyExpanded;
    state.setWorkspaceCollapsed(workspaceKey, !shouldExpand);
    if (historyExpanded !== shouldExpand) {
      state.toggleWorkspaceHistory(workspaceKey);
    }
  }, []);

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      const session = useSessionStore.getState().sessions[sessionId];
      if (!session) return;
      useRepoStore.getState().setActiveRepo(session.repoId);
      navigate(`/session/${sessionId}`);
    },
    [navigate],
  );

  const handleArchiveSession = useCallback((sessionId: string) => {
    useSessionStore.getState().archiveSession(sessionId);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const pinnedSortItems = useMemo(
    () => tree.pinnedWorkspaces.map((workspace) => workspace.key),
    [tree.pinnedWorkspaces],
  );

  const workspaceSortItems = useMemo(
    () => tree.workspaces.map((workspace) => workspace.key),
    [tree.workspaces],
  );

  const allWorkspaces = useMemo(
    () => [...tree.pinnedWorkspaces, ...tree.workspaces],
    [tree.pinnedWorkspaces, tree.workspaces],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setDropIndicator((prev) => ({ ...prev, visible: false }));
  }, []);

  /**
   * Drives the shared insertion indicator. Fires on every pointer move
   * during a drag, computing the tree-local Y where the line should sit:
   *   - cursor in the upper half of the over-row → top edge (drop *before*)
   *   - cursor in the lower half → bottom edge (drop *after*)
   *
   * Direction is read from active.rect vs over.rect so the visual matches
   * what handleDragEnd will actually do — both apply the same rule.
   *
   * The indicator is hidden when the over target isn't a workspace row
   * (e.g. a session row, pin/unpin pill, or empty section dropzone all
   * have their own visual feedback).
   */
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        setDropIndicator((prev) => ({ ...prev, visible: false }));
        return;
      }
      const overId = String(over.id);
      const isWorkspaceRow = allWorkspaces.some((w) => w.key === overId);
      if (!isWorkspaceRow) {
        setDropIndicator((prev) => ({ ...prev, visible: false }));
        return;
      }
      const activeRect = active.rect.current.translated;
      const overRect = over.rect;
      const treeEl = treeRef.current;
      if (!activeRect || !overRect || !treeEl) return;
      const treeRect = treeEl.getBoundingClientRect();
      const activeCenter = activeRect.top + activeRect.height / 2;
      const overCenter = overRect.top + overRect.height / 2;
      const dropAbove = activeCenter < overCenter;
      const lineY = (dropAbove ? overRect.top : overRect.top + overRect.height) - treeRect.top;
      setDropIndicator({ top: lineY, visible: true });
    },
    [allWorkspaces],
  );

  /**
   * The unpin pill is small and sits between rows, so `closestCenter` keeps
   * picking the nearest sortable row (whose center is always close to the
   * cursor) instead of the pill itself. When the pointer is literally
   * inside the pill, force-select it. Everything else (pin dropzone, row
   * reordering, cross-section row drops) keeps `closestCenter` semantics —
   * each row owns its own insertion-line indicator and computes drop
   * direction from active.rect vs over.rect.
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args);
    const unpinPill = pointerHits.find((c) => c.id === WORKSPACES_DROPZONE_ID);
    if (unpinPill) return [unpinPill];
    return closestCenter(args);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setDropIndicator((prev) => ({ ...prev, visible: false }));

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Dropped onto the "drag to pin" placeholder — pin the workspace.
      if (overId === PINNED_DROPZONE_ID) {
        const draggedWorkspace = allWorkspaces.find((w) => w.key === activeId);
        if (draggedWorkspace?.repoId && !draggedWorkspace.isMissing) {
          const repo = useRepoStore.getState().repos[draggedWorkspace.repoId];
          if (repo && !repo.pinned) {
            useRepoStore.getState().togglePin(draggedWorkspace.repoId);
            performHaptic("level-change");
          }
        }
        return;
      }

      // Dropped on the WORKSPACES section's empty space — unpin a pinned
      // workspace. Mirror of the pin path above; the row-on-row cross-section
      // toggle below already covers dropping directly on an unpinned row.
      if (overId === WORKSPACES_DROPZONE_ID) {
        const draggedWorkspace = allWorkspaces.find((w) => w.key === activeId);
        if (draggedWorkspace?.repoId && !draggedWorkspace.isMissing) {
          const repo = useRepoStore.getState().repos[draggedWorkspace.repoId];
          if (repo?.pinned) {
            useRepoStore.getState().togglePin(draggedWorkspace.repoId);
            performHaptic("level-change");
          }
        }
        return;
      }

      const isPinnedSource = pinnedSortItems.includes(activeId);
      const isPinnedTarget = pinnedSortItems.includes(overId);

      // Dragged across sections — toggle pin
      if (isPinnedSource !== isPinnedTarget) {
        const draggedWorkspace = allWorkspaces.find((w) => w.key === activeId);
        if (draggedWorkspace?.repoId && !draggedWorkspace.isMissing) {
          useRepoStore.getState().togglePin(draggedWorkspace.repoId);
          performHaptic("level-change");
        }
        return;
      }

      // Reorder within the same section
      const sortItems = isPinnedSource ? pinnedSortItems : workspaceSortItems;
      const list = isPinnedSource ? tree.pinnedWorkspaces : tree.workspaces;
      const draggedWorkspace = list.find((w) => w.key === activeId);
      const overWorkspace = list.find((w) => w.key === overId);
      if (
        !draggedWorkspace ||
        !overWorkspace ||
        draggedWorkspace.isMissing ||
        overWorkspace.isMissing
      ) {
        return;
      }

      const oldIndex = sortItems.indexOf(activeId);
      const overIndex = sortItems.indexOf(overId);
      if (oldIndex < 0 || overIndex < 0) return;

      // Decide whether the drop lands *before* or *after* the over row from
      // the geometry of the drag — same rule the row indicator uses to pick
      // its top/bottom edge. Without this, dropping onto the upper half of a
      // row (e.g. above the topmost workspace) gets snapped to the row's
      // index by arrayMove, which is "after" semantics.
      const activeRect = active.rect.current.translated;
      const overRect = over.rect;
      let newIndex = overIndex;
      if (activeRect && overRect) {
        const activeCenter = activeRect.top + activeRect.height / 2;
        const overCenter = overRect.top + overRect.height / 2;
        const dropAbove = activeCenter < overCenter;
        if (dropAbove && oldIndex < overIndex) newIndex = overIndex - 1;
        else if (!dropAbove && oldIndex > overIndex) newIndex = overIndex + 1;
      }
      if (oldIndex === newIndex) return;

      const nextOrder = arrayMove([...sortItems], oldIndex, newIndex);
      useRepoStore
        .getState()
        .reorderRepos(
          nextOrder.filter((key) =>
            list.some((workspace) => workspace.key === key && !workspace.isMissing),
          ),
        );
      performHaptic("alignment");
    },
    [allWorkspaces, pinnedSortItems, workspaceSortItems, tree.pinnedWorkspaces, tree.workspaces],
  );

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Never hijack keystrokes that are destined for an input (the sidebar
      // search field, inline rename, etc.). Without this guard the typeahead
      // below swallows every character the user tries to type.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const activeNode = focusedNodeId
        ? visibleNodes.find((node) => node.id === focusedNodeId)
        : null;

      if (!sidebarFocusMode || !activeNode) return;

      // Typeahead — Finder-style "type letters to jump to matching row", 1s
      // inactivity resets the buffer. `j`/`k` stay reserved for vim-style
      // navigation (tradeoff: users can't typeahead to titles starting with
      // j/k — they should use Cmd+F search for that). No modifiers, no IME
      // composition, printable letter/digit only.
      if (
        event.key.length === 1 &&
        event.key !== "j" &&
        event.key !== "k" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.nativeEvent.isComposing &&
        /^[a-zA-Z0-9]$/.test(event.key)
      ) {
        event.preventDefault();
        typeaheadBufferRef.current = (typeaheadBufferRef.current + event.key).toLowerCase();

        if (typeaheadTimerRef.current !== null) {
          window.clearTimeout(typeaheadTimerRef.current);
        }
        typeaheadTimerRef.current = window.setTimeout(() => {
          typeaheadBufferRef.current = "";
          typeaheadTimerRef.current = null;
        }, 1000);

        const query = typeaheadBufferRef.current;
        const sessionsMap = useSessionStore.getState().sessions;
        for (const node of visibleNodes) {
          let label: string | undefined;
          if (node.kind === "session") {
            label = sessionsMap[node.sessionId]?.title?.toLowerCase();
          } else if (node.kind === "workspace") {
            label = allWorkspaces.find((w) => w.key === node.workspaceKey)?.name.toLowerCase();
          }
          if (label?.startsWith(query)) {
            setFocusedNodeId(node.id);
            setSidebarFocusMode(true);
            return;
          }
        }
        return;
      }

      // Cmd+↑ / Cmd+↓ — top/bottom of tree. AppKit convention for lists.
      if (event.metaKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const targetId =
          event.key === "ArrowDown"
            ? focusableNodeIds[focusableNodeIds.length - 1]
            : focusableNodeIds[0];
        if (targetId) {
          setFocusedNodeId(targetId);
          setSidebarFocusMode(true);
        }
        return;
      }

      // Option+↑ / Option+↓ — jump to prev/next section header (workspace).
      // Mirrors the "navigate by section" pattern native sidebars use.
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const currentIndex = focusableNodeIds.indexOf(activeNode.id);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        let index = currentIndex + delta;
        while (index >= 0 && index < visibleNodes.length) {
          if (visibleNodes[index].kind === "workspace") {
            setFocusedNodeId(visibleNodes[index].id);
            setSidebarFocusMode(true);
            return;
          }
          index += delta;
        }
        return;
      }

      if (event.key === "ArrowDown" || (!event.metaKey && !event.ctrlKey && event.key === "j")) {
        event.preventDefault();
        moveFocus(1);
        return;
      }

      if (event.key === "ArrowUp" || (!event.metaKey && !event.ctrlKey && event.key === "k")) {
        event.preventDefault();
        moveFocus(-1);
        return;
      }

      if (event.key === "F2" && activeNode.kind === "session") {
        event.preventDefault();
        useSidebarStore.getState().setRenamingSessionId(activeNode.sessionId);
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && activeNode.kind === "session") {
        event.preventDefault();
        handleArchiveSession(activeNode.sessionId);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (activeNode.kind === "session") {
          handleOpenSession(activeNode.sessionId);
        } else if (activeNode.kind === "workspace") {
          handleToggleWorkspace(activeNode.workspaceKey);
        } else if (activeNode.kind === "history") {
          handleToggleHistory(activeNode.workspaceKey);
        }
        return;
      }

      if (event.key === " ") {
        if (activeNode.kind === "workspace") {
          event.preventDefault();
          handleToggleWorkspace(activeNode.workspaceKey);
        } else if (activeNode.kind === "history") {
          event.preventDefault();
          handleToggleHistory(activeNode.workspaceKey);
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (activeNode.kind === "session") {
          const historyNodeId = `history:${activeNode.workspaceKey}`;
          if (
            activeNode.bucket === "history" &&
            focusableNodeIds.some((nodeId) => nodeId === historyNodeId)
          ) {
            setFocusedNodeId(historyNodeId);
          } else {
            setFocusedNodeId(`workspace:${activeNode.workspaceKey}`);
          }
          return;
        }

        if (activeNode.kind === "history") {
          if (expandedHistoryByWorkspace[activeNode.workspaceKey] ?? false) {
            handleToggleHistory(activeNode.workspaceKey);
          } else {
            setFocusedNodeId(`workspace:${activeNode.workspaceKey}`);
          }
          return;
        }

        if (activeNode.kind === "workspace") {
          const isExpanded = !(collapsedWorkspaces[activeNode.workspaceKey] ?? true);
          if (isExpanded) {
            handleToggleWorkspace(activeNode.workspaceKey);
          }
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (activeNode.kind === "workspace") {
          const nextIndex = focusableNodeIds.indexOf(activeNode.id) + 1;
          const nextId = focusableNodeIds[nextIndex];
          if (collapsedWorkspaces[activeNode.workspaceKey] ?? true) {
            handleToggleWorkspace(activeNode.workspaceKey);
          } else if (nextId) {
            setFocusedNodeId(nextId);
          }
          return;
        }

        if (activeNode.kind === "history") {
          if (!(expandedHistoryByWorkspace[activeNode.workspaceKey] ?? false)) {
            handleToggleHistory(activeNode.workspaceKey);
          } else {
            const nextIndex = focusableNodeIds.indexOf(activeNode.id) + 1;
            setFocusedNodeId(focusableNodeIds[nextIndex] ?? activeNode.id);
          }
        }
      }
    },
    [
      allWorkspaces,
      collapsedWorkspaces,
      expandedHistoryByWorkspace,
      focusableNodeIds,
      focusedNodeId,
      handleArchiveSession,
      handleOpenSession,
      handleToggleHistory,
      handleToggleWorkspace,
      moveFocus,
      setFocusedNodeId,
      setSidebarFocusMode,
      sidebarFocusMode,
      visibleNodes,
    ],
  );

  const handleCreateSessionForWorkspace = useCallback(
    (workspaceKey: string, providerId?: string) => {
      // workspaceKey is the repoId for non-missing workspaces
      if (!useRepoStore.getState().repos[workspaceKey]) return;
      useRepoStore.getState().setActiveRepo(workspaceKey);
      const params = new URLSearchParams({ repo: workspaceKey });
      if (providerId) params.set("provider", providerId);
      navigate(`/session/new?${params.toString()}`);
    },
    [navigate],
  );

  const handleCreateTerminalForWorkspace = useCallback((workspaceKey: string) => {
    if (!useRepoStore.getState().repos[workspaceKey]) return;
    useRepoStore.getState().setActiveRepo(workspaceKey);
    window.dispatchEvent(new CustomEvent("new-terminal-session"));
  }, []);

  // Right-click on blank sidebar area shows a native menu with the same
  // top-level "create" actions. Inner rows have their own context menus
  // (which stopPropagate), so this only fires when the user clicks in
  // the whitespace of an empty workspace or below the last entry.
  const handleEmptySidebarContextMenu = createContextMenuHandler(() => [
    {
      kind: "item",
      text: "New Session",
      action: () => useModalStore.getState().setNewSessionDialogOpen(true),
    },
    {
      kind: "item",
      text: "Add Workspace",
      action: () => void addRepository(),
    },
  ]);

  const { desktopSidebarVisible } = useSidebar();
  const handleSidebarToolbarMouseDown = useNativeWindowDrag(IS_MACOS && desktopSidebarVisible);
  const handleSidebarToolbarDoubleClick = useNativeWindowTitlebarDoubleClick(
    IS_MACOS && desktopSidebarVisible,
  );

  return (
    <Sidebar onKeyDown={handleTreeKeyDown}>
      <div ref={sidebarRef} className="relative flex h-full flex-col bg-sidebar">
        {IS_MACOS && desktopSidebarVisible && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-[var(--window-native-titlebar-height)] bottom-0 z-10 w-px bg-sidebar-border/75"
          />
        )}
        <div className="relative isolate">
          <div
            {...(IS_MACOS && desktopSidebarVisible ? { "data-window-drag-surface": "" } : {})}
            onMouseDownCapture={handleSidebarToolbarMouseDown}
            onDoubleClickCapture={handleSidebarToolbarDoubleClick}
            style={{
              transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
              transitionTimingFunction: SIDEBAR_MOTION_EASING,
            }}
            className={cn(
              "window-toolbar-row relative z-10",
              IS_MACOS
                ? "h-[var(--window-native-titlebar-height)]"
                : "h-[var(--window-toolbar-height)]",
              !IS_MACOS || !desktopSidebarVisible ? "pl-3.5" : undefined,
            )}
          />
        </div>

        <SidebarHeader className="gap-0 px-3 pb-2 pt-1">
          <div className="relative flex items-center">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 z-10 size-3.5 text-sidebar-foreground/86"
            />
            <Input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQuery("");
                  searchInputRef.current?.blur();
                }
              }}
              placeholder="Search"
              aria-label="Search sessions"
              className={cn("sidebar-search-field pl-7", searchQuery && "pr-7")}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear sidebar search"
                className="absolute right-1.5 z-10 inline-flex size-5 items-center justify-center rounded-md text-sidebar-foreground/86 transition-[background-color,color] duration-100 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground focus-visible:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchQuery("");
                  setDebouncedQuery("");
                  searchInputRef.current?.focus();
                }}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </SidebarHeader>

        <SidebarSeparator className="mb-1 bg-sidebar-border/75" />

        <SidebarContent className="gap-0 pb-3" onContextMenu={handleEmptySidebarContextMenu}>
          <div
            ref={treeRef}
            role="tree"
            aria-label="Workspaces and sessions"
            className="relative space-y-0.5 pb-3"
            onMouseDownCapture={handleTreeMouseDownCapture}
          >
            {searchActive ? (
              <FlatSearchResults
                entries={flatSearchResults}
                focusedNodeId={focusedNodeId}
                focusMode={sidebarFocusMode}
                onRequestFocus={handleRequestFocus}
                registerNodeRef={registerNodeRef}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
              >
                {(() => {
                  const pinnedEmpty =
                    displayTree.pinnedWorkspaces.length === 0 && pinnedSessionEntries.length === 0;
                  return (
                    <>
                      <div className="flex items-center gap-1.5 px-3.5 pb-1 pt-1">
                        <span
                          data-sidebar-section-label
                          className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                        >
                          Pinned
                        </span>
                      </div>

                      <PinnedSectionDropZone hasContent={!pinnedEmpty}>
                        {/*
                         * Order within the pinned section:
                         *   1. Standalone pinned sessions (flat rows).
                         *   2. Pinned workspaces (folders, expandable).
                         *
                         * Sessions sit on top because they're concrete units
                         * of work — what the user is actively flipping
                         * between — while pinned folders are containers the
                         * user explores into. Putting sessions first keeps
                         * the most-used items in the prime real estate.
                         * A faint hairline + a hair of vertical breathing
                         * room separates the two without breaking the
                         * "single Pinned section" feel.
                         */}
                        {pinnedSessionEntries.length > 0 && (
                          <ul className="group/menu flex min-w-0 flex-col gap-0.5 px-3 pt-0.5">
                            {pinnedSessionEntries.map((entry) => {
                              const nodeId = `session:${entry.id}`;
                              return (
                                <SidebarTreeSessionRow
                                  key={entry.id}
                                  ref={registerNodeRef(nodeId)}
                                  nodeId={nodeId}
                                  sessionId={entry.id}
                                  bucket={entry.bucket}
                                  isFocused={focusedNodeId === nodeId}
                                  focusMode={sidebarFocusMode}
                                  onRequestFocus={handleRequestFocus}
                                />
                              );
                            })}
                          </ul>
                        )}

                        {pinnedSessionEntries.length > 0 &&
                          displayTree.pinnedWorkspaces.length > 0 && (
                            <div
                              aria-hidden="true"
                              className="mx-3 my-1.5 h-px bg-sidebar-border/40"
                            />
                          )}

                        <SortableContext items={pinnedSortItems}>
                          {displayTree.pinnedWorkspaces.map((workspace) => {
                            const wsExpanded = !(collapsedWorkspaces[workspace.key] ?? true);
                            const histExpanded = expandedHistoryByWorkspace[workspace.key] ?? false;

                            return (
                              <WorkspaceTreeGroup
                                key={workspace.key}
                                workspace={workspace}
                                expanded={wsExpanded}
                                historyExpanded={histExpanded}
                                focusedNodeId={focusedNodeId}
                                focusMode={sidebarFocusMode}
                                searchActive={false}
                                registerNodeRef={registerNodeRef}
                                onRequestFocus={handleRequestFocus}
                                onToggleWorkspace={handleToggleWorkspace}
                                onToggleAllForWorkspace={handleToggleAllForWorkspace}
                                onToggleHistory={handleToggleHistory}
                                onCreateSession={handleCreateSessionForWorkspace}
                                onCreateTerminal={handleCreateTerminalForWorkspace}
                                onRemoveWorkspace={setRemoveTarget}
                              />
                            );
                          })}
                        </SortableContext>
                      </PinnedSectionDropZone>
                    </>
                  );
                })()}

                <div
                  className={cn(
                    "flex min-h-6 items-center justify-between px-3.5 pb-0.5",
                    displayTree.pinnedWorkspaces.length > 0 || pinnedSessionEntries.length > 0
                      ? "pt-2"
                      : "pt-0.5",
                  )}
                >
                  <span
                    data-sidebar-section-label
                    className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                  >
                    Workspaces
                  </span>
                  <div
                    data-sidebar-section-controls
                    data-sidebar-section-controls-visible="true"
                    className="sidebar-section-control-strip flex items-center gap-0.5 transition-opacity duration-100"
                  >
                    <ProviderFilterButton />
                    <SortMenuButton />
                    <IconButton
                      label="Add workspace"
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="sidebar-header-control-button"
                      onClick={() => void addRepository()}
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
                  </div>
                </div>

                <UnpinDropPill
                  visible={activeDragId !== null && pinnedSortItems.includes(activeDragId)}
                />

                <SortableContext items={workspaceSortItems}>
                  {displayTree.workspaces.map((workspace) => {
                    const wsExpanded = !(collapsedWorkspaces[workspace.key] ?? true);
                    const histExpanded = expandedHistoryByWorkspace[workspace.key] ?? false;

                    return (
                      <WorkspaceTreeGroup
                        key={workspace.key}
                        workspace={workspace}
                        expanded={wsExpanded}
                        historyExpanded={histExpanded}
                        focusedNodeId={focusedNodeId}
                        focusMode={sidebarFocusMode}
                        searchActive={false}
                        registerNodeRef={registerNodeRef}
                        onRequestFocus={handleRequestFocus}
                        onToggleWorkspace={handleToggleWorkspace}
                        onToggleAllForWorkspace={handleToggleAllForWorkspace}
                        onToggleHistory={handleToggleHistory}
                        onCreateSession={handleCreateSessionForWorkspace}
                        onCreateTerminal={handleCreateTerminalForWorkspace}
                        onRemoveWorkspace={setRemoveTarget}
                      />
                    );
                  })}
                </SortableContext>

                <DropIndicator top={dropIndicator.top} visible={dropIndicator.visible} />

                <DragOverlay
                  dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
                >
                  {activeDragId &&
                    (() => {
                      const w = allWorkspaces.find((ws) => ws.key === activeDragId);
                      if (!w) return null;
                      return (
                        <div className="sidebar-drag-preview px-3 py-px">
                          <div className="flex h-7 min-w-44 items-center gap-2 pl-1.5 pr-1">
                            <span className="inline-flex w-5 shrink-0 items-center justify-center text-sidebar-foreground/92">
                              <Folder className="size-4 text-current" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[1.05rem] text-sidebar-foreground">
                              {w.name}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                </DragOverlay>
              </DndContext>
            )}

            {!searchActive &&
              !loading &&
              sortedTree.pinnedWorkspaces.length === 0 &&
              sortedTree.workspaces.length === 0 && (
                <div className="px-3.5 pt-8">
                  <div className="flex min-h-[150px] flex-col items-center justify-center gap-3 px-4 py-6 text-center">
                    <FolderPlus className="size-7 text-sidebar-foreground/82" />
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-sidebar-foreground">
                        No workspaces yet
                      </p>
                      <p className="text-xs leading-5 text-sidebar-foreground/78">
                        Add a workspace to start supervising sessions across projects.
                      </p>
                    </div>
                    <Button type="button" onClick={() => void addRepository()} size="sm">
                      Add Workspace
                    </Button>
                  </div>
                </div>
              )}
          </div>
        </SidebarContent>

        <SidebarSeparator className="mt-auto bg-sidebar-border/75" />

        <SidebarFooter className="gap-0.5 px-2 pt-1.5 pb-[max(0.5rem,var(--window-corner-safe-area))]">
          <UpdatePill />
          <button
            type="button"
            aria-current={location.pathname === "/" ? "page" : undefined}
            onClick={() => navigate("/")}
            className={cn(
              "sidebar-header-control-button sidebar-footer-control flex h-7 w-full items-center gap-2 rounded-md pl-3.5 pr-2.5 text-left text-[13px] leading-[1.05rem] outline-none transition-colors duration-150 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground",
              location.pathname === "/" && "sidebar-footer-control-active",
            )}
          >
            <LayoutDashboard className="size-4 shrink-0" />
            <span className="truncate">Dashboard</span>
          </button>
          <button
            type="button"
            aria-current={location.pathname === "/settings" ? "page" : undefined}
            onClick={() => navigate("/settings")}
            className={cn(
              "sidebar-header-control-button sidebar-footer-control flex h-7 w-full items-center gap-2 rounded-md pl-3.5 pr-2.5 text-left text-[13px] leading-[1.05rem] outline-none transition-colors duration-150 hover:bg-sidebar-interactive-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-interactive-hover focus-visible:text-sidebar-foreground",
              location.pathname === "/settings" && "sidebar-footer-control-active",
            )}
          >
            <Settings className="size-4 shrink-0" />
            <span className="truncate">Settings</span>
          </button>
        </SidebarFooter>

        <SidebarResizeHandle />

        <RemoveWorkspaceDialog
          open={removeTarget !== null}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          workspaceName={removeTarget?.name ?? ""}
          onConfirm={() => {
            if (!removeTarget?.repoId) return;
            useRepoStore.getState().removeRepo(removeTarget.repoId);
            setRemoveTarget(null);
          }}
        />
      </div>
    </Sidebar>
  );
}
