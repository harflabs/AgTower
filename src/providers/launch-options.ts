import { getProvider } from "@/providers/registry";

/** Resolve a provider's launch-option values into a providerData fragment.
 *  Precedence per key: override -> saved default (settings) -> omit. Empty string = omit. */
export function buildLaunchOptionData(
  providerId: string,
  settings: Record<string, unknown>,
  overrides?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const opt of getProvider(providerId)?.launchOptions ?? []) {
    const raw = overrides?.[opt.key] ?? settings[opt.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) out[opt.key] = value;
  }
  return out;
}

/** Pull the launch-option values already baked into a session's providerData
 *  (used to preserve per-session choices across restart). */
export function pickLaunchOptionOverrides(
  providerId: string,
  providerData: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const opt of getProvider(providerId)?.launchOptions ?? []) {
    const v = providerData?.[opt.key];
    if (typeof v === "string" && v) out[opt.key] = v;
  }
  return out;
}
