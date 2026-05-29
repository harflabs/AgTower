import { describe, expect, it } from "vitest";
import { parsePaletteQuery } from "./query";

describe("parsePaletteQuery", () => {
  it("extracts supported filters and free text", () => {
    const query = parsePaletteQuery(
      'type:session repo:"my repo" status:needsAttention provider:codex pinned:true fix login',
    );

    expect(query.filters.types).toEqual(["session"]);
    expect(query.filters.repos).toEqual(["my repo"]);
    expect(query.filters.statuses).toEqual(["needsattention"]);
    expect(query.filters.providers).toEqual(["codex"]);
    expect(query.filters.pinned).toBe(true);
    expect(query.text).toBe("fix login");
    expect(query.normalizedText).toBe("fix login");
  });

  it("leaves unknown prefixes in free text", () => {
    const query = parsePaletteQuery("unknown:value theme");

    expect(query.text).toBe("unknown:value theme");
    expect(query.filters.types).toEqual([]);
  });
});
