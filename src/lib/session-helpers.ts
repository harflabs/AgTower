import { getAllProviders } from "@/providers/registry";
import type { Session } from "@/stores/session-store";

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Shell prompt characters (unambiguous — almost exclusively prompt markers)
const UNICODE_PROMPT_CHARS = ["➜", "❯", "❮", "λ", "›"];

/**
 * Detect a shell command from terminal output.
 * Looks for lines starting with common shell prompt characters.
 */
function detectShellCommand(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const ch of UNICODE_PROMPT_CHARS) {
      if (trimmed.startsWith(ch)) {
        const cmd = trimmed.slice(ch.length).trim();
        if (cmd) return cmd;
      }
    }

    if (trimmed.startsWith("$ ") || trimmed.startsWith("% ")) {
      const cmd = trimmed.slice(2).trim();
      if (cmd) return cmd;
    }
  }
  return null;
}

/** Check if text looks like npm/pnpm/yarn script output (e.g., "agtower@0.1.0 tauri /path") */
function isNpmScriptOutput(text: string): boolean {
  if (!text.includes("@")) return false;
  const first = text.split(/\s+/)[0];
  return first?.includes("@") && /\d/.test(first);
}

/** Pre-process text line by line to remove terminal noise. */
function cleanTerminalLines(text: string): string {
  const lines: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip npm/pnpm script output: "> package@version script /path"
    if (trimmed.startsWith(">")) {
      const afterGt = trimmed.slice(1).trim();
      if (isNpmScriptOutput(afterGt)) continue;
    }

    // Strip prompt characters
    let cleaned = trimmed;
    for (const ch of UNICODE_PROMPT_CHARS) {
      if (cleaned.startsWith(ch)) {
        cleaned = cleaned.slice(ch.length).trim();
        break;
      }
    }
    if (cleaned.startsWith("$ ") || cleaned.startsWith("% ") || cleaned.startsWith("# ")) {
      cleaned = cleaned.slice(2).trim();
    }

    // Skip bare file paths
    if (cleaned.startsWith("/") && !cleaned.includes(" ")) continue;

    if (cleaned) lines.push(cleaned);
  }

  return lines.length > 0 ? lines.join("\n") : text;
}

/** Remove remaining terminal noise from a collapsed single-line title. */
function stripTerminalNoise(text: string): string {
  const words = text.split(/\s+/);
  const result: string[] = [];

  let i = 0;
  while (i < words.length) {
    const word = words[i];

    // Skip npm script output: "package@version" optionally followed by scriptname + path
    if (word.includes("@") && /\d/.test(word)) {
      if (i + 1 < words.length && words[i + 1].startsWith("/")) {
        i += 2;
        continue;
      }
      if (i + 2 < words.length && words[i + 2].startsWith("/")) {
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    // Skip bare absolute paths
    if (word.startsWith("/") && word.length > 4) {
      i += 1;
      continue;
    }

    result.push(word);
    i += 1;
  }

  const joined = result.join(" ");
  return joined || text;
}

export function generateSessionTitle(prompt: string, providerId?: string): string {
  // Let the active provider preprocess the prompt (e.g., strip CLI metadata tags)
  let processed = prompt;
  if (providerId) {
    for (const provider of getAllProviders()) {
      if (provider.id === providerId && provider.preprocessPrompt) {
        processed = provider.preprocessPrompt(prompt);
        // If preprocessor extracted a clean command name (shorter than original), use it directly
        if (processed !== prompt && processed.length < prompt.length / 2) {
          return humanizeSlug(processed);
        }
        break;
      }
    }
  }

  const slashMatch = processed.match(/^\/([\w-]+)/);
  if (slashMatch) {
    return humanizeSlug(slashMatch[1]);
  }

  // Detect shell command from terminal output
  const shellCmd = detectShellCommand(processed);
  if (shellCmd) {
    const chars = [...shellCmd];
    if (chars.length <= 60) return shellCmd;
    return `${chars.slice(0, 57).join("")}...`;
  }

  // Pre-process terminal noise
  const preprocessed = cleanTerminalLines(processed);
  const text = stripTerminalNoise(preprocessed.trim().replace(/\s+/g, " "));
  if (!text) return "New Session";

  const chars = [...text];
  if (chars.length <= 60) return text;
  return `${chars.slice(0, 57).join("")}...`;
}

export function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatModelName(model: string): string {
  // Try each provider's formatter — first match wins
  for (const provider of getAllProviders()) {
    if (provider.formatModelName) {
      const formatted = provider.formatModelName(model);
      if (formatted !== model) return formatted;
    }
  }
  // Generic fallback: strip common prefixes, titlecase
  return model.replace(/^[\w]+-/, "");
}

export type KanbanColumnKey = "running" | "idle" | "attention";

interface KanbanColumn {
  key: KanbanColumnKey;
  label: string;
  sessions: Session[];
}

const COLUMN_LABELS: Record<KanbanColumnKey, string> = {
  running: "Running",
  attention: "Attention",
  idle: "Idle",
};

function sessionActivity(session: Session): number {
  return session.endedAt ?? session.createdAt;
}

/** Group active sessions into the three dashboard kanban columns. */
export function computeKanbanColumns(
  sessions: Record<string, Session>,
  workspaceFilter: string | null,
  providerFilter: string | null,
): KanbanColumn[] {
  const buckets: Record<KanbanColumnKey, Session[]> = {
    running: [],
    attention: [],
    idle: [],
  };

  for (const session of Object.values(sessions)) {
    if (workspaceFilter && session.repoId !== workspaceFilter) continue;
    if (providerFilter && session.provider !== providerFilter) continue;

    if (session.status === "running") {
      buckets.running.push(session);
    } else if (session.status === "needsAttention") {
      buckets.attention.push(session);
    } else if (session.status === "idle") {
      buckets.idle.push(session);
    }
  }

  const order: KanbanColumnKey[] = ["running", "attention", "idle"];
  return order.map((key) => ({
    key,
    label: COLUMN_LABELS[key],
    sessions: buckets[key].sort((a, b) => sessionActivity(b) - sessionActivity(a)),
  }));
}
