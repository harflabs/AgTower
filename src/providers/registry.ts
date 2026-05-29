/**
 * Provider registry — manages all registered provider modules.
 *
 * Providers self-register via registerProvider() at import time.
 * Consumers look up providers via getProvider(id).
 */

import { useMemo } from "react";
import { useProviderAvailabilityStore } from "@/stores/provider-availability-store";
import type { ProviderModule } from "./types";

const providers = new Map<string, ProviderModule>();

export function registerProvider(module: ProviderModule) {
  providers.set(module.id, module);
}

export function getProvider(id: string): ProviderModule | undefined {
  return providers.get(id);
}

export function getAllProviders(): ProviderModule[] {
  return Array.from(providers.values());
}

/**
 * Reactive selector returning only the providers whose CLI was found by
 * the most recent availability probe. Use this anywhere we surface a
 * "create new session with X" affordance — the unavailable providers
 * shouldn't be reachable until the user installs them and refreshes.
 *
 * Providers without a probe entry yet are treated as available so the
 * UI doesn't briefly hide everything before the first refresh resolves
 * on cold start.
 */
export function useAvailableProviders(): ProviderModule[] {
  const availability = useProviderAvailabilityStore((s) => s.availability);
  // Memoize against the `availability` reference so this returns a stable array
  // unless availability actually changes. The registry itself is stable, and a
  // fresh array each render would invalidate the command palette's item/ranking
  // memos on every keystroke and store tick.
  return useMemo(
    () =>
      getAllProviders().filter((provider) => {
        const entry = availability[provider.id];
        return entry === undefined ? true : entry.available;
      }),
    [availability],
  );
}
