import type { NavigateFunction } from "react-router";
import type { StartSessionOptions, StartTerminalSessionOptions } from "@/hooks/use-session";
import type { ProviderModule } from "@/providers/types";
import type { Repository } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import type { SettingsState } from "@/stores/settings-store";

export type PaletteItemKind =
  | "command"
  | "setting"
  | "session"
  | "workspace"
  | "provider"
  | "danger";

type PaletteDangerLevel = "none" | "guarded";

export interface PaletteQuery {
  raw: string;
  text: string;
  normalizedText: string;
  tokens: string[];
  filters: {
    types: PaletteItemKind[];
    repos: string[];
    statuses: string[];
    providers: string[];
    pinned: boolean | null;
  };
}

export interface RecentPaletteEntry {
  id: string;
  kind: PaletteItemKind;
  lastUsedAt: number;
  useCount: number;
}

export interface PalettePreviewSection {
  label: string;
  value: string;
}

export interface PalettePreviewData {
  title: string;
  summary?: string;
  sections?: PalettePreviewSection[];
}

export interface PaletteMatch {
  item: PaletteItem;
  score: number;
  matchedAlias?: string;
}

export interface PaletteContext {
  navigate: NavigateFunction;
  activeSessionId: string | null;
  activeSession: Session | null;
  activeRepoId: string | null;
  activeRepo: Repository | null;
  isOnSession: boolean;
  sessions: Record<string, Session>;
  repos: Record<string, Repository>;
  providers: ProviderModule[];
  settings: PaletteSettingsSnapshot;
  /** Most-recently-visited session ids, freshest first. Drives the home-view
   *  MRU ordering of open sessions and a tiebreaker bonus in search ranking. */
  viewedSessionIds: readonly string[];
  addRepository: () => Promise<Repository | null>;
  startSession: (options?: StartSessionOptions) => Promise<string>;
  startTerminalSession: (options?: StartTerminalSessionOptions) => Promise<string>;
  stopSession: (sessionId: string) => Promise<void>;
  stopAllSessions: () => Promise<void>;
  stopSessionsInRepo: (repoId: string) => Promise<void>;
  restartSession: (sessionId: string) => Promise<void>;
  clearSessionCache: () => Promise<void>;
  resetEverything: () => Promise<void>;
}

type PaletteSettingsSnapshot = Pick<
  SettingsState,
  | "archiveAfterDays"
  | "defaultProvider"
  | "notifications"
  | "providerSettings"
  | "sidebarProviderFilter"
  | "startupBehavior"
  | "theme"
>;

export interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  title: string;
  subtitle?: string;
  aliases?: string[];
  keywords?: string[];
  iconName?: string;
  status?: string;
  /** Optional second-line text for session rows — provider activity (current
   *  tool, "Editing X.rs", "Waiting for input", etc.) or "Idle" fallback. */
  activity?: string;
  /** True for the user's currently-active session — the row renders dimmed
   *  with a "Current" marker so it reads as a "you are here" anchor while
   *  initial auto-selection lands on the previous session instead. */
  isCurrent?: boolean;
  group: string;
  homeSection?: "Open Sessions" | "Continue" | "Create" | "Quick Settings" | "Workspaces";
  homeOrder?: number;
  queryOrder?: number;
  currentValue?: string;
  shortcutActionId?: string;
  dangerLevel?: PaletteDangerLevel;
  exactMatchQuery?: string;
  preview?: PalettePreviewData;
  meta?: {
    repoId?: string;
    providerId?: string;
    sessionId?: string;
    pinned?: boolean;
    status?: string;
  };
  when?: (ctx: PaletteContext) => boolean;
  perform: (ctx: PaletteContext) => void | Promise<void>;
}

export function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
