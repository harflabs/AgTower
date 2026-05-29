import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toastError } from "@/lib/errors";
import { useRepoStore } from "@/stores/repo-store";
import type { ProviderType, SessionStatus } from "@/types/session";

/** Persistent session data — saved to SQLite */
interface SessionRecord {
  id: string;
  repoId: string;
  repoPath: string;
  repoName: string;
  prompt: string;
  title: string;
  status: SessionStatus;
  pid: number | null;
  providerData: Record<string, unknown>;
  model: string | null;
  createdAt: number;
  endedAt: number | null;
  result: string | null;
  durationMs: number | null;
  numTurns: number | null;
  exitCode: number | null;
  error: string | null;
  baseCommitSha: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCacheReadTokens: number | null;
  totalCacheWriteTokens: number | null;
  gitBranch: string | null;
  stopReason: string | null;
  provider: ProviderType;
}

/** Transient live data — memory-only, never persisted to DB */
interface SessionLiveState {
  ptyActive: boolean;
  liveProviderData: Record<string, unknown>;
}

/** Keys that are transient and should never trigger a DB save */
const TRANSIENT_KEYS: ReadonlySet<string> = new Set<keyof SessionLiveState>([
  "ptyActive",
  "liveProviderData",
]);

/** Combined session type used throughout the app */
export type Session = SessionRecord & SessionLiveState;

/** Default values for transient state (used when loading from DB) */
export const DEFAULT_LIVE_STATE: SessionLiveState = {
  ptyActive: false,
  liveProviderData: {},
};

interface SessionState {
  sessions: Record<string, Session>;
  /** True after initial hydration from engine. Guards _addFromEngine/_updateFromEngine. */
  _hydrated: boolean;
  activeSessionId: string | null;
  setActiveSession: (id: string | null) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  unseenCount: number;
  incrementUnseen: () => void;
  clearUnseen: () => void;
  hydrate: (sessions: Record<string, Session>) => void;
  archiveSession: (sessionId: string) => void;
  // Engine sync — called by engine-sync.ts, do NOT call Rust back
  _updateFromEngine: (id: string, session: Partial<Session>) => void;
  _addFromEngine: (session: Session) => void;
  _removeFromEngine: (id: string) => void;
}

export const useSessionStore = create<SessionState>()(
  devtools(
    (set) => ({
      sessions: {},
      _hydrated: false,
      activeSessionId: null,
      unseenCount: 0,
      incrementUnseen: () => set((s) => ({ unseenCount: s.unseenCount + 1 })),
      clearUnseen: () => set({ unseenCount: 0 }),
      setActiveSession: (id) => set({ activeSessionId: id }),
      addSession: (session) =>
        set((s) => ({
          sessions: { ...s.sessions, [session.id]: session },
        })),
      updateSession: (id, updates) => {
        // Check if any persistent (non-transient) fields are being updated
        const hasPersistentChanges = Object.keys(updates).some((k) => !TRANSIENT_KEYS.has(k));
        set((s) => {
          const existing = s.sessions[id];
          if (!existing) return s;
          const updated = { ...existing, ...updates };
          // Persist via Rust engine when persistent fields change
          if (hasPersistentChanges) {
            invoke("update_session", { id, updates }).catch(toastError("update session"));
          }
          return {
            sessions: { ...s.sessions, [id]: updated },
          };
        });
      },
      removeSession: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.sessions;
          invoke("remove_session", { id }).catch(toastError("remove session"));
          return {
            sessions: rest,
            activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
          };
        }),
      renameSession: (id, title) =>
        set((s) => {
          const existing = s.sessions[id];
          if (!existing) return s;
          const updated = { ...existing, title };
          invoke("rename_session", { id, title }).catch(toastError("rename session"));
          return {
            sessions: { ...s.sessions, [id]: updated },
          };
        }),
      hydrate: (sessions) =>
        set(() => ({
          sessions,
          _hydrated: true,
        })),
      archiveSession: (id) =>
        set((s) => {
          const existing = s.sessions[id];
          if (!existing) return s;
          const updated = {
            ...existing,
            status: "archived" as SessionStatus,
            endedAt: existing.endedAt ?? Date.now(),
          };
          invoke("archive_session", { id }).catch(toastError("archive session"));
          return {
            sessions: { ...s.sessions, [id]: updated },
          };
        }),
      // ── Engine sync (authoritative updates from Rust — no DB callback) ──
      _updateFromEngine: (id, session) =>
        set((s) => {
          if (!s._hydrated) return s; // Guard: wait for initial hydration
          const existing = s.sessions[id];
          if (!existing) return s;
          return {
            sessions: { ...s.sessions, [id]: { ...existing, ...session } },
          };
        }),
      _addFromEngine: (session) =>
        set((s) => {
          if (!s._hydrated) return s; // Guard: wait for initial hydration
          if (s.sessions[session.id]) return s;
          // Block skeleton sessions that lack any provider identity — a
          // session without a provider-specific ID can't be resumed or
          // matched against future discovery scans, so persisting it would
          // create an unreachable row.
          const providerData = session.providerData as Record<string, unknown>;
          const hasProviderIdentity =
            typeof providerData.sessionId === "string" ||
            typeof providerData.threadId === "string" ||
            typeof providerData.filePath === "string" ||
            typeof providerData.rolloutPath === "string";
          if (!hasProviderIdentity) return s;
          // Remap repoId if a repo with the same path exists under a different ID
          const repos = useRepoStore.getState().repos;
          const existingRepo = Object.values(repos).find(
            (r) => r.path === session.repoPath && r.id !== session.repoId,
          );
          const finalSession = existingRepo ? { ...session, repoId: existingRepo.id } : session;
          return {
            sessions: { ...s.sessions, [finalSession.id]: finalSession },
          };
        }),
      _removeFromEngine: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.sessions;
          return {
            sessions: rest,
            activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
          };
        }),
    }),
    { name: "session-store" },
  ),
);
