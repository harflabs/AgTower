import { useRepoStore } from "@/stores/repo-store";
import type { SessionStatus } from "@/types/session";
import {
  buildSessionPreview,
  buildWorkspacePreview,
  findProvider,
  OPEN_SESSION_STATUSES,
  providerName,
  sortRepositoriesForPalette,
} from "./command-action-shared";
import type { PaletteContext, PaletteItem } from "./model";

const IDLE_ACTIVITY_FALLBACK = "Idle";
const OPEN_STATUS_SET = new Set<SessionStatus>(OPEN_SESSION_STATUSES);

export function createSessionItems(ctx: PaletteContext): PaletteItem[] {
  // MRU rank for visited sessions; never-visited get Infinity so they fall to
  // the end and sub-sort by createdAt. The resulting order drives both the
  // home-view "Open Sessions" section ordering (via homeOrder = position)
  // and is a stable input to the ranking MRU tiebreaker.
  const mruRank = new Map<string, number>();
  ctx.viewedSessionIds.forEach((id, idx) => {
    mruRank.set(id, idx);
  });

  const sortedSessions = Object.values(ctx.sessions).sort((left, right) => {
    const leftRank = mruRank.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightRank = mruRank.get(right.id) ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return right.createdAt - left.createdAt;
  });

  return sortedSessions.map((session, index) => {
    const repo = ctx.repos[session.repoId];
    const providerDisplay = providerName(session.provider, ctx);
    const isOpen = OPEN_STATUS_SET.has(session.status);
    const subtitle = [repo?.name ?? session.repoName, providerDisplay].filter(Boolean).join(" · ");

    // Closed/archived sessions show no activity row — their PTY data is stale
    // and the dimmed row + status dot already communicate state.
    const rawActivity = findProvider(ctx, session.provider)?.getActivityText?.(session)?.trim();
    const activity = isOpen ? rawActivity || IDLE_ACTIVITY_FALLBACK : undefined;

    return {
      id: `session:${session.id}`,
      kind: "session",
      title: session.title || "Untitled Session",
      subtitle,
      activity,
      isCurrent: session.id === ctx.activeSessionId,
      aliases: [session.prompt, repo?.path ?? "", providerDisplay],
      keywords: [
        session.title,
        session.prompt,
        repo?.name ?? "",
        repo?.path ?? "",
        providerDisplay,
        session.status,
        session.gitBranch ?? "",
        session.model ?? "",
        activity,
      ].filter((value): value is string => Boolean(value)),
      iconName: "TerminalSquare",
      status: session.status,
      group: "Sessions",
      homeSection: isOpen ? "Open Sessions" : undefined,
      homeOrder: isOpen ? index : undefined,
      queryOrder: session.status === "needsAttention" ? 76 : isOpen ? 54 : 30,
      preview: buildSessionPreview(ctx, session.id),
      meta: {
        sessionId: session.id,
        repoId: session.repoId,
        providerId: session.provider,
        status: session.status.toLowerCase(),
      },
      perform: (runtime) => runtime.navigate(`/session/${session.id}`),
    };
  });
}

export function createWorkspaceItems(ctx: PaletteContext): PaletteItem[] {
  return sortRepositoriesForPalette(ctx.repos).map((repo) => ({
    id: `workspace:${repo.id}`,
    kind: "workspace",
    title: repo.name,
    subtitle: repo.path,
    aliases: [
      repo.path,
      "repo",
      "workspace",
      `open workspace ${repo.name}`,
      `switch workspace ${repo.name}`,
    ],
    keywords: [repo.name, repo.path, "workspace", "repo"],
    iconName: "Folder",
    group: "Workspaces",
    homeSection: "Workspaces",
    homeOrder: repo.pinned ? 1 : 10,
    queryOrder: repo.pinned ? 72 : 52,
    preview: buildWorkspacePreview(ctx, repo.id),
    meta: {
      repoId: repo.id,
      pinned: repo.pinned,
    },
    perform: (runtime) => {
      useRepoStore.getState().setActiveRepo(repo.id);
      runtime.navigate("/");
    },
  }));
}

export function createDangerItems(): PaletteItem[] {
  return [
    {
      id: "danger:clear-session-cache",
      kind: "danger",
      title: "Clear Session Cache",
      subtitle: "Delete cached session data from the app",
      aliases: ["clear cache", "wipe session cache"],
      keywords: ["clear", "session", "cache", "wipe"],
      iconName: "DatabaseZap",
      group: "Dangerous",
      queryOrder: 4,
      dangerLevel: "guarded",
      exactMatchQuery: "clear session cache",
      preview: {
        title: "Clear Session Cache",
        summary:
          "Delete session data from the app database. Sessions are re-imported from agent files after restart.",
      },
      perform: async (runtime) => {
        await runtime.clearSessionCache();
      },
    },
    {
      id: "danger:reset-everything",
      kind: "danger",
      title: "Reset Everything",
      subtitle: "Delete app database, workspaces, and settings",
      aliases: ["reset app", "wipe everything"],
      keywords: ["reset", "everything", "wipe", "database"],
      iconName: "AlertTriangle",
      group: "Dangerous",
      queryOrder: 2,
      dangerLevel: "guarded",
      exactMatchQuery: "reset everything",
      preview: {
        title: "Reset Everything",
        summary:
          "Delete the entire app database, workspaces, and settings. Agent conversation files are not affected.",
      },
      perform: async (runtime) => {
        await runtime.resetEverything();
      },
    },
  ];
}
