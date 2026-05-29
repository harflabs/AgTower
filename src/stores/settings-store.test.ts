import { describe, expect, it } from "vitest";
import {
  clampTerminalFontSize,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "@/stores/settings-store";

describe("clampTerminalFontSize", () => {
  it("passes through values inside the allowed range", () => {
    expect(clampTerminalFontSize(TERMINAL_FONT_SIZE_MIN)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(TERMINAL_FONT_SIZE_DEFAULT)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(clampTerminalFontSize(TERMINAL_FONT_SIZE_MAX)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(clampTerminalFontSize(18)).toBe(18);
  });

  it("clamps values below the minimum", () => {
    expect(clampTerminalFontSize(TERMINAL_FONT_SIZE_MIN - 1)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(0)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(-100)).toBe(TERMINAL_FONT_SIZE_MIN);
  });

  it("clamps values above the maximum", () => {
    expect(clampTerminalFontSize(TERMINAL_FONT_SIZE_MAX + 1)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(clampTerminalFontSize(200)).toBe(TERMINAL_FONT_SIZE_MAX);
  });

  it("rounds non-integer inputs to the nearest integer", () => {
    expect(clampTerminalFontSize(13.4)).toBe(13);
    expect(clampTerminalFontSize(13.6)).toBe(14);
  });

  it("returns the default for non-finite inputs", () => {
    expect(clampTerminalFontSize(Number.NaN)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(clampTerminalFontSize(Number.POSITIVE_INFINITY)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(clampTerminalFontSize(Number.NEGATIVE_INFINITY)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it("keeps MIN below or equal to DEFAULT below or equal to MAX", () => {
    expect(TERMINAL_FONT_SIZE_MIN).toBeLessThanOrEqual(TERMINAL_FONT_SIZE_DEFAULT);
    expect(TERMINAL_FONT_SIZE_DEFAULT).toBeLessThanOrEqual(TERMINAL_FONT_SIZE_MAX);
  });
});
