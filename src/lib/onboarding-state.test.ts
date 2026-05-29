import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadWorkspaceStateMock, saveWorkspaceStateMock } = vi.hoisted(() => ({
  loadWorkspaceStateMock: vi.fn(),
  saveWorkspaceStateMock: vi.fn(),
}));

vi.mock("@/lib/engine", () => ({
  loadWorkspaceState: loadWorkspaceStateMock,
  saveWorkspaceState: saveWorkspaceStateMock,
}));

import {
  completeOnboarding,
  loadOnboardingState,
  markOnboardingRequired,
  shouldForceOnboarding,
} from "@/lib/onboarding-state";

describe("onboarding state", () => {
  beforeEach(() => {
    loadWorkspaceStateMock.mockReset();
    saveWorkspaceStateMock.mockReset();
    localStorage.clear();
  });

  it("loads and normalizes a saved onboarding state", async () => {
    loadWorkspaceStateMock.mockResolvedValue(
      JSON.stringify({
        completedAt: 123,
        historyImportPreference: "auto",
      }),
    );

    await expect(loadOnboardingState()).resolves.toEqual({
      completedAt: 123,
      historyImportPreference: "auto",
    });
  });

  it("falls back to manual preference for invalid saved values", async () => {
    loadWorkspaceStateMock.mockResolvedValue(
      JSON.stringify({
        completedAt: null,
        historyImportPreference: "something-else",
      }),
    );

    await expect(loadOnboardingState()).resolves.toEqual({
      completedAt: null,
      historyImportPreference: "manual",
    });
  });

  it("returns null when saved onboarding JSON is invalid", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loadWorkspaceStateMock.mockResolvedValue("{bad-json");

    await expect(loadOnboardingState()).resolves.toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it("persists completion with the chosen history preference", async () => {
    saveWorkspaceStateMock.mockResolvedValue(undefined);

    await completeOnboarding("auto");

    expect(saveWorkspaceStateMock).toHaveBeenCalledOnce();
    expect(saveWorkspaceStateMock.mock.calls[0]?.[0]).toBe("onboarding_state_v1");
    expect(JSON.parse(saveWorkspaceStateMock.mock.calls[0]?.[1] as string)).toMatchObject({
      historyImportPreference: "auto",
    });
  });

  it("can force onboarding after a full reset", () => {
    expect(shouldForceOnboarding()).toBe(false);

    markOnboardingRequired();

    expect(shouldForceOnboarding()).toBe(true);
  });

  it("clears the forced onboarding flag when onboarding completes", async () => {
    saveWorkspaceStateMock.mockResolvedValue(undefined);
    markOnboardingRequired();

    await completeOnboarding("manual");

    expect(shouldForceOnboarding()).toBe(false);
  });
});
