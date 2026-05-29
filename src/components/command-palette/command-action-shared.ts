import { resolveAdjacentOpenSessionTarget } from "@/lib/session-navigation";
import { getProvider } from "@/providers/registry";
import type { Repository } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import type { SessionStatus } from "@/types/session";
import type { PaletteContext, PalettePreviewData } from "./model";

// `ctx.providers` is now the *available* subset, so historical sessions
// whose provider is no longer reachable wouldn't resolve to a real
// display name without a fallback. Try ctx first (it's what tests stub
// directly), then fall through to the registry — that covers both
// available-only contexts and the lookup-by-historical-id case.
export function providerName(providerId: string, ctx: PaletteContext): string {
  return (
    ctx.providers.find((provider) => provider.id === providerId)?.displayName ??
    getProvider(providerId)?.displayName ??
    providerId
  );
}

export function providerSessionName(providerId: string, ctx: PaletteContext): string {
  const provider =
    ctx.providers.find((candidate) => candidate.id === providerId) ?? getProvider(providerId);
  return provider?.assistantDisplayName ?? provider?.displayName ?? providerId;
}

export function findProvider(ctx: PaletteContext, providerId: string) {
  return (
    ctx.providers.find((provider) => provider.id === providerId) ?? getProvider(providerId) ?? null
  );
}

function formatStatus(status: string): string {
  switch (status) {
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
      return status;
  }
}

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat().format(value);
}

export function buildSessionPreview(
  ctx: PaletteContext,
  sessionId: string,
): PalettePreviewData | undefined {
  const session = ctx.sessions[sessionId];
  if (!session) return undefined;
  const repo = ctx.repos[session.repoId];
  const filesEdited =
    session.liveProviderData &&
    typeof session.liveProviderData === "object" &&
    Array.isArray((session.liveProviderData as { filesEdited?: string[] }).filesEdited)
      ? ((session.liveProviderData as { filesEdited?: string[] }).filesEdited ?? []).slice(0, 3)
      : [];

  return {
    title: session.title || "Untitled Session",
    summary: session.prompt || "Open this session and continue working.",
    sections: [
      { label: "Workspace", value: repo?.name ?? session.repoName },
      { label: "Provider", value: providerName(session.provider, ctx) },
      { label: "Status", value: formatStatus(session.status) },
      { label: "Branch", value: session.gitBranch ?? "—" },
      { label: "Model", value: session.model ?? "—" },
      { label: "Turns", value: formatNumber(session.numTurns) },
      { label: "Input Tokens", value: formatNumber(session.totalInputTokens) },
      { label: "Output Tokens", value: formatNumber(session.totalOutputTokens) },
      { label: "Created", value: formatDate(session.createdAt) },
      ...(filesEdited.length > 0 ? [{ label: "Recent Files", value: filesEdited.join(", ") }] : []),
    ],
  };
}

export function buildWorkspacePreview(
  ctx: PaletteContext,
  repoId: string,
): PalettePreviewData | undefined {
  const repo = ctx.repos[repoId];
  if (!repo) return undefined;
  const sessions = Object.values(ctx.sessions).filter((session) => session.repoId === repo.id);
  const runningCount = sessions.filter((session) => session.status === "running").length;
  const attentionCount = sessions.filter((session) => session.status === "needsAttention").length;

  return {
    title: repo.name,
    summary: repo.path,
    sections: [
      { label: "Path", value: repo.path },
      { label: "Pinned", value: repo.pinned ? "Yes" : "No" },
      { label: "Running", value: String(runningCount) },
      { label: "Needs Attention", value: String(attentionCount) },
      { label: "Sessions", value: String(sessions.length) },
    ],
  };
}

export function buildSettingPreview(summary: string, currentValue?: string): PalettePreviewData {
  return {
    title: "Quick Setting",
    summary,
    sections: currentValue ? [{ label: "Current", value: currentValue }] : [],
  };
}

export function buildActionPreview(
  title: string,
  summary: string,
  sections: Array<{ label: string; value: string }>,
): PalettePreviewData {
  return {
    title,
    summary,
    sections,
  };
}

function quoteShellArg(value: string): string {
  if (!value) return "''";
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(program: string, args: string[]): string {
  return [program, ...args].map(quoteShellArg).join(" ");
}

export function buildResumeShellCommand(ctx: PaletteContext, session: Session): string | null {
  const provider = findProvider(ctx, session.provider);
  if (!provider) return null;

  const launchSpec = provider.launcher.buildPtyLaunch(session, "resume");
  if (launchSpec.kind !== "process") return null;

  return formatShellCommand(launchSpec.program, launchSpec.args);
}

interface SessionMatcher {
  providerId?: string;
  repoId?: string;
  statuses?: SessionStatus[];
}

export function getMatchingSessions(ctx: PaletteContext, matcher: SessionMatcher): Session[] {
  return Object.values(ctx.sessions)
    .filter((session) => {
      if (matcher.repoId && session.repoId !== matcher.repoId) return false;
      if (matcher.providerId && session.provider !== matcher.providerId) return false;
      if (matcher.statuses && !matcher.statuses.includes(session.status)) return false;
      return true;
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getLatestMatchingSession(
  ctx: PaletteContext,
  matcher: SessionMatcher,
): Session | null {
  return getMatchingSessions(ctx, matcher)[0] ?? null;
}

export function buildScopedPhraseAliases(phrase: string, repoName: string): string[] {
  return [`${phrase} @ ${repoName}`, `${phrase}@${repoName}`];
}

export function buildScopedLaunchPreview(
  title: string,
  summary: string,
  repoName: string,
  repoPath: string,
  providerLabel: string,
): PalettePreviewData {
  return {
    title,
    summary,
    sections: [
      { label: "Workspace", value: repoName },
      { label: "Provider", value: providerLabel },
      { label: "Path", value: repoPath },
    ],
  };
}

export function buildOpenSessionCyclePreview(
  ctx: PaletteContext,
  direction: "next" | "prev",
): PalettePreviewData | undefined {
  const target = resolveAdjacentOpenSessionTarget(ctx.sessions, ctx.activeSessionId, direction);
  if (target?.kind !== "session") return undefined;

  const session = ctx.sessions[target.sessionId];
  const repo = session ? ctx.repos[session.repoId] : null;
  if (!session) return undefined;

  return {
    title: direction === "next" ? "Next Open Session" : "Previous Open Session",
    summary: `Switch to ${session.title || "Untitled Session"}.`,
    sections: [
      { label: "Target", value: session.title || "Untitled Session" },
      { label: "Workspace", value: repo?.name ?? session.repoName },
      { label: "Provider", value: providerName(session.provider, ctx) },
      { label: "Status", value: formatStatus(session.status) },
    ],
  };
}

export function sortRepositoriesForPalette(repos: Record<string, Repository>): Repository[] {
  return Object.values(repos).sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return Number(right.pinned) - Number(left.pinned);
    }
    return right.lastOpenedAt - left.lastOpenedAt;
  });
}

export const OPEN_SESSION_STATUSES: SessionStatus[] = ["running", "idle", "needsAttention"];
export const CLOSED_SESSION_STATUSES: SessionStatus[] = ["closed", "archived"];

export const STATUS_COMMANDS: Array<{
  aliases: string[];
  label: string;
  statuses: SessionStatus[];
}> = [
  {
    aliases: ["attention", "needs attention"],
    label: "Attention",
    statuses: ["needsAttention"],
  },
  {
    aliases: ["running"],
    label: "Running",
    statuses: ["running"],
  },
  {
    aliases: ["idle"],
    label: "Idle",
    statuses: ["idle"],
  },
];
