import { formatTokens } from "@/lib/session-helpers";
import type { Session } from "@/stores/session-store";

export function formatClaudeModelName(model: string): string {
  return model
    .replace("claude-opus-4-6[1m]", "Opus 4.6")
    .replace("claude-opus-4-6", "Opus 4.6")
    .replace("claude-sonnet-4-6", "Sonnet 4.6")
    .replace("claude-haiku-4-5-20251001", "Haiku 4.5")
    .replace("claude-opus-4-5-20251101", "Opus 4.5")
    .replace("claude-sonnet-4-5-20250929", "Sonnet 4.5")
    .replace(/^claude-/, "");
}

export function preprocessClaudePrompt(prompt: string): string {
  const cmdMatch = prompt.match(/<command-message>\s*([^<]+)/);
  if (cmdMatch) {
    const cmdName = cmdMatch[1].trim().replace(/\s*<\/command-message>.*/, "");
    if (cmdName) return cmdName;
  }

  let text = prompt;
  text = text.replace(/<local-command-caveat>[\s\S]*?(<\/local-command-caveat>|$)/g, "");
  text = text.replace(/<command-name>[\s\S]*?(<\/command-name>|$)/g, "");
  text = text.replace(/<command-args>[\s\S]*?(<\/command-args>|$)/g, "");
  text = text.replace(/<[^>]*>?/g, "");
  return text;
}

export function getClaudeProviderSessionId(session: Session): string | null {
  return (session.providerData?.sessionId as string) ?? null;
}

export function formatClaudeTokenSummary(session: Session): string | null {
  const totalIn = (session.totalInputTokens ?? 0) + (session.totalCacheReadTokens ?? 0);
  const totalOut = session.totalOutputTokens ?? 0;
  if (totalIn === 0 && totalOut === 0) return null;
  const lpd = (session.liveProviderData ?? {}) as Record<string, unknown>;
  const compactions = (lpd.compactionCount as number) ?? 0;
  const base = `${formatTokens(totalIn + totalOut)} tokens`;
  if (compactions > 0) return `${base} (${compactions}x compact)`;
  return base;
}

export function getClaudeActivityText(session: Session): string | null {
  const lpd = (session.liveProviderData ?? {}) as Record<string, unknown>;

  const apiError = lpd.apiError as
    | { message: string; retryAttempt: number; maxRetries: number }
    | undefined;
  if (apiError) {
    return `API error, retrying (${apiError.retryAttempt}/${apiError.maxRetries})...`;
  }

  if (lpd.isThinking) return "Thinking...";
  if (typeof lpd.activeTool === "string") return lpd.activeTool;

  if (typeof lpd.taskSummary === "string" && session.status === "running") {
    return lpd.taskSummary;
  }

  if (typeof lpd.waitingFor === "string" && session.status === "needsAttention") {
    return lpd.waitingFor;
  }

  return null;
}
