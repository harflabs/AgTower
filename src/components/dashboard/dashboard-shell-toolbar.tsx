import { Folder, OctagonX } from "lucide-react";
import { AppShellToolbarActionRail } from "@/components/app-shell-toolbar-content";
import { Button } from "@/components/ui/button";
import { type NativeMenuItemSpec, showNativeMenuForElement } from "@/lib/native-menu";
import { cn } from "@/lib/utils";
import type { Repository } from "@/stores/repo-store";

interface DashboardShellToolbarProps {
  attentionCount: number;
  onStopAll?: () => void;
  onWorkspaceFilterChange: (id: string | null) => void;
  runningCount: number;
  title: string;
  workspaceFilter: string | null;
  workspaces: Array<Pick<Repository, "id" | "name">>;
}

export function DashboardShellToolbar({
  attentionCount,
  onStopAll,
  onWorkspaceFilterChange,
  runningCount,
  title,
  workspaceFilter,
  workspaces,
}: DashboardShellToolbarProps) {
  const activeWorkspace = workspaceFilter ? workspaces.find((w) => w.id === workspaceFilter) : null;
  const hasActiveSessions = runningCount > 0 || attentionCount > 0;

  return (
    <div className="selection-chrome relative flex min-w-0 flex-1 items-center pl-0.5 pr-0">
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="window-toolbar-title max-w-[min(14rem,calc(100%-18rem))] text-center">
          {title}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 basis-0 items-center gap-2 md:flex">
        {hasActiveSessions ? (
          <>
            {runningCount > 0 && (
              <StatusCount
                count={runningCount}
                label="Running"
                dotClass="bg-success"
                textClass="text-success"
              />
            )}
            {attentionCount > 0 && (
              <StatusCount
                count={attentionCount}
                label="Attention"
                dotClass="bg-warning"
                textClass="text-warning"
              />
            )}
          </>
        ) : (
          <span className="window-toolbar-chip text-muted-foreground">No active sessions</span>
        )}
      </div>

      <AppShellToolbarActionRail className="min-w-0 flex-1 basis-0 justify-end gap-1.5">
        {workspaces.length > 1 && (
          <Button
            variant="outline"
            size="toolbar"
            className={cn(
              "min-w-0 shadow-none",
              workspaceFilter ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={(event) => {
              const specs: NativeMenuItemSpec[] = [
                {
                  kind: "check",
                  text: "All workspaces",
                  checked: !workspaceFilter,
                  action: () => onWorkspaceFilterChange(null),
                },
                ...workspaces.map<NativeMenuItemSpec>((workspace) => ({
                  kind: "check",
                  text: workspace.name,
                  checked: workspaceFilter === workspace.id,
                  action: () => onWorkspaceFilterChange(workspace.id),
                })),
              ];
              void showNativeMenuForElement(event.currentTarget, specs);
            }}
          >
            <Folder className="size-3.5" />
            <span className="hidden max-w-[11rem] truncate sm:inline">
              {activeWorkspace?.name ?? "All workspaces"}
            </span>
            <span className="sm:hidden">{activeWorkspace ? "Workspace" : "All"}</span>
          </Button>
        )}

        {runningCount > 0 && onStopAll ? (
          <Button variant="destructive" size="toolbar" className="shadow-none" onClick={onStopAll}>
            <OctagonX className="size-3.5" />
            <span className="hidden sm:inline">Stop All</span>
            <span className="sm:hidden">Stop</span>
          </Button>
        ) : null}
      </AppShellToolbarActionRail>
    </div>
  );
}

function StatusCount({
  count,
  dotClass,
  label,
  textClass,
}: {
  count: number;
  dotClass: string;
  label: string;
  textClass: string;
}) {
  return (
    <div className="window-toolbar-chip">
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      <span className={cn("tabular-nums", textClass)}>{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
