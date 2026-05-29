import { describe, expect, it } from "vitest";
import { blocksNativeWindowDrag } from "@/hooks/use-native-window-drag";

function createClosestTarget(matchesSelector: boolean) {
  return {
    closest: () => (matchesSelector ? ({} as Element) : null),
  } as unknown as EventTarget & { closest: (selector: string) => Element | null };
}

describe("blocksNativeWindowDrag", () => {
  it("blocks interactive targets", () => {
    expect(blocksNativeWindowDrag(createClosestTarget(true))).toBe(true);
  });

  it("allows non-interactive targets", () => {
    expect(blocksNativeWindowDrag(createClosestTarget(false))).toBe(false);
  });

  it("allows targets without closest support", () => {
    expect(blocksNativeWindowDrag({} as EventTarget)).toBe(false);
  });
});
