import { describe, expect, it } from "vitest";
import {
  resolveAppInitActiveSessionId,
  resolveAppInitInitialRoute,
  resolveOnboardingCompletion,
} from "@/hooks/use-app-init-helpers";

describe("use-app-init helpers", () => {
  it("treats legacy installs as onboarded unless onboarding is explicitly forced", () => {
    expect(resolveOnboardingCompletion(null, false, false)).toBe(false);
    expect(resolveOnboardingCompletion(null, false, true)).toBe(true);
    expect(
      resolveOnboardingCompletion(
        { completedAt: 1, historyImportPreference: "manual" },
        false,
        false,
      ),
    ).toBe(true);
    expect(resolveOnboardingCompletion(null, true, true)).toBe(false);
  });

  it("resolves the active session only when onboarding is complete and the session exists", () => {
    const sessions = {
      a: { id: "a" },
    };

    expect(resolveAppInitActiveSessionId(false, "a", sessions)).toBeNull();
    expect(resolveAppInitActiveSessionId(true, "missing", sessions)).toBeNull();
    expect(resolveAppInitActiveSessionId(true, "a", sessions)).toBe("a");
  });

  it("routes unfinished onboarding to the onboarding screen", () => {
    expect(
      resolveAppInitInitialRoute({
        onboardingComplete: false,
        startupBehavior: "dashboard",
        lastSessionId: "a",
        sessionsRecord: { a: { id: "a" } },
      }),
    ).toBe("/onboarding");
  });

  it("restores the last session only when restore mode has a valid session", () => {
    const sessions = {
      a: { id: "a" },
    };

    expect(
      resolveAppInitInitialRoute({
        onboardingComplete: true,
        startupBehavior: "dashboard",
        lastSessionId: "a",
        sessionsRecord: sessions,
      }),
    ).toBe("/");

    expect(
      resolveAppInitInitialRoute({
        onboardingComplete: true,
        startupBehavior: "restore",
        lastSessionId: "missing",
        sessionsRecord: sessions,
      }),
    ).toBe("/");

    expect(
      resolveAppInitInitialRoute({
        onboardingComplete: true,
        startupBehavior: "restore",
        lastSessionId: "a",
        sessionsRecord: sessions,
      }),
    ).toBe("/session/a");
  });
});
