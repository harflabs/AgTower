import { describe, expect, it } from "vitest";
import {
  buildFocusableNodes,
  isWorkspaceExpanded,
  workspaceDefaultExpanded,
} from "@/lib/sidebar-visibility";
import type { SessionStatus } from "@/types/session";
import type { SidebarTree, SidebarWorkspaceNode } from "@/types/sidebar";

function makeWorkspace(overrides: Partial<SidebarWorkspaceNode> = {}): SidebarWorkspaceNode {
  return {
    key: "repo-a",
    repoId: "repo-a",
    name: "repo-a",
    path: "/tmp/repo-a",
    color: null,
    isMissing: false,
    visibleSessions: [],
    historyCount: 0,
    historyGroups: [],
    ...overrides,
  };
}

function statuses(map: Record<string, SessionStatus>) {
  return Object.fromEntries(Object.entries(map).map(([id, status]) => [id, { status }]));
}

describe("workspaceDefaultExpanded", () => {
  it("expands while running or needs-attention work exists", () => {
    const ws = makeWorkspace({
      visibleSessions: [
        { id: "s1", bucket: "active" },
        { id: "s2", bucket: "recentClosed" },
      ],
    });
    expect(workspaceDefaultExpanded(ws, statuses({ s1: "running", s2: "closed" }))).toBe(true);
    expect(workspaceDefaultExpanded(ws, statuses({ s1: "needsAttention", s2: "closed" }))).toBe(
      true,
    );
  });

  it("collapses quiet workspaces (idle/closed only, or empty)", () => {
    const ws = makeWorkspace({
      visibleSessions: [
        { id: "s1", bucket: "active" },
        { id: "s2", bucket: "recentClosed" },
      ],
    });
    expect(workspaceDefaultExpanded(ws, statuses({ s1: "idle", s2: "closed" }))).toBe(false);
    expect(workspaceDefaultExpanded(makeWorkspace(), {})).toBe(false);
  });
});

describe("isWorkspaceExpanded", () => {
  const running = makeWorkspace({ visibleSessions: [{ id: "s1", bucket: "active" }] });
  const sessions = statuses({ s1: "running" });

  it("explicit toggle always wins over the status default", () => {
    expect(isWorkspaceExpanded(running, { "repo-a": true }, sessions)).toBe(false);
    const quiet = makeWorkspace({ visibleSessions: [{ id: "s1", bucket: "recentClosed" }] });
    expect(isWorkspaceExpanded(quiet, { "repo-a": false }, statuses({ s1: "closed" }))).toBe(true);
  });

  it("untouched workspaces fall back to the status default", () => {
    expect(isWorkspaceExpanded(running, {}, sessions)).toBe(true);
    const quiet = makeWorkspace({ visibleSessions: [{ id: "s1", bucket: "recentClosed" }] });
    expect(isWorkspaceExpanded(quiet, {}, statuses({ s1: "closed" }))).toBe(false);
  });
});

describe("buildFocusableNodes", () => {
  const tree: SidebarTree = {
    pinnedWorkspaces: [],
    workspaces: [
      makeWorkspace({
        key: "loud",
        visibleSessions: [
          { id: "a1", bucket: "attention" },
          { id: "a2", bucket: "recentClosed" },
        ],
        historyCount: 2,
        historyGroups: [
          {
            label: "Earlier",
            sessions: [
              { id: "h1", bucket: "history" },
              { id: "h2", bucket: "history" },
            ],
          },
        ],
      }),
      makeWorkspace({ key: "quiet", visibleSessions: [{ id: "q1", bucket: "recentClosed" }] }),
    ],
  };
  const sessions = statuses({
    a1: "needsAttention",
    a2: "closed",
    h1: "closed",
    h2: "closed",
    q1: "closed",
  });

  it("auto-expanded workspaces contribute their sessions; auto-collapsed only the header", () => {
    const ids = buildFocusableNodes(tree, {}, {}, sessions).map((n) => n.id);
    expect(ids).toEqual([
      "workspace:loud",
      "session:a1",
      "session:a2",
      "history:loud",
      "workspace:quiet",
    ]);
  });

  it("an explicit expand on a quiet workspace reveals its rows", () => {
    const ids = buildFocusableNodes(tree, { quiet: false }, {}, sessions).map((n) => n.id);
    expect(ids).toContain("session:q1");
  });

  it("an explicit collapse hides rows even while attention exists", () => {
    const ids = buildFocusableNodes(tree, { loud: true }, {}, sessions).map((n) => n.id);
    expect(ids).toEqual(["workspace:loud", "workspace:quiet"]);
  });

  it("expanded history inserts group sessions before the disclosure node", () => {
    const ids = buildFocusableNodes(tree, {}, { loud: true }, sessions).map((n) => n.id);
    expect(ids).toEqual([
      "workspace:loud",
      "session:a1",
      "session:a2",
      "session:h1",
      "session:h2",
      "history:loud",
      "workspace:quiet",
    ]);
  });
});
