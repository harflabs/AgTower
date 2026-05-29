import { describe, expect, it } from "vitest";
import {
  getOpenSessionsByRecency,
  resolveAdjacentOpenSessionTarget,
  resolveCloseCurrentSessionTarget,
} from "@/lib/session-navigation";
import type { Session } from "@/stores/session-store";

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    repoId: overrides.repoId ?? "repo-1",
    repoPath: overrides.repoPath ?? "/tmp/repo-1",
    repoName: overrides.repoName ?? "Repo 1",
    prompt: overrides.prompt ?? "",
    title: overrides.title ?? "Session",
    status: overrides.status ?? "needsAttention",
    pid: overrides.pid ?? null,
    providerData: overrides.providerData ?? {},
    model: overrides.model ?? null,
    createdAt: overrides.createdAt ?? 0,
    endedAt: overrides.endedAt ?? null,
    result: overrides.result ?? null,
    durationMs: overrides.durationMs ?? null,
    numTurns: overrides.numTurns ?? null,
    exitCode: overrides.exitCode ?? null,
    error: overrides.error ?? null,
    baseCommitSha: overrides.baseCommitSha ?? null,
    totalInputTokens: overrides.totalInputTokens ?? null,
    totalOutputTokens: overrides.totalOutputTokens ?? null,
    totalCacheReadTokens: overrides.totalCacheReadTokens ?? null,
    totalCacheWriteTokens: overrides.totalCacheWriteTokens ?? null,
    gitBranch: overrides.gitBranch ?? null,
    stopReason: overrides.stopReason ?? null,
    provider: overrides.provider ?? "claude-code",
    ptyActive: overrides.ptyActive ?? false,
    liveProviderData: overrides.liveProviderData ?? {},
  };
}

describe("resolveCloseCurrentSessionTarget", () => {
  it("chooses the next needs-attention session by recency", () => {
    const current = makeSession({
      createdAt: 10,
      id: "current",
      repoId: "repo-current",
      status: "needsAttention",
    });
    const nextNewest = makeSession({
      createdAt: 30,
      id: "next-newest",
      repoId: "repo-next",
      status: "needsAttention",
    });
    const older = makeSession({
      createdAt: 20,
      id: "older",
      repoId: "repo-older",
      status: "needsAttention",
    });

    const target = resolveCloseCurrentSessionTarget(
      {
        current,
        nextNewest,
        older,
      },
      "current",
    );

    expect(target).toEqual({
      kind: "session",
      repoId: "repo-next",
      sessionId: "next-newest",
    });
  });

  it("falls back to the dashboard when there is no other attention session", () => {
    const current = makeSession({
      createdAt: 10,
      id: "current",
      status: "needsAttention",
    });
    const closed = makeSession({
      createdAt: 30,
      id: "closed",
      status: "closed",
    });

    const target = resolveCloseCurrentSessionTarget(
      {
        current,
        closed,
      },
      "current",
    );

    expect(target).toEqual({ kind: "dashboard" });
  });
});

describe("getOpenSessionsByRecency", () => {
  it("returns only running, idle, and needs-attention sessions", () => {
    const sessions = {
      running: makeSession({ createdAt: 30, id: "running", status: "running" }),
      idle: makeSession({ createdAt: 20, id: "idle", status: "idle" }),
      attention: makeSession({
        createdAt: 10,
        id: "attention",
        status: "needsAttention",
      }),
      closed: makeSession({ createdAt: 40, id: "closed", status: "closed" }),
      archived: makeSession({ createdAt: 50, id: "archived", status: "archived" }),
    };

    expect(getOpenSessionsByRecency(sessions).map((session) => session.id)).toEqual([
      "running",
      "idle",
      "attention",
    ]);
  });
});

describe("resolveAdjacentOpenSessionTarget", () => {
  it("cycles to the next open session by recency", () => {
    const current = makeSession({
      createdAt: 30,
      id: "current",
      repoId: "repo-current",
      status: "running",
    });
    const next = makeSession({
      createdAt: 20,
      id: "next",
      repoId: "repo-next",
      status: "idle",
    });
    const prev = makeSession({
      createdAt: 10,
      id: "prev",
      repoId: "repo-prev",
      status: "needsAttention",
    });

    const target = resolveAdjacentOpenSessionTarget(
      {
        current,
        next,
        prev,
      },
      "current",
      "next",
    );

    expect(target).toEqual({
      kind: "session",
      repoId: "repo-next",
      sessionId: "next",
    });
  });

  it("wraps to the end when moving backward without an active open session", () => {
    const newest = makeSession({
      createdAt: 30,
      id: "newest",
      repoId: "repo-newest",
      status: "running",
    });
    const oldest = makeSession({
      createdAt: 10,
      id: "oldest",
      repoId: "repo-oldest",
      status: "idle",
    });

    const target = resolveAdjacentOpenSessionTarget(
      {
        newest,
        oldest,
      },
      null,
      "prev",
    );

    expect(target).toEqual({
      kind: "session",
      repoId: "repo-oldest",
      sessionId: "oldest",
    });
  });
});
