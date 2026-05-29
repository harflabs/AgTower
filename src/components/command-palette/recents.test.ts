import { beforeEach, describe, expect, it } from "vitest";
import { AGTOWER_RECENT_COMMANDS_KEY as RECENTS_KEY } from "@/lib/storage-keys";
import { getRecentEntries, pushRecentItem } from "./recents";

describe("recents", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates legacy string arrays into typed recents", () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(["session:abc", "command:new-session"]));

    const recents = getRecentEntries();

    expect(recents).toHaveLength(2);
    expect(recents[0]?.kind).toBe("session");
    expect(recents[1]?.kind).toBe("command");
  });

  it("tracks frequency and freshness when pushing recent items", () => {
    pushRecentItem({
      group: "Commands",
      id: "command:new-session",
      kind: "command",
      perform: () => {},
      title: "New Session",
    });
    pushRecentItem({
      group: "Commands",
      id: "command:new-session",
      kind: "command",
      perform: () => {},
      title: "New Session",
    });

    const [recent] = getRecentEntries();

    expect(recent?.id).toBe("command:new-session");
    expect(recent?.useCount).toBe(2);
  });
});
