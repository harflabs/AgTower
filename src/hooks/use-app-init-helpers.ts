import type { HistoryImportPreference } from "@/lib/onboarding-state";
import type { StartupBehavior } from "@/stores/settings-store";

interface OnboardingStateLike {
  historyImportPreference: HistoryImportPreference;
  completedAt: number | null;
}

export function resolveOnboardingCompletion(
  onboardingState: OnboardingStateLike | null,
  forceOnboarding: boolean,
  hasExistingUserData: boolean,
): boolean {
  if (forceOnboarding) return false;
  if (typeof onboardingState?.completedAt === "number") return true;
  return onboardingState === null && hasExistingUserData;
}

export function resolveAppInitActiveSessionId<TSession>(
  onboardingComplete: boolean,
  lastSessionId: string | null,
  sessionsRecord: Record<string, TSession>,
): string | null {
  if (!onboardingComplete || !lastSessionId || !sessionsRecord[lastSessionId]) {
    return null;
  }

  return lastSessionId;
}

export function resolveAppInitInitialRoute<TSession>({
  onboardingComplete,
  startupBehavior,
  lastSessionId,
  sessionsRecord,
}: {
  onboardingComplete: boolean;
  startupBehavior: StartupBehavior;
  lastSessionId: string | null;
  sessionsRecord: Record<string, TSession>;
}): string {
  if (!onboardingComplete) {
    return "/onboarding";
  }

  if (startupBehavior !== "restore") {
    return "/";
  }

  const activeSessionId = resolveAppInitActiveSessionId(
    onboardingComplete,
    lastSessionId,
    sessionsRecord,
  );
  return activeSessionId ? `/session/${activeSessionId}` : "/";
}
