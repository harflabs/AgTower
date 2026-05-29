import { describe, expect, it } from "vitest";
import { resolveSelectAllAction } from "@/lib/keyboard/select-all";

describe("resolveSelectAllAction", () => {
  it("allows native select all inside text inputs", () => {
    const inputLike = {
      closest: (selector: string) => (selector.includes("input") ? {} : null),
    };

    expect(resolveSelectAllAction(inputLike)).toEqual({ kind: "native" });
  });

  it("selects the focused turn content instead of the entire document", () => {
    const scope = { id: "scope" } as HTMLElement;
    const label = {
      closest: (selector: string) => (selector.includes("[data-select-all-scope]") ? scope : null),
    };

    const action = resolveSelectAllAction(label);

    expect(action.kind).toBe("custom");
    if (action.kind === "custom") {
      expect(action.target).toBe(scope);
    }
  });

  it("blocks select all on generic app chrome", () => {
    const chrome = {
      closest: () => null,
    };

    expect(resolveSelectAllAction(chrome)).toEqual({ kind: "block" });
  });

  it("does not hijack focused controls inside a message bubble", () => {
    const button = {
      closest: (selector: string) =>
        selector.includes("[data-selection='chrome']") || selector.includes("button") ? {} : null,
    };

    expect(resolveSelectAllAction(button)).toEqual({ kind: "block" });
  });
});
