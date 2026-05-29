/**
 * Provider abstraction interfaces.
 *
 * Each AI coding assistant (Claude Code, Codex, etc.) implements these
 * interfaces to plug into AgTower's session management, rendering, and settings.
 */

import type { ComponentType } from "react";
import type { Session } from "@/stores/session-store";

export type PtyLaunchSpec =
  | {
      kind: "loginShell";
    }
  | {
      kind: "process";
      program: string;
      args: string[];
      env?: Record<string, string>;
    };

export interface ProviderLauncherConfig {
  buildPtyLaunch: (session: Session, mode: "new" | "resume") => PtyLaunchSpec;
}

interface ProviderSettingsConfig {
  SettingsSection: ComponentType;
}

interface LaunchOptionChoice {
  value: string; // "" = provider default -> flag omitted entirely
  label: string;
}

export interface LaunchOption {
  key: string; // settings key AND providerData key (provider-owned, may differ per provider)
  label: string;
  description?: string; // optional helper line
  choices: LaunchOptionChoice[]; // first entry should be the "" = "Provider default" option
}

/** Result of a CLI availability probe — whether the binary can be invoked
 *  and, when known, the version string for display. */
interface ProviderAvailability {
  available: boolean;
  version: string | null;
}

export interface ProviderModule {
  id: string;
  displayName: string;
  assistantDisplayName: string;
  launcher: ProviderLauncherConfig;
  settings: ProviderSettingsConfig;

  /** Provider-declared launch options surfaced as defaults in Settings and
   *  per-session overrides in the New Session dialog. Each provider owns its
   *  own keys/values — providers do NOT share option keys. */
  launchOptions?: LaunchOption[];

  /** Probe whether the provider's CLI is available. The cliPath argument
   *  is the user's optional override from settings; when empty, the
   *  detector should fall back to PATH. Optional so providers that don't
   *  have a probe story (yet) still load — they'll be treated as
   *  always-available by the availability store. */
  detect?: (cliPath?: string) => Promise<ProviderAvailability>;

  formatModelName?: (model: string) => string;
  preprocessPrompt?: (prompt: string) => string;
  getActivityText?: (session: Session) => string | null;
  formatTokenSummary?: (session: Session) => string | null;
  getProviderSessionId?: (session: Session) => string | null;
}

export interface DiscoveryResult {
  imported: number;
  skipped: number;
  errors: number;
}
