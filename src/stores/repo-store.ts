import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  addRepo as engineAddRepo,
  removeRepo as engineRemoveRepo,
  reorderRepos as engineReorderRepos,
  updateRepo as engineUpdateRepo,
} from "@/lib/engine";
import { toastError } from "@/lib/errors";

const SPACE_COLORS = [
  "oklch(0.65 0.18 250)", // blue
  "oklch(0.65 0.18 330)", // pink
  "oklch(0.65 0.18 145)", // green
  "oklch(0.65 0.18 50)", // orange
  "oklch(0.65 0.18 290)", // purple
  "oklch(0.65 0.18 180)", // teal
  "oklch(0.65 0.18 25)", // red
  "oklch(0.65 0.18 90)", // yellow
  "oklch(0.65 0.18 210)", // cyan
  "oklch(0.65 0.18 350)", // magenta
];

export interface Repository {
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  addedAt: number;
  lastOpenedAt: number;
  pinned: boolean;
  color: string;
  sortOrder: number | null;
}

interface RepoState {
  repos: Record<string, Repository>;
  activeRepoId: string | null;
  addRepo: (repo: Repository) => void;
  removeRepo: (id: string) => void;
  setActiveRepo: (id: string | null) => void;
  updateRepo: (id: string, updates: Partial<Repository>) => void;
  togglePin: (id: string) => void;
  reorderRepos: (orderedIds: string[]) => void;
  hydrate: (repos: Record<string, Repository>) => void;
  // Engine sync — called by engine-sync.ts, do NOT call Rust back
  _updateFromEngine: (repo: Repository) => void;
  _addFromEngine: (repo: Repository) => void;
  _removeFromEngine: (id: string) => void;
}

export const useRepoStore = create<RepoState>()(
  devtools(
    persist(
      (set, get) => ({
        repos: {},
        activeRepoId: null,

        addRepo: (repo) => {
          const existing = Object.values(get().repos).find((r) => r.path === repo.path);
          if (existing) {
            set({ activeRepoId: existing.id });
            return;
          }
          const repoCount = Object.keys(get().repos).length;
          const enriched = {
            ...repo,
            color: repo.color || SPACE_COLORS[repoCount % SPACE_COLORS.length],
          };
          set((s) => ({
            repos: { ...s.repos, [enriched.id]: enriched },
            activeRepoId: enriched.id,
          }));
          engineAddRepo(enriched).catch(toastError("add workspace"));
        },

        removeRepo: (id) =>
          set((s) => {
            const { [id]: _, ...rest } = s.repos;
            engineRemoveRepo(id).catch(toastError("remove workspace"));
            return {
              repos: rest,
              activeRepoId: s.activeRepoId === id ? null : s.activeRepoId,
            };
          }),

        setActiveRepo: (id) => set({ activeRepoId: id }),

        updateRepo: (id, updates) =>
          set((s) => {
            const next = {
              repos: {
                ...s.repos,
                [id]: { ...s.repos[id], ...updates },
              },
            };
            engineUpdateRepo(id, updates).catch(toastError("update workspace"));
            return next;
          }),

        togglePin: (id) =>
          set((s) => {
            const repo = s.repos[id];
            if (!repo) return s;
            engineUpdateRepo(id, { pinned: !repo.pinned }).catch(
              toastError("toggle workspace pin"),
            );
            return {
              repos: {
                ...s.repos,
                [id]: { ...repo, pinned: !repo.pinned },
              },
            };
          }),

        reorderRepos: (orderedIds) =>
          set((s) => {
            const repos = { ...s.repos };
            orderedIds.forEach((id, index) => {
              if (repos[id]) {
                repos[id] = { ...repos[id], sortOrder: index };
              }
            });
            engineReorderRepos(orderedIds).catch(toastError("reorder workspaces"));
            return { repos };
          }),

        hydrate: (repos) => set({ repos }),

        // Engine sync (authoritative updates from Rust — no callback to Rust)
        _updateFromEngine: (repo) =>
          set((s) => ({
            repos: { ...s.repos, [repo.id]: repo },
          })),
        _addFromEngine: (repo) =>
          set((s) => {
            // Deduplicate by path — if a repo with the same path exists under a different ID,
            // merge sessions to the existing one instead of creating a duplicate entry
            const existing = Object.values(s.repos).find(
              (r) => r.path === repo.path && r.id !== repo.id,
            );
            if (existing) {
              // Keep the existing entry, just update it if the new one is newer
              return {
                repos: {
                  ...s.repos,
                  [existing.id]: {
                    ...existing,
                    lastOpenedAt: Math.max(existing.lastOpenedAt, repo.lastOpenedAt),
                  },
                },
              };
            }
            return { repos: { ...s.repos, [repo.id]: repo } };
          }),
        _removeFromEngine: (id) =>
          set((s) => {
            const { [id]: _, ...rest } = s.repos;
            return {
              repos: rest,
              activeRepoId: s.activeRepoId === id ? null : s.activeRepoId,
            };
          }),
      }),
      { name: "agtower-repos" },
    ),
    { name: "repo-store" },
  ),
);
