import { useEffect, useState } from "react";
import {
  resolveAppInitActiveSessionId,
  resolveAppInitInitialRoute,
} from "@/hooks/use-app-init-helpers";
import {
  engineStartup,
  getAllRepos,
  getAllSessions,
  getEngineSettings,
  hasExistingUserData,
  loadWorkspaceState,
} from "@/lib/engine";
import { setupEngineSync } from "@/lib/engine-sync";
import { loadOnboardingState, shouldForceOnboarding } from "@/lib/onboarding-state";
import { applyEngineSettings } from "@/lib/settings-actions";
import { setupTauriWindowFocusEvents } from "@/lib/tauri-window-events";
import { useProviderAvailabilityStore } from "@/stores/provider-availability-store";
import type { Repository } from "@/stores/repo-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { resolveOnboardingCompletion } from "./use-app-init-helpers";

export function useAppInit() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const hydrate = useSessionStore((s) => s.hydrate);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  useEffect(() => {
    let cleanupEngineSync: (() => void) | null = null;
    let cleanupWindowFocus: (() => void) | null = null;
    let cancelled = false;

    async function init() {
      try {
        const onboardingState = await loadOnboardingState();
        const forceOnboarding = shouldForceOnboarding();
        const existingUserData =
          !forceOnboarding && onboardingState === null
            ? await hasExistingUserData().catch((error) => {
                console.error("[app-init] Failed to detect existing user data:", error);
                return false;
              })
            : false;
        const onboardingComplete = resolveOnboardingCompletion(
          onboardingState,
          forceOnboarding,
          existingUserData,
        );

        await engineStartup();

        const unsub = await setupEngineSync();
        if (cancelled) {
          unsub();
          return;
        }
        cleanupEngineSync = unsub;

        const [sessionsRecord, reposRecord] = await Promise.all([
          getAllSessions(),
          getAllRepos() as Promise<Record<string, Repository>>,
        ]);
        useRepoStore.getState().hydrate(reposRecord);
        hydrate(sessionsRecord);

        applyEngineSettings(await getEngineSettings());

        // Background-refresh provider availability on every launch. Cached
        // last-known state from the persisted store gates the UI
        // immediately; this just keeps the cache fresh after CLI installs
        // / removals between launches. Errors are swallowed inside refresh.
        void useProviderAvailabilityStore.getState().refresh();

        const lastSessionId = await loadWorkspaceState("activeSessionId");
        const activeSessionId = resolveAppInitActiveSessionId(
          onboardingComplete,
          lastSessionId,
          sessionsRecord,
        );
        if (activeSessionId) {
          setActiveSession(activeSessionId);
        }
        setInitialRoute(
          resolveAppInitInitialRoute({
            onboardingComplete,
            startupBehavior: useSettingsStore.getState().startupBehavior,
            lastSessionId,
            sessionsRecord,
          }),
        );

        setupTauriWindowFocusEvents()
          .then((cleanup) => {
            if (cancelled) {
              cleanup();
              return;
            }
            cleanupWindowFocus = cleanup;
          })
          .catch((err) => {
            console.error("[app-init] Window focus event setup failed:", err);
          });
      } catch (err) {
        console.error("[app-init] Failed to initialize:", err);
        setError(err instanceof Error ? err.message : "Failed to initialize");
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      cleanupEngineSync?.();
      cleanupWindowFocus?.();
    };
  }, [hydrate, setActiveSession]);

  return { loading, error, initialRoute };
}
