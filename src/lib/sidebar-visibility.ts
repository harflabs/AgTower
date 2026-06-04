import type { SessionStatus } from "@/types/session";
import type { SidebarSessionBucket, SidebarTree, SidebarWorkspaceNode } from "@/types/sidebar";

/**
 * Minimal session shape the visibility helpers need. Structurally satisfied
 * by the full `Session` record so callers can pass the store map directly.
 */
export type SessionStatusLookup = Record<string, { status: SessionStatus } | undefined>;

export type FocusableNode =
  | { id: `workspace:${string}`; kind: "workspace"; workspaceKey: string }
  | { id: `history:${string}`; kind: "history"; workspaceKey: string }
  | {
      id: `session:${string}`;
      kind: "session";
      workspaceKey: string;
      sessionId: string;
      bucket: SidebarSessionBucket;
    };

/**
 * Default expansion for a workspace the user never explicitly toggled:
 * expanded only while it has work that can still demand attention. Quiet
 * repos take one line; live ones surface their sessions.
 */
export function workspaceDefaultExpanded(
  workspace: SidebarWorkspaceNode,
  sessions: SessionStatusLookup,
): boolean {
  return workspace.visibleSessions.some((node) => {
    const status = sessions[node.id]?.status;
    return status === "running" || status === "needsAttention";
  });
}

/**
 * Single source of truth for "is this workspace expanded?". An explicit
 * user toggle (a persisted entry in `collapsedWorkspaces`) always wins;
 * untouched workspaces fall back to the status-derived default.
 *
 * Every read site — rendering, focusable-node building, and the arrow-key
 * handlers — must resolve through this function. If any site re-implements
 * the lookup, keyboard navigation diverges from what is on screen.
 */
export function isWorkspaceExpanded(
  workspace: SidebarWorkspaceNode,
  collapsedWorkspaces: Record<string, boolean>,
  sessions: SessionStatusLookup,
): boolean {
  const explicit = collapsedWorkspaces[workspace.key];
  if (explicit !== undefined) return !explicit;
  return workspaceDefaultExpanded(workspace, sessions);
}

/**
 * Flatten the rendered tree into the ordered list of keyboard-focusable
 * nodes. Mirrors the render exactly: collapsed workspaces contribute only
 * their header, expanded history contributes its sessions before the
 * "Show more / Show less" disclosure node.
 */
export function buildFocusableNodes(
  tree: SidebarTree,
  collapsedWorkspaces: Record<string, boolean>,
  expandedHistoryByWorkspace: Record<string, boolean>,
  sessions: SessionStatusLookup,
): FocusableNode[] {
  const nodes: FocusableNode[] = [];
  const allWorkspaces = [...tree.pinnedWorkspaces, ...tree.workspaces];

  for (const workspace of allWorkspaces) {
    nodes.push({
      id: `workspace:${workspace.key}`,
      kind: "workspace",
      workspaceKey: workspace.key,
    });

    if (!isWorkspaceExpanded(workspace, collapsedWorkspaces, sessions)) continue;

    for (const sessionNode of workspace.visibleSessions) {
      nodes.push({
        id: `session:${sessionNode.id}`,
        kind: "session",
        workspaceKey: workspace.key,
        sessionId: sessionNode.id,
        bucket: sessionNode.bucket,
      });
    }

    if (workspace.historyCount > 0) {
      const historyExpanded = expandedHistoryByWorkspace[workspace.key] ?? false;

      if (historyExpanded) {
        for (const group of workspace.historyGroups) {
          for (const sessionNode of group.sessions) {
            nodes.push({
              id: `session:${sessionNode.id}`,
              kind: "session",
              workspaceKey: workspace.key,
              sessionId: sessionNode.id,
              bucket: sessionNode.bucket,
            });
          }
        }
      }

      nodes.push({
        id: `history:${workspace.key}`,
        kind: "history",
        workspaceKey: workspace.key,
      });
    }
  }

  return nodes;
}
