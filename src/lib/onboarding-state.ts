import { loadWorkspaceState, saveWorkspaceState } from "@/lib/engine";

const ONBOARDING_STATE_KEY = "onboarding_state_v1";
const FORCE_ONBOARDING_KEY = "agtower.force_onboarding_v1";

export type HistoryImportPreference = "auto" | "manual";

interface OnboardingState {
  completedAt: number | null;
  historyImportPreference: HistoryImportPreference;
}

function normalizeHistoryImportPreference(value: unknown): HistoryImportPreference {
  return value === "auto" ? "auto" : "manual";
}

function normalizeOnboardingState(value: unknown): OnboardingState | null {
  if (!value || typeof value !== "object") return null;

  const state = value as Partial<OnboardingState>;
  return {
    completedAt: typeof state.completedAt === "number" ? state.completedAt : null,
    historyImportPreference: normalizeHistoryImportPreference(state.historyImportPreference),
  };
}

export async function loadOnboardingState(): Promise<OnboardingState | null> {
  const raw = await loadWorkspaceState(ONBOARDING_STATE_KEY);
  if (!raw) return null;

  try {
    return normalizeOnboardingState(JSON.parse(raw));
  } catch (error) {
    console.error("[onboarding] Failed to parse onboarding state:", error);
    return null;
  }
}

function saveOnboardingState(state: OnboardingState): Promise<void> {
  return saveWorkspaceState(ONBOARDING_STATE_KEY, JSON.stringify(state));
}

function setForceOnboardingFlag(value: boolean) {
  if (typeof localStorage === "undefined") return;

  if (value) {
    localStorage.setItem(FORCE_ONBOARDING_KEY, "1");
    return;
  }

  localStorage.removeItem(FORCE_ONBOARDING_KEY);
}

export function completeOnboarding(
  historyImportPreference: HistoryImportPreference,
): Promise<void> {
  setForceOnboardingFlag(false);
  return saveOnboardingState({
    completedAt: Date.now(),
    historyImportPreference,
  });
}

export function markOnboardingRequired() {
  setForceOnboardingFlag(true);
}

export function shouldForceOnboarding(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(FORCE_ONBOARDING_KEY) === "1";
}
