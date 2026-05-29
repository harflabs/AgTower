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
