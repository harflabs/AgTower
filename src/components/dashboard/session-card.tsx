import { AlertTriangle, Archive, Bot, GitBranch, GitPullRequest, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { MiniTerminal } from "@/components/dashboard/mini-terminal";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { StopIcon } from "@/components/icons/stop-icon";
import { IconButton } from "@/components/ui/icon-button";
import { createContextMenuHandler, type NativeMenuItemSpec } from "@/lib/native-menu";
import type { KanbanColumnKey } from "@/lib/session-helpers";
import { formatDuration, formatModelName } from "@/lib/session-helpers";
import { cn } from "@/lib/utils";
import { useRepoStore } from "@/stores/repo-store";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

interface SessionCardProps {
  session: Session;
  columnKey: KanbanColumnKey;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
}

interface ActionConfig {
  icon: typeof StopIcon;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}

export function SessionCard({ session, columnKey, onStop, onRestart }: SessionCardProps) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const repoColor = useRepoStore((s) => s.repos[session.repoId]?.color);

  const isRunning =
    session.status === "running" ||
    session.status === "needsAttention" ||
    session.status === "idle";

  useEffect(() => {
    if (!isRunning) return;
    setElapsed(Date.now() - session.createdAt);
    const interval = setInterval(() => setElapsed(Date.now() - session.createdAt), 1000);
    return () => clearInterval(interval);
  }, [isRunning, session.createdAt]);

  const duration = isRunning ? elapsed : (session.durationMs ?? 0);

  const handleOpen = async () => {
    useRepoStore.getState().setActiveRepo(session.repoId);
    navigate(`/session/${session.id}`);
  };

  const modelShort = session.model ? formatModelName(session.model) : null;
  const actions = getActions(session, onStop, onRestart);

  const isAttention = columnKey === "attention";
  const isIdle = columnKey === "idle";
  const isErrored = isAttention && session.exitCode !== null && session.exitCode !== 0;
  const attentionReason = isAttention && isErrored ? session.error || "Session errored" : null;

  const statsSummary = [
    session.numTurns != null && session.numTurns > 0 ? `${session.numTurns} turns` : null,
    modelShort,
  ]
    .filter(Boolean)
    .join(" · ");

  const handleCardClick = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      return;
    }

    void handleOpen();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    void handleOpen();
  };

  const handleContextMenu = createContextMenuHandler(() => {
    const specs: NativeMenuItemSpec[] = [
      { kind: "item", text: "Open", action: () => void handleOpen() },
    ];
    if (session.status === "running") {
      specs.push({ kind: "item", text: "Stop", action: () => onStop(session.id) });
    }
    if (!isRunning) {
      specs.push({ kind: "item", text: "Restart", action: () => onRestart(session.id) });
    }
    if (session.status !== "archived") {
      specs.push(
        { kind: "separator" },
        {
          kind: "item",
          text: "Archive",
          action: () => useSessionStore.getState().archiveSession(session.id),
        },
      );
    }
    return specs;
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="group relative selection-chrome outline-none"
      data-selection="chrome"
      role="group"
      tabIndex={0}
      aria-label={`${session.title} session`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onContextMenu={handleContextMenu}
    >
      <div
        className={cn(
          "cursor-pointer rounded-md border border-border/58 bg-card/78 p-2 shadow-[0_1px_0_rgba(0,0,0,0.035)] control-transition-native",
          "hover:border-border/78 hover:bg-card/95 hover:shadow-[0_2px_7px_rgba(0,0,0,0.055)]",
          "group-focus-visible:border-interactive-focus-ring/45 group-focus-visible:bg-card group-focus-visible:ring-1 group-focus-visible:ring-inset group-focus-visible:ring-interactive-focus-ring/28",
          isIdle && "opacity-96",
        )}
      >
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            {columnKey === "running" ? (
              <span className="size-2 shrink-0 rounded-full bg-success animate-pulse-dot" />
            ) : isAttention ? (
              <AlertTriangle
                className={cn("size-3.5 shrink-0", isErrored ? "text-destructive" : "text-warning")}
              />
            ) : (
              <span className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
            )}

            <span className="min-w-0 flex-1 truncate text-primary-info">{session.title}</span>

            <div className="relative flex min-h-5 shrink-0 items-center justify-end">
              {duration > 0 && (
                <span className="text-secondary-info tabular-nums transition-opacity duration-100 group-hover:opacity-0 group-focus-within:opacity-0">
                  {formatDuration(duration)}
                </span>
              )}
              <div className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                {actions.map((a) => (
                  <ActionBtn key={a.title} {...a} />
                ))}
              </div>
            </div>
          </div>

          <div
            className={cn(
              "relative h-32 overflow-hidden rounded-[4px] border border-border/38 bg-inset/70",
              isIdle && "opacity-72",
            )}
          >
            <MiniTerminal sessionId={session.id} />

            {attentionReason && (
              <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5">
                <div
                  className={cn(
                    "line-clamp-2 rounded-[4px] border bg-background/88 px-2 py-1 text-[11px] leading-snug",
                    "border-warning/24 text-warning",
                    isErrored && "border-destructive/25 text-destructive/85",
                  )}
                >
                  {attentionReason}
                </div>
              </div>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 text-secondary-info">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ProviderIcon
                provider={session.provider}
                aria-hidden={true}
                className="size-3.5 shrink-0 text-secondary-info"
              />
              {repoColor && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: repoColor }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{session.repoName}</span>
            </div>
            {statsSummary && (
              <span className="max-w-[7rem] shrink-0 truncate text-tertiary-info">
                {statsSummary}
              </span>
            )}
            <ContextIndicators session={session} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ContextIndicators({ session }: { session: Session }) {
  const agentName = session.providerData?.agentName as string | undefined;
  const prNum = session.providerData?.prNumber as number | undefined;
  const worktreePath = session.providerData?.worktreePath as string | undefined;
  const indicators = [
    agentName ? { key: "agent", icon: Bot, label: agentName, className: "text-primary/70" } : null,
    prNum != null ? { key: "pr", icon: GitPullRequest, label: `PR #${prNum}` } : null,
    worktreePath ? { key: "worktree", icon: GitBranch, label: "Worktree session" } : null,
  ].filter(Boolean) as Array<{ key: string; icon: typeof Bot; label: string; className?: string }>;

  if (indicators.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground/60">
      {indicators.map((ind) => (
        <span
          key={ind.key}
          className={cn("inline-flex items-center", ind.className)}
          role="img"
          aria-label={ind.label}
          title={ind.label}
        >
          <ind.icon className="size-3.5 shrink-0" />
        </span>
      ))}
    </div>
  );
}

function ActionBtn({ icon: Icon, title, onClick, destructive }: ActionConfig) {
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn("size-6", destructive && "text-destructive hover:text-destructive")}
      label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon className="size-3" />
    </IconButton>
  );
}

function getActions(
  session: Session,
  onStop: (id: string) => void,
  onRestart: (id: string) => void,
): ActionConfig[] {
  if (session.status === "running") {
    return [
      { icon: StopIcon, title: "Stop", destructive: true, onClick: () => onStop(session.id) },
      {
        icon: Archive,
        title: "Archive",
        onClick: () => useSessionStore.getState().archiveSession(session.id),
      },
    ];
  }
  if (session.status !== "archived") {
    return [
      { icon: RotateCcw, title: "Restart", onClick: () => onRestart(session.id) },
      {
        icon: Archive,
        title: "Archive",
        onClick: () => useSessionStore.getState().archiveSession(session.id),
      },
    ];
  }
  return [{ icon: RotateCcw, title: "Restart", onClick: () => onRestart(session.id) }];
}
