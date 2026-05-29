import { Bot, FolderPlus, OctagonX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAppShellToolbar } from "@/components/app-shell-toolbar";
import { KanbanColumn } from "@/components/dashboard/kanban-column";
import { SessionCard } from "@/components/dashboard/session-card";
import { Button } from "@/components/ui/button";
import { useRepo } from "@/hooks/use-repo";
import { useSession } from "@/hooks/use-session";
import { useWindowTitle } from "@/hooks/use-window-title";
import { computeKanbanColumns } from "@/lib/session-helpers";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";

export default function Dashboard() {
  useWindowTitle("AgTower — Dashboard");
  const navigate = useNavigate();
  const repos = useRepoStore((s) => s.repos);
  const repoList = useMemo(() => Object.values(repos), [repos]);
  const hasRepos = repoList.length > 0;
  const { addRepository } = useRepo();
  const sessions = useSessionStore((s) => s.sessions);
  const clearUnseen = useSessionStore((s) => s.clearUnseen);
  const { stopSession, restartSession, stopAllSessions } = useSession();

  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);

  useEffect(() => {
    clearUnseen();
  }, [clearUnseen]);

  const activeProvider = useSettingsStore((s) => s.sidebarProviderFilter);

  const columns = useMemo(
    () => computeKanbanColumns(sessions, workspaceFilter, activeProvider || null),
    [sessions, workspaceFilter, activeProvider],
  );

  const allSessions = useMemo(() => Object.values(sessions), [sessions]);
  const runningCount = columns.find((column) => column.key === "running")?.sessions.length ?? 0;
  const attentionCount = columns.find((column) => column.key === "attention")?.sessions.length ?? 0;
  const shellToolbarDescriptor = useMemo(() => {
    if (!hasRepos) {
      return {
        detail: "Add your first workspace",
        kind: "title" as const,
        title: "Dashboard",
      };
    }

    if (allSessions.length === 0) {
      return {
        detail: "Ready to start your first session",
        kind: "title" as const,
        title: "Dashboard",
      };
    }

    return {
      attentionCount,
      kind: "dashboard" as const,
      onStopAll: runningCount > 0 ? stopAllSessions : undefined,
      onWorkspaceFilterChange: setWorkspaceFilter,
      runningCount,
      title: "Dashboard",
      workspaceFilter,
      workspaces: repoList.map(({ id, name }) => ({ id, name })),
    };
  }, [
    allSessions.length,
    attentionCount,
    hasRepos,
    repoList,
    runningCount,
    stopAllSessions,
    workspaceFilter,
  ]);
  useAppShellToolbar(shellToolbarDescriptor);

  if (!hasRepos) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm">
          <FolderPlus className="size-7 text-muted-foreground/70" />
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">Add a workspace</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Select a folder to scope your agent sessions.
            </p>
          </div>
          <Button size="sm" onClick={() => addRepository()}>
            <FolderPlus className="size-3.5" />
            Add Workspace
          </Button>
        </div>
      </div>
    );
  }

  if (allSessions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-sm">
          <Bot className="size-7 text-muted-foreground/70" />
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">No sessions yet</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Start a session to prompt an agent in one of your workspaces.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate("/session/new")}>
            <Bot className="size-3.5" />
            New Session
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            columnKey={col.key}
            label={col.label}
            count={col.sessions.length}
            action={
              col.key === "running" && col.sessions.length > 0
                ? {
                    label: "Stop All",
                    icon: OctagonX,
                    onClick: stopAllSessions,
                    variant: "destructive",
                  }
                : undefined
            }
          >
            {col.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                columnKey={col.key}
                onStop={stopSession}
                onRestart={restartSession}
              />
            ))}
          </KanbanColumn>
        ))}
      </div>
    </div>
  );
}
