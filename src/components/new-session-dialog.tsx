import { Folder, FolderPlus, LoaderCircle, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useRepo } from "@/hooks/use-repo";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { useAvailableProviders } from "@/providers/registry";
import { useModalStore } from "@/stores/modal-store";
import { type Repository, useRepoStore } from "@/stores/repo-store";
import { useSettingsStore } from "@/stores/settings-store";

function shortenPath(p: string): string {
  const match = p.match(/^\/Users\/[^/]+\/(.+)$/) ?? p.match(/^\/home\/[^/]+\/(.+)$/);
  return match ? `~/${match[1]}` : p;
}

function getWorkspaceOptionId(repoId: string) {
  return `new-session-workspace-${repoId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function NewSessionDialog() {
  const open = useModalStore((s) => s.newSessionDialogOpen);
  const setOpen = useModalStore((s) => s.setNewSessionDialogOpen);

  if (!open) return null;

  return <MountedNewSessionDialog setOpen={setOpen} />;
}

function MountedNewSessionDialog({ setOpen }: { setOpen: (open: boolean) => void }) {
  const repos = useRepoStore((s) => s.repos);
  const activeRepoId = useRepoStore((s) => s.activeRepoId);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const navigate = useNavigate();
  const { startSession } = useSession();
  const { addRepository } = useRepo();
  const [addingWorkspace, setAddingWorkspace] = useState(false);

  const handleAddWorkspace = useCallback(async () => {
    if (addingWorkspace) return;
    setAddingWorkspace(true);
    // Snapshot existing repos so we can detect the newly-added one and
    // pre-select it in the dialog without forcing the user to scroll/find it.
    const before = new Set(Object.keys(useRepoStore.getState().repos));
    try {
      // `autoStartSession: false` is critical here — the user is in the
      // middle of picking a provider in this dialog. Letting the default
      // behaviour kick off a session in the freshly-added workspace would
      // navigate them away before they confirm.
      await addRepository({ autoStartSession: false });
    } finally {
      setAddingWorkspace(false);
    }
    const after = useRepoStore.getState().repos;
    const addedId = Object.keys(after).find((id) => !before.has(id));
    if (addedId) setSelectedRepoId(addedId);
  }, [addRepository, addingWorkspace]);

  // Available providers (CLI was found by the latest probe). The dialog
  // is the primary entry point for spawning sessions, so listing
  // unreachable providers here would dead-end the user.
  const providers = useAvailableProviders();
  const [search, setSearch] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  // If the user's default provider isn't available right now, start the
  // dialog on the first available provider rather than a row that can't
  // actually launch.
  const [selectedProvider, setSelectedProvider] = useState(() => {
    const initial = providers.find((p) => p.id === defaultProvider) ?? providers[0];
    return initial?.id ?? defaultProvider;
  });
  const [creating, setCreating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const providerButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const sortedRepos = useMemo(
    () =>
      Object.values(repos).sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.lastOpenedAt - a.lastOpenedAt;
      }),
    [repos],
  );

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRepos;
    return sortedRepos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [sortedRepos, search]);

  const pinnedMatches = useMemo(() => filteredRepos.filter((r) => r.pinned), [filteredRepos]);
  const otherMatches = useMemo(() => filteredRepos.filter((r) => !r.pinned), [filteredRepos]);

  const orderedIds = useMemo(
    () => [...pinnedMatches, ...otherMatches].map((r) => r.id),
    [pinnedMatches, otherMatches],
  );

  // Pre-select active workspace once on mount, fall back to first visible item.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (orderedIds.length === 0) return;
    initializedRef.current = true;
    setSelectedRepoId(
      activeRepoId && orderedIds.includes(activeRepoId) ? activeRepoId : orderedIds[0],
    );
  }, [activeRepoId, orderedIds]);

  // Keep selection valid when the filter changes.
  useEffect(() => {
    if (orderedIds.length === 0) {
      setSelectedRepoId(null);
      return;
    }
    if (!selectedRepoId || !orderedIds.includes(selectedRepoId)) {
      setSelectedRepoId(orderedIds[0]);
    }
  }, [orderedIds, selectedRepoId]);

  // Scroll the selected row into view whenever selection changes.
  useEffect(() => {
    if (!selectedRepoId) return;
    const el = itemRefs.current.get(selectedRepoId);
    const list = listRef.current;
    if (!el || !list) return;

    const listRect = list.getBoundingClientRect();
    const itemRect = el.getBoundingClientRect();
    const inset = 12;

    if (itemRect.top < listRect.top + inset) {
      list.scrollTop -= listRect.top + inset - itemRect.top;
    } else if (itemRect.bottom > listRect.bottom - inset) {
      list.scrollTop += itemRect.bottom - (listRect.bottom - inset);
    }
  }, [selectedRepoId]);

  // Save and restore focus across open/close.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const el = previousFocusRef.current;
      previousFocusRef.current = null;
      if (el) requestAnimationFrame(() => el.focus());
    };
  }, []);

  // Focus input on open.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (orderedIds.length === 0) return;
      const currentIndex = selectedRepoId ? orderedIds.indexOf(selectedRepoId) : -1;
      const nextIndex =
        currentIndex < 0
          ? delta >= 0
            ? 0
            : orderedIds.length - 1
          : Math.max(0, Math.min(orderedIds.length - 1, currentIndex + delta));
      setSelectedRepoId(orderedIds[nextIndex]);
    },
    [orderedIds, selectedRepoId],
  );

  const focusProviderByDelta = useCallback(
    (delta: number) => {
      const ids = providers.map((p) => p.id);
      if (ids.length < 2) return;
      const cur = ids.indexOf(selectedProvider);
      const next = cur < 0 ? 0 : (cur + delta + ids.length) % ids.length;
      const nextId = ids[next];
      setSelectedProvider(nextId);
      requestAnimationFrame(() => providerButtonRefs.current.get(nextId)?.focus());
    },
    [providers, selectedProvider],
  );

  const handleCreate = useCallback(async () => {
    if (!selectedRepoId || creating) return;
    setCreating(true);
    try {
      useRepoStore.getState().setActiveRepo(selectedRepoId);
      const sessionId = await startSession({
        prompt: "",
        repoId: selectedRepoId,
        providerId: selectedProvider,
      });
      setOpen(false);
      navigate(`/session/${sessionId}`);
    } catch (err) {
      console.error("[new-session-dialog] Failed to start:", err);
      toast.error("Could not start session", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
      setCreating(false);
    }
  }, [selectedRepoId, selectedProvider, creating, startSession, setOpen, navigate]);

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (creating) return;

      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      };

      if (event.key === "Escape") {
        claim();
        setOpen(false);
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-new-session-footer-control]")) return;

      switch (event.key) {
        case "ArrowDown":
          claim();
          moveSelection(1);
          return;
        case "ArrowUp":
          claim();
          moveSelection(-1);
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          // Cycle the selected provider regardless of which dialog field has
          // focus. Users typing into the search input get one-handed access
          // to provider switching this way; the small cost is that they
          // can't use ←/→ to move the text cursor inside the search field.
          if (providers.length < 2) return;
          claim();
          const delta = event.key === "ArrowRight" ? 1 : -1;
          const ids = providers.map((p) => p.id);
          const cur = ids.indexOf(selectedProvider);
          const next = cur < 0 ? 0 : (cur + delta + ids.length) % ids.length;
          setSelectedProvider(ids[next]);
          return;
        }
        case "PageDown":
          claim();
          moveSelection(5);
          return;
        case "PageUp":
          claim();
          moveSelection(-5);
          return;
        case "Home":
          claim();
          if (orderedIds.length > 0) setSelectedRepoId(orderedIds[0]);
          return;
        case "End":
          claim();
          if (orderedIds.length > 0) setSelectedRepoId(orderedIds[orderedIds.length - 1]);
          return;
        case "Enter":
          claim();
          void handleCreate();
          return;
      }
    },
    [creating, handleCreate, moveSelection, orderedIds, providers, selectedProvider, setOpen],
  );

  const registerItemRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) itemRefs.current.set(id, node);
      else itemRefs.current.delete(id);
    },
    [],
  );

  const registerProviderRef = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node) providerButtonRefs.current.set(id, node);
      else providerButtonRefs.current.delete(id);
    },
    [],
  );

  const handleProviderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      event.stopPropagation();
      focusProviderByDelta(event.key === "ArrowRight" ? 1 : -1);
    },
    [focusProviderByDelta],
  );

  const hasWorkspaces = sortedRepos.length > 0;
  const otherHeading =
    pinnedMatches.length > 0 ? "Workspaces" : search.trim() ? "Matches" : "Recent";

  return (
    <CommandDialog
      open
      onOpenChange={setOpen}
      title="New Session"
      description="Choose a workspace and provider to start a new session"
      className="new-session-shell"
    >
      <div className="new-session-frame" onKeyDownCapture={handleKeyDownCapture}>
        <div className="new-session-header" aria-hidden="true">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">New Session</div>
            <div className="mt-0.5 text-xs text-secondary-info">
              Choose a workspace and provider.
            </div>
          </div>
        </div>

        <div className="command-palette-header">
          <CommandInput
            ref={inputRef}
            aria-label="Search workspaces"
            aria-activedescendant={
              selectedRepoId ? getWorkspaceOptionId(selectedRepoId) : undefined
            }
            placeholder="Search workspaces"
            value={search}
            onValueChange={setSearch}
          />
        </div>

        <div className="command-palette-body">
          <div className="command-palette-panel">
            <CommandList ref={listRef} aria-label="Workspaces" className="min-h-0 flex-1">
              {!hasWorkspaces ? (
                <CommandEmpty
                  role="status"
                  className="flex h-full items-center justify-center px-4 py-10"
                >
                  <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                    <FolderPlus className="size-6 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">No workspaces yet</span>
                    <span className="text-xs text-muted-foreground">
                      Pick a folder to get started.
                    </span>
                    <Button
                      type="button"
                      data-new-session-footer-control
                      size="sm"
                      disabled={addingWorkspace}
                      onClick={() => void handleAddWorkspace()}
                    >
                      <Plus className="size-3.5" />
                      Add Workspace
                    </Button>
                  </div>
                </CommandEmpty>
              ) : filteredRepos.length === 0 ? (
                <CommandEmpty
                  role="status"
                  className="flex h-full items-center justify-center px-4 py-10"
                >
                  <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                    <span className="text-sm font-medium text-foreground">
                      No matching workspaces
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Try a different search, or add a new workspace.
                    </span>
                    <Button
                      type="button"
                      data-new-session-footer-control
                      size="sm"
                      variant="outline"
                      disabled={addingWorkspace}
                      onClick={() => void handleAddWorkspace()}
                    >
                      <Plus className="size-3.5" />
                      Add Workspace
                    </Button>
                  </div>
                </CommandEmpty>
              ) : (
                <>
                  {pinnedMatches.length > 0 && (
                    <CommandGroup heading="Pinned">
                      {pinnedMatches.map((repo) => (
                        <WorkspaceRow
                          key={repo.id}
                          repo={repo}
                          selected={selectedRepoId === repo.id}
                          onHover={() => setSelectedRepoId(repo.id)}
                          onSelect={handleCreate}
                          registerRef={registerItemRef}
                        />
                      ))}
                    </CommandGroup>
                  )}

                  {pinnedMatches.length > 0 && otherMatches.length > 0 && <CommandSeparator />}

                  {otherMatches.length > 0 && (
                    <CommandGroup heading={otherHeading}>
                      {otherMatches.map((repo) => (
                        <WorkspaceRow
                          key={repo.id}
                          repo={repo}
                          selected={selectedRepoId === repo.id}
                          onHover={() => setSelectedRepoId(repo.id)}
                          onSelect={handleCreate}
                          registerRef={registerItemRef}
                        />
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
            {hasWorkspaces && filteredRepos.length > 0 && (
              <button
                type="button"
                data-new-session-footer-control
                disabled={addingWorkspace}
                onClick={() => void handleAddWorkspace()}
                className="flex w-full items-center gap-2 border-t border-border/40 px-3 py-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:bg-interactive-hover focus-visible:text-foreground disabled:opacity-60"
              >
                <Plus className="size-3.5 shrink-0" />
                <span>{addingWorkspace ? "Adding workspace…" : "Add Workspace…"}</span>
              </button>
            )}
          </div>
        </div>

        <div className="new-session-footer">
          {providers.length > 1 ? (
            <div className="flex items-center gap-0.5">
              {providers.map((provider) => {
                const isActive = provider.id === selectedProvider;
                return (
                  <button
                    ref={registerProviderRef(provider.id)}
                    key={provider.id}
                    type="button"
                    data-new-session-footer-control
                    aria-pressed={isActive}
                    disabled={creating}
                    onClick={() => setSelectedProvider(provider.id)}
                    onKeyDown={handleProviderKeyDown}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium control-transition-native outline-none focus-ring-default",
                      isActive
                        ? "border-interactive-selected-border bg-interactive-selected text-interactive-selected-foreground"
                        : "border-transparent text-muted-foreground hover:bg-interactive-hover hover:text-foreground",
                    )}
                  >
                    <ProviderIcon
                      provider={provider.id}
                      aria-hidden={true}
                      className="size-3.5 shrink-0"
                    />
                    <span>{provider.displayName}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-secondary-info">
              <ProviderIcon
                provider={selectedProvider}
                aria-hidden={true}
                className="size-3.5 shrink-0"
              />
              <span>{providers[0]?.displayName ?? selectedProvider}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              data-new-session-footer-control
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-new-session-footer-control
              size="sm"
              disabled={!selectedRepoId || creating}
              onClick={() => void handleCreate()}
              className="min-w-20 justify-center"
            >
              {creating && <LoaderCircle className="size-3.5 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </div>
    </CommandDialog>
  );
}

function WorkspaceRow({
  repo,
  selected,
  onHover,
  onSelect,
  registerRef,
}: {
  repo: Repository;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  registerRef: (id: string) => (node: HTMLDivElement | null) => void;
}) {
  return (
    <CommandItem
      id={getWorkspaceOptionId(repo.id)}
      ref={registerRef(repo.id)}
      selected={selected}
      onSelect={onSelect}
      onMouseMove={onHover}
      className="items-center gap-3"
    >
      <div
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-selected/command-item:text-interactive-selected-foreground"
        style={repo.color ? { color: repo.color } : undefined}
      >
        <Folder className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{repo.name}</div>
        <p className="mt-0.5 truncate text-secondary-info">{shortenPath(repo.path)}</p>
      </div>
    </CommandItem>
  );
}
