import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { discoverCliSessions } from "@/providers/claude-code/discovery";
import { detectClaude } from "@/providers/claude-code/types";
import { discoverCodexSessions } from "@/providers/codex/discovery";
import { detectCodex } from "@/providers/codex/types";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";

type ProviderId = "claude-code" | "codex";

type ReadinessStatus = "ready" | "notInstalled" | "customPathInvalid" | "available" | "notEnabled";

interface ProviderScanPreview<T> {
  sessions: T[];
  inspectionFailed: boolean;
}

interface ClaudeDiscoveredSession {
  session_id: string;
  project_path: string;
  title: string;
  model: string | null;
  last_activity_at: number;
  provider_file_path: string;
  is_active: boolean;
}

interface CodexDiscoveredSession {
  thread_id: string;
  project_path: string;
  title: string;
  model: string | null;
  last_activity_at: number;
  rollout_path: string;
  is_active: boolean;
}

interface ProviderHistoryPreview {
  id: string;
  title: string;
  model: string | null;
  providerId: ProviderId;
  repoPath: string;
  lastActivityAt: number;
}

interface ProviderHistorySummary {
  alreadyImportedCount: number;
  importableCount: number;
  runningCount: number;
  preview: ProviderHistoryPreview[];
}

export interface ProviderSetupReadiness {
  id: ProviderId;
  displayName: string;
  cliPath: string;
  status: ReadinessStatus;
  version: string | null;
  detail: string;
  history: ProviderHistorySummary;
}

interface ToolSetupReadiness {
  id: "notifications";
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface SetupAssistantSnapshot {
  providers: ProviderSetupReadiness[];
  tools: ToolSetupReadiness[];
  totalImportableCount: number;
}

function getExistingClaudeIdentitySets() {
  const sessions = Object.values(useSessionStore.getState().sessions);
  const sessionIds = new Set<string>();
  const filePaths = new Set<string>();

  for (const session of sessions) {
    if (session.provider !== "claude-code") continue;
    const providerData = session.providerData ?? {};
    const sessionId = providerData.sessionId;
    const filePath = providerData.filePath;
    if (typeof sessionId === "string") sessionIds.add(sessionId);
    if (typeof filePath === "string") filePaths.add(filePath);
  }

  return { filePaths, sessionIds };
}

function getExistingCodexIdentitySets() {
  const sessions = Object.values(useSessionStore.getState().sessions);
  const threadIds = new Set<string>();
  const rolloutPaths = new Set<string>();

  for (const session of sessions) {
    if (session.provider !== "codex") continue;
    const providerData = session.providerData ?? {};
    const threadId = providerData.threadId;
    const rolloutPath = providerData.rolloutPath;
    if (typeof threadId === "string") threadIds.add(threadId);
    if (typeof rolloutPath === "string") rolloutPaths.add(rolloutPath);
  }

  return { rolloutPaths, threadIds };
}

function summarizeClaudeHistory(sessions: ClaudeDiscoveredSession[]): ProviderHistorySummary {
  const existing = getExistingClaudeIdentitySets();
  const importable = sessions.filter(
    (session) =>
      !session.is_active &&
      !existing.sessionIds.has(session.session_id) &&
      !existing.filePaths.has(session.provider_file_path),
  );
  const alreadyImported = sessions.filter(
    (session) =>
      !session.is_active &&
      (existing.sessionIds.has(session.session_id) ||
        existing.filePaths.has(session.provider_file_path)),
  );
  const running = sessions.filter((session) => session.is_active);

  return {
    alreadyImportedCount: alreadyImported.length,
    importableCount: importable.length,
    runningCount: running.length,
    preview: importable
      .sort((a, b) => b.last_activity_at - a.last_activity_at)
      .slice(0, 3)
      .map((session) => ({
        id: session.session_id,
        title: session.title,
        model: session.model,
        providerId: "claude-code",
        repoPath: session.project_path,
        lastActivityAt: session.last_activity_at,
      })),
  };
}

function summarizeCodexHistory(sessions: CodexDiscoveredSession[]): ProviderHistorySummary {
  const existing = getExistingCodexIdentitySets();
  const importable = sessions.filter(
    (session) =>
      !session.is_active &&
      !existing.threadIds.has(session.thread_id) &&
      !existing.rolloutPaths.has(session.rollout_path),
  );
  const alreadyImported = sessions.filter(
    (session) =>
      !session.is_active &&
      (existing.threadIds.has(session.thread_id) ||
        existing.rolloutPaths.has(session.rollout_path)),
  );
  const running = sessions.filter((session) => session.is_active);

  return {
    alreadyImportedCount: alreadyImported.length,
    importableCount: importable.length,
    runningCount: running.length,
    preview: importable
      .sort((a, b) => b.last_activity_at - a.last_activity_at)
      .slice(0, 3)
      .map((session) => ({
        id: session.thread_id,
        title: session.title,
        model: session.model,
        providerId: "codex",
        repoPath: session.project_path,
        lastActivityAt: session.last_activity_at,
      })),
  };
}

async function loadProviderScanPreview<T>(
  command: "scan_cli_sessions" | "scan_codex_sessions",
  enabled: boolean,
): Promise<ProviderScanPreview<T>> {
  if (!enabled) {
    return { sessions: [], inspectionFailed: false };
  }

  try {
    return {
      sessions: await invoke<T[]>(command),
      inspectionFailed: false,
    };
  } catch (error) {
    console.error(`[setup-assistant] Failed to inspect ${command}:`, error);
    return {
      sessions: [],
      inspectionFailed: true,
    };
  }
}

function describeProviderStatus(
  status: ReadinessStatus,
  version: string | null,
  cliPath: string,
  options?: { inspectionFailed?: boolean },
) {
  switch (status) {
    case "ready":
      if (options?.inspectionFailed) {
        return "Ready, but AgTower could not inspect provider sessions yet";
      }
      return version ? `Ready • ${version}` : "Ready";
    case "available":
      if (options?.inspectionFailed) {
        return "Installed, but AgTower could not inspect provider sessions";
      }
      return version ? `Installed • ${version}` : "Installed";
    case "customPathInvalid":
      return cliPath ? `Custom path not found: ${cliPath}` : "Custom CLI path is invalid";
    case "notInstalled":
      return "Not installed";
    default:
      return "Available";
  }
}

export async function loadSetupAssistantSnapshot(): Promise<SetupAssistantSnapshot> {
  const providerSettings = useSettingsStore.getState().providerSettings;
  const claudeCliPath =
    (providerSettings["claude-code"]?.cliPath as string | undefined)?.trim() ?? "";
  const codexCliPath = (providerSettings.codex?.cliPath as string | undefined)?.trim() ?? "";

  const [claudeInfo, codexInfo, claudeScan, codexScan, notificationsGranted] = await Promise.all([
    detectClaude(claudeCliPath).catch(() => ({ available: false, version: null })),
    detectCodex(codexCliPath).catch(() => ({ available: false, version: null })),
    loadProviderScanPreview<ClaudeDiscoveredSession>("scan_cli_sessions", true),
    loadProviderScanPreview<CodexDiscoveredSession>("scan_codex_sessions", true),
    isPermissionGranted().catch(() => false),
  ]);

  const claudeStatus: ReadinessStatus = claudeInfo.available
    ? "ready"
    : claudeCliPath
      ? "customPathInvalid"
      : "notInstalled";
  const codexStatus: ReadinessStatus = codexInfo.available
    ? "ready"
    : codexCliPath
      ? "customPathInvalid"
      : "notInstalled";

  const providers: ProviderSetupReadiness[] = [
    {
      id: "claude-code",
      displayName: "Claude Code",
      cliPath: claudeCliPath,
      status: claudeStatus,
      version: claudeInfo.version,
      detail: describeProviderStatus(claudeStatus, claudeInfo.version, claudeCliPath, {
        inspectionFailed: claudeScan.inspectionFailed,
      }),
      history: summarizeClaudeHistory(claudeScan.sessions),
    },
    {
      id: "codex",
      displayName: "Codex",
      cliPath: codexCliPath,
      status: codexStatus,
      version: codexInfo.version,
      detail: describeProviderStatus(codexStatus, codexInfo.version, codexCliPath, {
        inspectionFailed: codexScan.inspectionFailed,
      }),
      history: summarizeCodexHistory(codexScan.sessions),
    },
  ];

  const notificationsStatus: ReadinessStatus = notificationsGranted ? "ready" : "notEnabled";

  const tools: ToolSetupReadiness[] = [
    {
      id: "notifications",
      label: "Notifications",
      status: notificationsStatus,
      detail: notificationsGranted ? "Enabled" : "Not enabled yet",
    },
  ];

  return {
    providers,
    tools,
    totalImportableCount: providers.reduce(
      (total, provider) => total + provider.history.importableCount,
      0,
    ),
  };
}

export async function importProviderHistory(providerId: ProviderId) {
  if (providerId === "claude-code") {
    return discoverCliSessions();
  }

  return discoverCodexSessions();
}
