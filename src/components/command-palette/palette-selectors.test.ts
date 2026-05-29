import { describe, expect, it } from "vitest";
import type { Session } from "@/stores/session-store";
import { sessionStructurallyEqual, sessionsStructurallyEqual } from "./palette-selectors";

// Shared defaults so two independently-constructed sessions share the same
// providerData/liveProviderData reference (matching the app's spread-update
// pattern in session-store, where unchanged fields retain their reference).
const DEFAULT_PROVIDER_DATA: Record<string, unknown> = {};
const DEFAULT_LIVE_PROVIDER_DATA: Record<string, unknown> = {};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    repoId: "r1",
    repoPath: "/tmp/r1",
    repoName: "r1",
    prompt: "",
    title: "Session",
    status: "running",
    pid: null,
    providerData: DEFAULT_PROVIDER_DATA,
    model: null,
    createdAt: 0,
    endedAt: null,
    result: null,
    durationMs: null,
    numTurns: null,
    exitCode: null,
    error: null,
    baseCommitSha: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCacheReadTokens: null,
    totalCacheWriteTokens: null,
    gitBranch: null,
    stopReason: null,
    provider: "claude-code",
    ptyActive: false,
    liveProviderData: DEFAULT_LIVE_PROVIDER_DATA,
    ...overrides,
  };
}

describe("sessionStructurallyEqual", () => {
  it("returns true for the same reference", () => {
    const a = makeSession();
    expect(sessionStructurallyEqual(a, a)).toBe(true);
  });

  it("returns true when only transient token fields change", () => {
    const a = makeSession({ totalInputTokens: 100, totalOutputTokens: 50 });
    const b = makeSession({ totalInputTokens: 200, totalOutputTokens: 150 });
    expect(sessionStructurallyEqual(a, b)).toBe(true);
  });

  it("returns true when only liveProviderData or ptyActive change", () => {
    const a = makeSession({ liveProviderData: { foo: 1 }, ptyActive: false });
    const b = makeSession({ liveProviderData: { foo: 2 }, ptyActive: true });
    expect(sessionStructurallyEqual(a, b)).toBe(true);
  });

  it("returns false when status changes", () => {
    const a = makeSession({ status: "running" });
    const b = makeSession({ status: "closed" });
    expect(sessionStructurallyEqual(a, b)).toBe(false);
  });

  it("returns false when title changes", () => {
    const a = makeSession({ title: "A" });
    const b = makeSession({ title: "B" });
    expect(sessionStructurallyEqual(a, b)).toBe(false);
  });

  it("returns false when providerData reference changes", () => {
    const a = makeSession({ providerData: { sessionId: "x" } });
    const b = makeSession({ providerData: { sessionId: "x" } });
    expect(sessionStructurallyEqual(a, b)).toBe(false);
  });
});

describe("sessionsStructurallyEqual", () => {
  it("returns true for the same reference", () => {
    const map = { s1: makeSession() };
    expect(sessionsStructurallyEqual(map, map)).toBe(true);
  });

  it("returns true when all sessions are structurally equal", () => {
    const a = { s1: makeSession({ totalInputTokens: 1 }) };
    const b = { s1: makeSession({ totalInputTokens: 999 }) };
    expect(sessionsStructurallyEqual(a, b)).toBe(true);
  });

  it("returns false when a session is added", () => {
    const a = { s1: makeSession() };
    const b = { s1: makeSession(), s2: makeSession({ id: "s2" }) };
    expect(sessionsStructurallyEqual(a, b)).toBe(false);
  });

  it("returns false when a session is removed", () => {
    const a = { s1: makeSession(), s2: makeSession({ id: "s2" }) };
    const b = { s1: makeSession() };
    expect(sessionsStructurallyEqual(a, b)).toBe(false);
  });

  it("returns false when a session id is swapped", () => {
    const a = { s1: makeSession({ id: "s1" }) };
    const b = { s2: makeSession({ id: "s2" }) };
    expect(sessionsStructurallyEqual(a, b)).toBe(false);
  });

  it("returns false when any session structurally differs", () => {
    const a = {
      s1: makeSession({ id: "s1", status: "running" }),
      s2: makeSession({ id: "s2", status: "idle" }),
    };
    const b = {
      s1: makeSession({ id: "s1", status: "running" }),
      s2: makeSession({ id: "s2", status: "closed" }),
    };
    expect(sessionsStructurallyEqual(a, b)).toBe(false);
  });
});
