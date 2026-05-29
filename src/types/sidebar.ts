export type SidebarSessionBucket = "attention" | "active" | "recentClosed" | "history";

interface SidebarSessionNode {
  id: string;
  bucket: SidebarSessionBucket;
}

interface SidebarHistoryGroup {
  label: string;
  sessions: SidebarSessionNode[];
}

export interface SidebarWorkspaceNode {
  key: string;
  repoId: string | null;
  name: string;
  path: string | null;
  color: string | null;
  isMissing: boolean;
  visibleSessions: SidebarSessionNode[];
  historyCount: number;
  historyGroups: SidebarHistoryGroup[];
}

export interface SidebarTree {
  pinnedWorkspaces: SidebarWorkspaceNode[];
  workspaces: SidebarWorkspaceNode[];
}
