/**
 * Codex provider-specific formatting functions.
 */

import { formatTokens } from "@/lib/session-helpers";
import { getCodexLiveData } from "@/providers/codex/types";
import type { Session } from "@/stores/session-store";

/**
 * Format Codex model IDs to human-readable names.
 */
export function formatCodexModelName(model: string): string {
  const names: Record<string, string> = {
    "gpt-4.1-nano": "GPT-4.1 Nano",
    "gpt-4.1-mini": "GPT-4.1 Mini",
    "gpt-4.1": "GPT-4.1",
    "o4-mini": "o4 Mini",
    "o3-mini": "o3 Mini",
    o3: "o3",
    "o3-pro": "o3 Pro",
    o4: "o4",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4.5-preview": "GPT-4.5 Preview",
    "gpt-5": "GPT-5",
    "gpt-5.1": "GPT-5.1",
    "gpt-5.1-mini": "GPT-5.1 Mini",
    "codex-mini-latest": "Codex Mini",
    "codex-mini": "Codex Mini",
  };
  if (names[model]) return names[model];
  // Fallback: capitalize first letter and replace hyphens with spaces
  return model.charAt(0).toUpperCase() + model.slice(1).replace(/-/g, " ");
}

/**
 * Get Codex's thread ID from provider data.
 */
export function getCodexProviderSessionId(session: Session): string | null {
  return (session.providerData?.threadId as string) ?? null;
}

/**
 * Format a token summary for Codex sessions.
 * Richer format with reasoning tokens and cache percentage.
 */
export function formatCodexTokenSummary(session: Session): string | null {
  const cacheRead = session.totalCacheReadTokens ?? 0;
  const totalIn = (session.totalInputTokens ?? 0) + cacheRead;
  const totalOut = session.totalOutputTokens ?? 0;
  if (totalIn === 0 && totalOut === 0) return null;

  const parts: string[] = [];
  parts.push(`${formatTokens(totalIn)} in`);
  parts.push(`${formatTokens(totalOut)} out`);

  if (cacheRead > 0 && totalIn > 0) {
    const cachePercent = Math.round((cacheRead / totalIn) * 100);
    parts.push(`${cachePercent}% cached`);
  }

  return parts.join(" · ");
}

/**
 * Get activity text for a running Codex session.
 * Priority: API error > waiting for approval > thinking > active tool > active command > sub-agents.
 */
export function getCodexActivityText(session: Session): string | null {
  const live = getCodexLiveData(session);

  // 1. API error (highest priority)
  if (live.apiError) {
    return live.apiError.retryAttempt
      ? `Error (retry ${live.apiError.retryAttempt})`
      : `Error: ${live.apiError.message}`;
  }

  // 2. Waiting for approval
  if (live.waitingForApproval) return "Waiting for approval...";

  // 3. Thinking
  if (live.isThinking) return "Thinking...";

  // 4. Active tool with enriched name
  if (live.activeTool) return live.activeTool;

  // 5. Active command
  if (live.activeCommand) return `Running: ${live.activeCommand}`;

  // 6. Sub-agents
  if (live.activeSubagents > 0) return `${live.activeSubagents} agent(s) working`;

  return null;
}
