// --- Claude Code provider-specific types ---

import { invoke } from "@tauri-apps/api/core";

/** Claude CLI detection result */
interface ClaudeInfo {
  available: boolean;
  version: string | null;
}

/** Detect if Claude CLI is available */
export async function detectClaude(cliPath?: string): Promise<ClaudeInfo> {
  return invoke<ClaudeInfo>("detect_claude", { cliPath: cliPath?.trim() || null });
}
