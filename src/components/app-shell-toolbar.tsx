import * as React from "react";
import type { Repository } from "@/stores/repo-store";

export interface AppShellTitleToolbarDescriptor {
  kind: "title";
  title: string;
  detail?: string;
}

interface DashboardShellToolbarDescriptor {
  kind: "dashboard";
  title: string;
  runningCount: number;
  attentionCount: number;
  onStopAll?: () => void;
  workspaceFilter: string | null;
  workspaces: Array<Pick<Repository, "id" | "name">>;
  onWorkspaceFilterChange: (id: string | null) => void;
}

interface SessionShellToolbarDescriptor {
  kind: "session";
  sessionId: string;
  onDelete?: () => void;
  onArchive?: () => void;
  onStop?: () => void;
  onClose?: () => void;
}

export type AppShellToolbarDescriptor =
  | AppShellTitleToolbarDescriptor
  | DashboardShellToolbarDescriptor
  | SessionShellToolbarDescriptor;

type AppShellToolbarRegistration = {
  ownerId: string;
  descriptor: AppShellToolbarDescriptor;
};

type AppShellToolbarContextValue = {
  registerToolbar: (ownerId: string, descriptor: AppShellToolbarDescriptor | null) => void;
};

const AppShellToolbarContext = React.createContext<AppShellToolbarContextValue | null>(null);

function useAppShellToolbarContext() {
  const context = React.useContext(AppShellToolbarContext);
  if (!context) {
    throw new Error("AppShell toolbar hooks must be used within AppShell.");
  }

  return context;
}

export function useAppShellToolbar(descriptor: AppShellToolbarDescriptor | null) {
  const { registerToolbar } = useAppShellToolbarContext();
  const ownerId = React.useId();

  React.useLayoutEffect(() => {
    registerToolbar(ownerId, descriptor);

    return () => {
      registerToolbar(ownerId, null);
    };
  }, [descriptor, ownerId, registerToolbar]);
}

export type { AppShellToolbarRegistration };
export { AppShellToolbarContext };
