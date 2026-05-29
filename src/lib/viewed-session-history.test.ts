import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastOpenViewedSessionId,
  readViewedSessions,
  recordViewedSession,
} from "@/lib/viewed-session-history";
import type { SessionStatus } from "@/types/session";

function makeSessionMap(
  entries: Array<{ id: string; status: SessionStatus }>,
): Record<string, { status: SessionStatus }> {
  return Object.fromEntries(entries.map((entry) => [entry.id, { status: entry.status }]));
}

describe("viewed session history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("deduplicates repeated views", () => {
    recordViewedSession("session-1");
    recordViewedSession("session-2");
    recordViewedSession("session-1");

    // Most-recent first; the repeated id should appear only once at the top.
    expect(readViewedSessions()).toEqual(["session-1", "session-2"]);
  });

  it("exposes the freshest-first ordered list via readViewedSessions", () => {
    recordViewedSession("a");
    recordViewedSession("b");
    recordViewedSession("c");

    expect(readViewedSessions()).toEqual(["c", "b", "a"]);
  });

  describe("getLastOpenViewedSessionId", () => {
    it("walks past closed and archived sessions to find the freshest open one", () => {
      recordViewedSession("closed");
      recordViewedSession("archived");
      recordViewedSession("idle");
      recordViewedSession("running");

      const sessions = makeSessionMap([
        { id: "closed", status: "closed" },
        { id: "archived", status: "archived" },
        { id: "idle", status: "idle" },
        { id: "running", status: "running" },
      ]);

      // Excluding the current ("running"), the next open in MRU order is "idle".
      expect(getLastOpenViewedSessionId(sessions, "running")).toBe("idle");
    });

    it("skips stale session ids that no longer exist in the live map", () => {
      recordViewedSession("ghost");
      recordViewedSession("real");

      const sessions = makeSessionMap([{ id: "real", status: "running" }]);
      expect(getLastOpenViewedSessionId(sessions, null)).toBe("real");
    });

    it("returns null when no viewed session is currently open", () => {
      recordViewedSession("closed-1");
      recordViewedSession("closed-2");

      const sessions = makeSessionMap([
        { id: "closed-1", status: "closed" },
        { id: "closed-2", status: "archived" },
      ]);
      expect(getLastOpenViewedSessionId(sessions, null)).toBeNull();
    });

    it("returns the top of MRU when no current session is provided", () => {
      recordViewedSession("older");
      recordViewedSession("freshest");

      const sessions = makeSessionMap([
        { id: "older", status: "idle" },
        { id: "freshest", status: "running" },
      ]);
      expect(getLastOpenViewedSessionId(sessions, null)).toBe("freshest");
    });
  });
});
