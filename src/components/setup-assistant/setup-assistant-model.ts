import type { ElementType } from "react";
import { IS_MACOS } from "@/lib/platform";
import type { ProviderSetupReadiness } from "@/lib/setup-assistant";

export type SetupAssistantMode = "onboarding" | "settings";
export type SetupAssistantStep =
  | "welcome"
  | "demo"
  | "system"
  | "history"
  | "provider"
  | "notifications";

export type ProviderChoice = "claude-code" | "codex";

export type DemoView = "dashboard" | "session";
type DemoTheme = "dark" | "light";
export type DemoSessionId = "observer-race" | "webhook-retries" | "release-notes";
type DemoCommandId =
  | "open-dashboard"
  | "open-session"
  | "close-session"
  | "switch-dark"
  | "switch-light";
export type SetupPaletteCommandId =
  | DemoCommandId
  | "start-onboarding"
  | "restart-welcome-animation"
  | "next-step"
  | "previous-step"
  | "refresh-system"
  | "history-auto"
  | "history-manual"
  | "notifications-on"
  | "notifications-off"
  | "open-website"
  | "star-repo"
  | "finish-flow"
  | `provider:${ProviderChoice}`;
export type DemoKanbanStatus = "running" | "attention" | "idle";

export const DEMO_PALETTE_GROUP_ORDER = ["This Screen", "Navigation", "Appearance"] as const;

export interface DemoCommand {
  id: SetupPaletteCommandId;
  title: string;
  detail: string;
  group: "This Screen" | "Navigation" | "Appearance";
  icon: ElementType;
  aliases?: string[];
  keywords?: string[];
}

export interface DemoSessionEntry {
  id: string;
  text: string;
}

interface DemoSessionLine {
  kind: "command" | "muted" | "output";
  text: string;
}

interface DemoSessionDefinition {
  id: DemoSessionId;
  title: string;
  repo: string;
  provider: ProviderChoice;
  providerLabel: "Claude" | "Codex";
  status: DemoKanbanStatus;
  ageLabel: string;
  cardMeta: string;
  lines: readonly DemoSessionLine[];
}

const FULLSCREEN_STEPS: SetupAssistantStep[] = [
  "welcome",
  "demo",
  "system",
  "history",
  "provider",
  "notifications",
];

const SETTINGS_STEPS: SetupAssistantStep[] = ["system", "history", "provider", "notifications"];

export const DEFAULT_DEMO_SESSION_ID: DemoSessionId = "webhook-retries";

export const DEMO_SESSIONS: readonly DemoSessionDefinition[] = [
  {
    id: "observer-race",
    title: "Observer race",
    repo: "agtower",
    provider: "claude-code",
    providerLabel: "Claude",
    status: "running",
    ageLabel: "12m",
    cardMeta: "12 turns",
    lines: [
      { kind: "command", text: "git status" },
      { kind: "muted", text: "working tree clean" },
      { kind: "command", text: "pnpm build" },
      { kind: "muted", text: "Build completed in 3.4s" },
      { kind: "command", text: 'rg "observer" src' },
      { kind: "muted", text: "src/lib/observer.ts" },
      { kind: "command", text: "tail -f logs/observer.log" },
      { kind: "output", text: "observer: reconnect scheduled" },
      { kind: "output", text: "observer: session registry warmed" },
      { kind: "output", text: "observer: race condition no longer reproduces" },
    ],
  },
  {
    id: "webhook-retries",
    title: "Webhook retries",
    repo: "payments-api",
    provider: "codex",
    providerLabel: "Codex",
    status: "attention",
    ageLabel: "Now",
    cardMeta: "Needs input",
    lines: [
      { kind: "command", text: "git checkout codex/webhook-retries" },
      { kind: "muted", text: "Switched to branch 'codex/webhook-retries'" },
      { kind: "command", text: "pnpm exec vitest retries.test.ts" },
      { kind: "muted", text: "PASS src/lib/retries.test.ts (4)" },
      { kind: "command", text: 'rg "retryWindow" src' },
      { kind: "muted", text: "src/lib/retries.ts" },
      { kind: "command", text: "tail -f logs/worker.log" },
      { kind: "output", text: "worker: retry scheduled for evt_12ab9" },
      { kind: "output", text: "worker: backoff 8000ms" },
      { kind: "output", text: "worker: delivery succeeded" },
    ],
  },
  {
    id: "release-notes",
    title: "Release notes",
    repo: "docs",
    provider: "claude-code",
    providerLabel: "Claude",
    status: "idle",
    ageLabel: "Idle",
    cardMeta: "11 turns",
    lines: [
      { kind: "command", text: "git status" },
      { kind: "muted", text: "working tree clean" },
      { kind: "command", text: "pnpm docs:check" },
      { kind: "muted", text: "0 warnings across release notes" },
      { kind: "command", text: 'rg "April" docs/release-notes' },
      { kind: "muted", text: "docs/release-notes/april.md" },
      { kind: "command", text: "tail -n 20 docs/release-notes/april.md" },
      { kind: "output", text: "Added setup assistant polish notes" },
      { kind: "output", text: "Updated provider import wording" },
      { kind: "output", text: "Waiting for final review before publish" },
    ],
  },
];

export function getStepSequence(mode: SetupAssistantMode) {
  return mode === "onboarding" ? FULLSCREEN_STEPS : SETTINGS_STEPS;
}

export function getDemoSessionById(id: DemoSessionId) {
  return DEMO_SESSIONS.find((session) => session.id === id) ?? DEMO_SESSIONS[1];
}

export function getStepLabel(step: SetupAssistantStep) {
  switch (step) {
    case "welcome":
      return "Start";
    case "demo":
      return "Demo";
    case "system":
      return "System";
    case "history":
      return "Import";
    case "provider":
      return "Provider";
    case "notifications":
      return "Finish";
  }
}

export function getPlatformCommandLabel() {
  return IS_MACOS ? "Cmd+K" : "Ctrl+K";
}

export function compactPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function statusTone(status: ProviderSetupReadiness["status"] | "notEnabled") {
  switch (status) {
    case "ready":
      return "bg-success/12 text-success";
    case "available":
      return "bg-warning/12 text-warning-foreground";
    case "customPathInvalid":
      return "bg-destructive/12 text-destructive";
    case "notInstalled":
      return "bg-muted text-muted-foreground";
    case "notEnabled":
      return "bg-warning/12 text-warning-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function statusLabel(status: ProviderSetupReadiness["status"] | "notEnabled") {
  switch (status) {
    case "ready":
      return "Ready";
    case "available":
      return "Needs Attention";
    case "customPathInvalid":
      return "Path issue";
    case "notInstalled":
      return "Not installed";
    case "notEnabled":
      return "Off";
  }
}

export function normalizeDemoSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function scoreDemoSearch(candidate: string, query: string): number {
  if (!candidate || !query) return 0;
  if (candidate === query) return 140;
  if (candidate.startsWith(query)) return 120 - Math.min(candidate.length - query.length, 20);

  const exactIndex = candidate.indexOf(query);
  if (exactIndex >= 0) {
    return 96 - exactIndex * 0.6 + Math.min(query.length * 0.8, 16);
  }

  let qIndex = 0;
  let streak = 0;
  let score = 0;

  for (let index = 0; index < candidate.length && qIndex < query.length; index += 1) {
    if (candidate[index] === query[qIndex]) {
      streak += 1;
      score += 5 + streak * 2;
      qIndex += 1;
    } else {
      streak = 0;
      score -= 0.15;
    }
  }

  if (qIndex !== query.length) return 0;
  return Math.max(score - candidate.length * 0.04, 1);
}

export function resolveDemoTheme(theme: "system" | DemoTheme): DemoTheme {
  if (theme === "dark" || theme === "light") return theme;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export const DEMO_TONE = {
  toolbar: "border-border/70 bg-muted/35",
  title: "text-foreground",
  muted: "text-muted-foreground",
  terminalSurface: "border-border/70 bg-card",
  terminalBg: "bg-background",
  terminalText: "text-foreground",
  terminalPrompt: "text-primary",
  terminalMuted: "text-muted-foreground",
} as const;
