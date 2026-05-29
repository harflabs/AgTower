import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { getAllProviders } from "@/providers/registry";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Cached availability status for a single provider.
 *
 * `available` is the trusted answer to "can the user start a session with
 * this provider right now?". `version` is captured for display in Settings.
 * `checkedAt` is the unix-ms timestamp of the last successful probe — used
 * to show "Checked just now / 5 min ago" in the Settings refresh control.
 */
interface ProviderAvailabilityEntry {
  available: boolean;
  version: string | null;
  checkedAt: number;
}

interface ProviderAvailabilityState {
  /** Per-provider availability cache. Persisted across launches so the
   *  UI can gate entry points instantly on cold start using last-known
   *  state, then refresh in the background. */
  availability: Record<string, ProviderAvailabilityEntry>;
  /** True while a refresh is in flight. Settings shows a spinner. */
  isRefreshing: boolean;
  /** Timestamp of the most recent refresh attempt (success or failure). */
  lastRefreshedAt: number | null;
  /** Re-probe every registered provider's CLI using its `detect` method
   *  and the user's stored cliPath setting. Providers without `detect`
   *  are treated as always-available (legacy fallback). Errors are
   *  swallowed per provider — we record `available: false` rather than
   *  rejecting the whole batch. Idempotent and safe to call repeatedly. */
  refresh: () => Promise<void>;
  /** Convenience selector. Providers without an entry yet are treated as
   *  available so the UI doesn't briefly hide everything before the
   *  first refresh resolves. */
  isAvailable: (providerId: string) => boolean;
}

export const useProviderAvailabilityStore = create<ProviderAvailabilityState>()(
  devtools(
    persist(
      (set, get) => ({
        availability: {},
        isRefreshing: false,
        lastRefreshedAt: null,

        refresh: async () => {
          if (get().isRefreshing) return;
          set({ isRefreshing: true });

          const providerSettings = useSettingsStore.getState().providerSettings;
          const updates: Record<string, ProviderAvailabilityEntry> = {};

          await Promise.all(
            getAllProviders().map(async (provider) => {
              if (!provider.detect) return;
              const cliPath =
                (providerSettings[provider.id]?.cliPath as string | undefined)?.trim() ?? "";
              try {
                const result = await provider.detect(cliPath);
                updates[provider.id] = {
                  available: result.available,
                  version: result.version,
                  checkedAt: Date.now(),
                };
              } catch (err) {
                console.error(`[provider-availability] detect ${provider.id} failed:`, err);
                updates[provider.id] = {
                  available: false,
                  version: null,
                  checkedAt: Date.now(),
                };
              }
            }),
          );

          set((s) => ({
            availability: { ...s.availability, ...updates },
            isRefreshing: false,
            lastRefreshedAt: Date.now(),
          }));
        },

        isAvailable: (providerId) => {
          const entry = get().availability[providerId];
          // Unknown provider (never probed) → optimistic true so the
          // user doesn't see a blank sidebar on first launch before the
          // initial refresh resolves. Once the probe runs, the cache
          // gets the authoritative answer.
          return entry === undefined ? true : entry.available;
        },
      }),
      {
        name: "agtower-provider-availability",
        version: 1,
        // Only persist the cache, not transient flags.
        partialize: (state) => ({
          availability: state.availability,
          lastRefreshedAt: state.lastRefreshedAt,
        }),
      },
    ),
    { name: "provider-availability-store" },
  ),
);
