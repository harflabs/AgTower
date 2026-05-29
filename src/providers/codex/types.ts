// --- Codex provider-specific types ---

import { invoke } from "@tauri-apps/api/core";

/** Codex CLI detection result */
interface CodexInfo {
  available: boolean;
  version: string | null;
}

/** Detect if Codex CLI is available */
export async function detectCodex(cliPath?: string): Promise<CodexInfo> {
  return invoke<CodexInfo>("detect_codex", { cliPath: cliPath?.trim() || null });
}

/** Transient live data specific to Codex sessions */
interface CodexLiveData {
  activeTool: string | null;
  isThinking: boolean;
  activeCommand: string | null;
  activeCommandCwd: string | null;
  contextWindowPercent: number | null;
  totalTokens: number | null;
  lastTurnTokens: number | null;
  rateLimitPercent: number | null;
  filesChanged: string[];
  activeSubagents: number;
  apiError: { message: string; retryAttempt?: number } | null;
  turnId: string | null;
  waitingForApproval: boolean;
}

/** Extract Codex live data from a session's liveProviderData blob */
export function getCodexLiveData(session: {
  liveProviderData: Record<string, unknown>;
}): CodexLiveData {
  const d = session.liveProviderData ?? {};
  return {
    activeTool: (d.activeTool as string) ?? null,
    isThinking: (d.isThinking as boolean) ?? false,
    activeCommand: (d.activeCommand as string) ?? null,
    activeCommandCwd: (d.activeCommandCwd as string) ?? null,
    contextWindowPercent: (d.contextWindowPercent as number) ?? null,
    totalTokens: (d.totalTokens as number) ?? null,
    lastTurnTokens: (d.lastTurnTokens as number) ?? null,
    rateLimitPercent: (d.rateLimitPercent as number) ?? null,
    filesChanged: (d.filesChanged as string[]) ?? [],
    activeSubagents: (d.activeSubagents as number) ?? 0,
    apiError: (d.apiError as CodexLiveData["apiError"]) ?? null,
    turnId: (d.turnId as string) ?? null,
    waitingForApproval: (d.waitingForApproval as boolean) ?? false,
  };
}
