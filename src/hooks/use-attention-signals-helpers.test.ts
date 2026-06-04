import { describe, expect, it } from "vitest";
import { deriveAttentionSignals } from "@/hooks/use-attention-signals-helpers";

describe("deriveAttentionSignals", () => {
  it("bounces when a new agent becomes blocked while the app is in the background", () => {
    expect(
      deriveAttentionSignals({
        rawCount: 1,
        previousRawCount: 0,
        activeIsAttention: false,
        windowFocused: false,
      }),
    ).toEqual({ badgeCount: 1, requestAttention: true });
  });

  it("bounces on every raw increase, not just the zero edge", () => {
    // A second agent blocks while the user is viewing the first blocked one.
    expect(
      deriveAttentionSignals({
        rawCount: 2,
        previousRawCount: 1,
        activeIsAttention: true,
        windowFocused: true,
      }),
    ).toEqual({ badgeCount: 1, requestAttention: true });
  });

  it("hides the actively-viewed blocked session from the badge while focused", () => {
    expect(
      deriveAttentionSignals({
        rawCount: 1,
        previousRawCount: 1,
        activeIsAttention: true,
        windowFocused: true,
      }),
    ).toEqual({ badgeCount: 0, requestAttention: false });
  });

  it("re-shows the badge on blur WITHOUT re-bouncing the dock", () => {
    // The dock-jump regression: the user opens the blocked session (badge
    // adjusts to 0), then switches to another app. The focus adjustment
    // re-inflates the badge 0→1 with no new blocked agent. The badge may
    // reappear — but the dock must NOT bounce; the user already saw this
    // session and nothing new happened.
    expect(
      deriveAttentionSignals({
        rawCount: 1,
        previousRawCount: 1,
        activeIsAttention: true,
        windowFocused: false,
      }),
    ).toEqual({ badgeCount: 1, requestAttention: false });
  });

  it("does not bounce when the blocked count decreases", () => {
    expect(
      deriveAttentionSignals({
        rawCount: 1,
        previousRawCount: 2,
        activeIsAttention: false,
        windowFocused: false,
      }),
    ).toEqual({ badgeCount: 1, requestAttention: false });
  });

  it("never produces a negative badge", () => {
    expect(
      deriveAttentionSignals({
        rawCount: 0,
        previousRawCount: 0,
        activeIsAttention: true,
        windowFocused: true,
      }),
    ).toEqual({ badgeCount: 0, requestAttention: false });
  });
});
