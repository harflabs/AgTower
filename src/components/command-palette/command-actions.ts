import { toast } from "sonner";
import { confirmDestructiveAction } from "@/lib/native-dialog";
import {
  buildSessionPath,
  navigateToSessionTarget,
  resolveAdjacentOpenSessionTarget,
} from "@/lib/session-navigation";
import { useModalStore } from "@/stores/modal-store";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import {
  createDangerItems,
  createSessionItems,
  createWorkspaceItems,
} from "./command-action-records";
import {
  createAutoArchiveItems,
  createNotificationItems,
  createProviderItems,
  createStartupItems,
  createThemeItems,
} from "./command-action-settings";
import {
  buildActionPreview,
  buildOpenSessionCyclePreview,
  buildResumeShellCommand,
  buildScopedLaunchPreview,
  buildScopedPhraseAliases,
  buildSessionPreview,
  CLOSED_SESSION_STATUSES,
  findProvider,
  getLatestMatchingSession,
  getMatchingSessions,
  OPEN_SESSION_STATUSES,
  providerName,
  providerSessionName,
  STATUS_COMMANDS,
  sortRepositoriesForPalette,
} from "./command-action-shared";
import type { PaletteContext, PaletteItem } from "./model";

async function confirmBulkStop({
  count,
  message,
  title,
}: {
  count: number;
  message: string;
  title: string;
}) {
  if (count === 0) return false;
  return confirmDestructiveAction({
    title,
    message,
    okLabel: count === 1 ? "Stop" : "Stop Sessions",
  });
}

function createCoreCommands(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "command:new-session",
      kind: "command",
      title: "New Session",
      subtitle: "Start a new agent session",
      aliases: ["create session", "start session"],
      keywords: ["new", "create", "start", "session", "agent"],
      iconName: "Plus",
      group: "Commands",
      homeSection: "Create",
      homeOrder: 1,
      queryOrder: 96,
      shortcutActionId: "new-session",
      // Hide entirely when no provider's CLI is reachable. The dialog
      // filters its provider list separately, but offering "New Session"
      // in the palette when there's nothing to launch would dead-end the
      // user. Settings still surfaces a Refresh control they can use to
      // re-probe after installing a CLI.
      when: () => ctx.providers.length > 0,
      preview: {
        title: "New Session",
        summary: "Open the new session screen and start a fresh agent task.",
      },
      perform: () => useModalStore.getState().setNewSessionDialogOpen(true),
    },
    {
      id: "command:new-terminal",
      kind: "command",
      title: "New Terminal",
      subtitle: "Open a terminal session in the active workspace",
      aliases: ["terminal", "shell"],
      keywords: ["new", "terminal", "shell", "zsh", "bash"],
      iconName: "Terminal",
      group: "Commands",
      homeSection: "Create",
      homeOrder: 2,
      queryOrder: 86,
      shortcutActionId: "new-terminal",
      preview: {
        title: "New Terminal",
        summary: "Create a terminal session in the active workspace.",
      },
      perform: () => {
        window.dispatchEvent(new CustomEvent("new-terminal-session"));
      },
    },
    {
      id: "command:add-workspace",
      kind: "command",
      title: "Add Workspace",
      subtitle: "Import a repo or folder into AgTower",
      aliases: ["add repo", "add folder"],
      keywords: ["workspace", "repo", "folder", "directory", "add"],
      iconName: "FolderPlus",
      group: "Commands",
      homeSection: "Create",
      homeOrder: 3,
      queryOrder: 84,
      preview: {
        title: "Add Workspace",
        summary: "Open the folder picker and add a new workspace.",
      },
      perform: (runtime) => {
        void runtime.addRepository();
      },
    },
    {
      id: "command:sync-cli-sessions",
      kind: "command",
      title: "Sync CLI Sessions",
      subtitle: "Refresh imported CLI sessions",
      aliases: ["refresh sessions", "import sessions"],
      keywords: ["sync", "refresh", "import", "cli", "sessions"],
      iconName: "RefreshCw",
      group: "Commands",
      homeSection: "Create",
      homeOrder: 4,
      queryOrder: 82,
      shortcutActionId: "sync-cli-sessions",
      preview: {
        title: "Sync CLI Sessions",
        summary: "Re-scan the filesystem for existing CLI-created sessions.",
      },
      perform: () => {
        window.dispatchEvent(new CustomEvent("sync-cli-sessions"));
      },
    },
    {
      id: "command:dashboard",
      kind: "command",
      title: "Go to Dashboard",
      subtitle: "Open the main overview",
      aliases: ["dashboard", "home", "overview"],
      keywords: ["dashboard", "home", "overview"],
      iconName: "LayoutDashboard",
      group: "Commands",
      queryOrder: 78,
      shortcutActionId: "go-dashboard",
      preview: {
        title: "Dashboard",
        summary: "Open the main overview of all sessions.",
      },
      perform: (runtime) => runtime.navigate("/"),
    },
    {
      id: "command:settings",
      kind: "command",
      title: "Open Settings",
      subtitle: "Manage settings and provider configuration",
      aliases: ["settings", "config"],
      keywords: ["settings", "config"],
      iconName: "Settings",
      group: "Commands",
      queryOrder: 76,
      shortcutActionId: "go-settings",
      preview: {
        title: "Settings",
        summary: "Open AgTower settings and provider configuration.",
      },
      perform: (runtime) => runtime.navigate("/settings"),
    },
    {
      id: "command:keyboard-shortcuts",
      kind: "command",
      title: "Open Keyboard Shortcuts",
      subtitle: "See every registered shortcut",
      aliases: ["help", "shortcut modal"],
      keywords: ["keyboard", "shortcuts", "help"],
      iconName: "Keyboard",
      group: "Commands",
      queryOrder: 74,
      shortcutActionId: "shortcut-help",
      preview: {
        title: "Keyboard Shortcuts",
        summary: "Open the shortcut reference modal.",
      },
      perform: () => useModalStore.getState().setShortcutModalOpen(true),
    },
    {
      id: "command:focus-sidebar",
      kind: "command",
      title: "Focus Sidebar",
      subtitle: "Move keyboard focus to the sidebar tree",
      aliases: ["sidebar", "focus tree"],
      keywords: ["sidebar", "focus", "tree"],
      iconName: "PanelLeft",
      group: "Commands",
      queryOrder: 62,
      shortcutActionId: "focus-sidebar",
      preview: {
        title: "Focus Sidebar",
        summary: "Jump keyboard focus to the sidebar tree.",
      },
      perform: () => {
        const sidebar = useSidebarStore.getState();
        if (!sidebar.sidebarOpen) {
          sidebar.setSidebarOpen(true);
        }
        window.dispatchEvent(new CustomEvent("focus-sidebar-tree"));
      },
    },
  ];

  const repos = sortRepositoriesForPalette(ctx.repos);

  for (const repo of repos) {
    for (const provider of ctx.providers) {
      const sessionName = providerSessionName(provider.id, ctx);
      const title = `New ${sessionName} Session in ${repo.name}`;
      items.push({
        id: `command:new-provider-session:${provider.id}:${repo.id}`,
        kind: "command",
        title,
        subtitle: `${providerName(provider.id, ctx)} · ${repo.path}`,
        aliases: [
          `new session ${repo.name}`,
          `start session ${repo.name}`,
          `${sessionName} ${repo.name}`,
          `${sessionName} @ ${repo.name}`,
          `${sessionName}@${repo.name}`,
          `${provider.displayName} @ ${repo.name}`,
          `${provider.displayName}@${repo.name}`,
          provider.id,
          provider.displayName,
          repo.path,
        ],
        keywords: [
          "new",
          "session",
          "workspace",
          "repo",
          repo.name,
          repo.path,
          provider.id,
          provider.displayName,
          sessionName,
        ],
        iconName: "Cpu",
        group: "Commands",
        queryOrder: provider.id === ctx.settings.defaultProvider ? 95 : 92,
        shortcutActionId:
          repo.id === ctx.activeRepoId && provider.id === ctx.settings.defaultProvider
            ? "new-session"
            : undefined,
        preview: buildScopedLaunchPreview(
          title,
          `Start a ${sessionName} session directly in ${repo.path}.`,
          repo.name,
          repo.path,
          providerName(provider.id, ctx),
        ),
        meta: {
          repoId: repo.id,
          providerId: provider.id,
          pinned: repo.pinned,
        },
        perform: async (runtime) => {
          const sessionId = await runtime.startSession({
            prompt: "",
            providerId: provider.id,
            repoId: repo.id,
          });
          runtime.navigate(`/session/${sessionId}`);
        },
      });
    }

    items.push({
      id: `command:new-terminal:${repo.id}`,
      kind: "command",
      title: `New Terminal in ${repo.name}`,
      subtitle: repo.path,
      aliases: [`terminal ${repo.name}`, `shell ${repo.name}`, repo.path],
      keywords: ["new", "terminal", "shell", "workspace", "repo", repo.name, repo.path],
      iconName: "Terminal",
      group: "Commands",
      queryOrder: 90,
      shortcutActionId: repo.id === ctx.activeRepoId ? "new-terminal" : undefined,
      preview: buildScopedLaunchPreview(
        `New Terminal in ${repo.name}`,
        `Open a plain terminal in ${repo.path}.`,
        repo.name,
        repo.path,
        "Terminal",
      ),
      meta: {
        repoId: repo.id,
        pinned: repo.pinned,
      },
      perform: async (runtime) => {
        const sessionId = await runtime.startTerminalSession({ repoId: repo.id });
        runtime.navigate(`/session/${sessionId}`);
      },
    });
  }

  if (
    Object.values(ctx.sessions).some(
      (session) => session.status !== "closed" && session.status !== "archived",
    )
  ) {
    items.push({
      id: "command:next-open-session",
      kind: "command",
      title: "Next Open Session",
      subtitle: "Cycle to the next running, idle, or attention session",
      aliases: ["next session", "next open", "cycle open sessions"],
      keywords: ["next", "open", "session", "running", "idle", "attention"],
      iconName: "TerminalSquare",
      group: "Commands",
      queryOrder: 80,
      shortcutActionId: "next-open-session",
      preview: buildOpenSessionCyclePreview(ctx, "next"),
      perform: (runtime) => {
        const target = resolveAdjacentOpenSessionTarget(
          runtime.sessions,
          runtime.activeSessionId,
          "next",
        );
        if (target) {
          navigateToSessionTarget(target, runtime.navigate);
        }
      },
    });

    items.push({
      id: "command:prev-open-session",
      kind: "command",
      title: "Previous Open Session",
      subtitle: "Cycle to the previous running, idle, or attention session",
      aliases: ["previous session", "prev open", "cycle open sessions"],
      keywords: ["previous", "prev", "open", "session", "running", "idle", "attention"],
      iconName: "TerminalSquare",
      group: "Commands",
      queryOrder: 79,
      shortcutActionId: "prev-open-session",
      preview: buildOpenSessionCyclePreview(ctx, "prev"),
      perform: (runtime) => {
        const target = resolveAdjacentOpenSessionTarget(
          runtime.sessions,
          runtime.activeSessionId,
          "prev",
        );
        if (target) {
          navigateToSessionTarget(target, runtime.navigate);
        }
      },
    });
  }

  if (ctx.activeSessionId && ctx.activeSession) {
    items.push({
      id: `command:open-current-session:${ctx.activeSessionId}`,
      kind: "command",
      title: `Open ${ctx.activeSession.title || "Current Session"}`,
      subtitle: "Continue where you left off",
      aliases: ["continue session", "resume session"],
      keywords: ["continue", "resume", "session", ctx.activeSession.title],
      iconName: "CornerDownRight",
      group: "Commands",
      homeSection: "Continue",
      homeOrder: 1,
      queryOrder: 98,
      preview: buildSessionPreview(ctx, ctx.activeSessionId),
      meta: {
        sessionId: ctx.activeSessionId,
        repoId: ctx.activeSession.repoId,
        providerId: ctx.activeSession.provider,
        status: ctx.activeSession.status.toLowerCase(),
      },
      perform: (runtime) => runtime.navigate(`/session/${ctx.activeSessionId}`),
    });

    items.push({
      id: "command:rename-current",
      kind: "command",
      title: "Rename Current Session",
      subtitle: "Edit the current session title",
      aliases: ["rename session", "edit title"],
      keywords: ["rename", "title", "edit", "session"],
      iconName: "Pencil",
      group: "Commands",
      homeSection: "Continue",
      homeOrder: 3,
      queryOrder: 72,
      shortcutActionId: "rename-session",
      when: () => ctx.isOnSession,
      preview: {
        title: "Rename Current Session",
        summary: "Start renaming the active session.",
      },
      perform: () => {
        window.dispatchEvent(
          new CustomEvent("rename-active-session", {
            detail: ctx.activeSessionId,
          }),
        );
      },
    });

    items.push({
      id: "command:restart-current",
      kind: "command",
      title: "Restart Current Session",
      subtitle: "Restart the active session process",
      aliases: ["re-run session", "resume session"],
      keywords: ["restart", "resume", "session"],
      iconName: "RotateCcw",
      group: "Commands",
      homeSection: "Continue",
      homeOrder: 6,
      queryOrder: 76,
      when: () => ctx.isOnSession,
      preview: {
        title: "Restart Current Session",
        summary: "Restart the active session process and capture a fresh git baseline.",
      },
      perform: async (runtime) => {
        if (!runtime.activeSessionId) return;
        await runtime.restartSession(runtime.activeSessionId);
      },
    });

    if (
      ctx.activeSession.status === "running" ||
      ctx.activeSession.status === "needsAttention" ||
      ctx.activeSession.status === "idle"
    ) {
      items.push({
        id: "command:stop-current",
        kind: "command",
        title: "Stop Current Agent",
        subtitle: "Terminate the active session",
        aliases: ["stop agent", "kill current"],
        keywords: ["stop", "kill", "current", "agent"],
        iconName: "OctagonX",
        group: "Commands",
        homeSection: "Continue",
        homeOrder: 7,
        queryOrder: 88,
        preview: {
          title: "Stop Current Agent",
          summary: "Stop the active running or waiting session.",
        },
        perform: async (runtime) => {
          if (!runtime.activeSessionId) return;
          await runtime.stopSession(runtime.activeSessionId);
        },
      });
    }

    if (
      ctx.activeSession.status !== "running" &&
      ctx.activeSession.status !== "idle" &&
      ctx.activeSession.status !== "archived"
    ) {
      items.push({
        id: "command:archive-current",
        kind: "command",
        title: "Archive Current Session",
        subtitle: "Move the current session to Archived",
        aliases: ["mark done", "archive session"],
        keywords: ["archive", "mark done", "session"],
        iconName: "Archive",
        group: "Commands",
        homeSection: "Continue",
        homeOrder: 8,
        queryOrder: 82,
        preview: {
          title: "Archive Current Session",
          summary: "Archive the active session when you are done with it.",
        },
        perform: () => {
          if (!ctx.activeSessionId) return;
          useSessionStore.getState().archiveSession(ctx.activeSessionId);
        },
      });
    }
  }

  const activeRepo = ctx.activeRepo;
  if (activeRepo) {
    const activeRepoSessions = Object.values(ctx.sessions).filter(
      (session) =>
        session.repoId === activeRepo.id &&
        (session.status === "running" ||
          session.status === "needsAttention" ||
          session.status === "idle"),
    );
    if (activeRepoSessions.length > 0) {
      items.push({
        id: `command:stop-workspace:${activeRepo.id}`,
        kind: "command",
        title: `Stop All Agents in ${activeRepo.name}`,
        subtitle: "Terminate all active sessions in the current workspace",
        aliases: ["stop workspace agents", "kill repo sessions"],
        keywords: ["stop", "workspace", activeRepo.name, "agents"],
        iconName: "OctagonX",
        group: "Commands",
        queryOrder: 80,
        preview: {
          title: `Stop All Agents in ${activeRepo.name}`,
          summary:
            "Terminate all running, idle, and needs-attention sessions in the active workspace.",
        },
        perform: async (runtime) => {
          await runtime.stopSessionsInRepo(activeRepo.id);
        },
      });
    }
  }

  const anyActiveSessions = Object.values(ctx.sessions).some(
    (session) =>
      session.status === "running" ||
      session.status === "needsAttention" ||
      session.status === "idle",
  );
  if (anyActiveSessions) {
    items.push({
      id: "command:stop-all",
      kind: "command",
      title: "Stop All Agents",
      subtitle: "Terminate every active session",
      aliases: ["kill all agents", "stop all sessions"],
      keywords: ["stop", "kill", "all", "agents", "sessions"],
      iconName: "OctagonX",
      group: "Commands",
      queryOrder: 78,
      preview: {
        title: "Stop All Agents",
        summary: "Terminate every active running, idle, or needs-attention session.",
      },
      perform: async (runtime) => {
        await runtime.stopAllSessions();
      },
    });
  }

  return items;
}

function createScopedSessionCommandItems(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const repos = sortRepositoriesForPalette(ctx.repos);

  for (const repo of repos) {
    const latestSession = getLatestMatchingSession(ctx, { repoId: repo.id });
    if (latestSession) {
      items.push({
        id: `command:open-latest:${repo.id}`,
        kind: "command",
        title: `Open Latest Session in ${repo.name}`,
        subtitle: repo.path,
        aliases: [
          `latest ${repo.name}`,
          ...buildScopedPhraseAliases("latest", repo.name),
          ...buildScopedPhraseAliases("open latest", repo.name),
        ],
        keywords: ["latest", "session", "open", repo.name, repo.path],
        iconName: "History",
        group: "Commands",
        queryOrder: 89,
        preview: buildSessionPreview(ctx, latestSession.id),
        meta: {
          repoId: repo.id,
          providerId: latestSession.provider,
          sessionId: latestSession.id,
          status: latestSession.status.toLowerCase(),
        },
        perform: (runtime) =>
          navigateToSessionTarget(
            { kind: "session", repoId: latestSession.repoId, sessionId: latestSession.id },
            runtime.navigate,
          ),
      });
    }

    const latestClosedSession = getLatestMatchingSession(ctx, {
      repoId: repo.id,
      statuses: CLOSED_SESSION_STATUSES,
    });
    if (latestClosedSession) {
      items.push({
        id: `command:open-latest-closed:${repo.id}`,
        kind: "command",
        title: `Open Latest Closed Session in ${repo.name}`,
        subtitle: repo.path,
        aliases: [
          ...buildScopedPhraseAliases("latest closed", repo.name),
          ...buildScopedPhraseAliases("open latest closed", repo.name),
          ...buildScopedPhraseAliases("latest done", repo.name),
        ],
        keywords: ["latest", "closed", "done", "session", repo.name, repo.path],
        iconName: "History",
        group: "Commands",
        queryOrder: 85,
        preview: buildSessionPreview(ctx, latestClosedSession.id),
        meta: {
          repoId: repo.id,
          providerId: latestClosedSession.provider,
          sessionId: latestClosedSession.id,
          status: latestClosedSession.status.toLowerCase(),
        },
        perform: (runtime) =>
          navigateToSessionTarget(
            {
              kind: "session",
              repoId: latestClosedSession.repoId,
              sessionId: latestClosedSession.id,
            },
            runtime.navigate,
          ),
      });

      items.push({
        id: `command:resume-latest:${repo.id}`,
        kind: "command",
        title: `Resume Latest Session in ${repo.name}`,
        subtitle: repo.path,
        aliases: [
          ...buildScopedPhraseAliases("resume latest", repo.name),
          ...buildScopedPhraseAliases("resume latest session", repo.name),
        ],
        keywords: ["resume", "latest", "session", repo.name, repo.path],
        iconName: "RotateCcw",
        group: "Commands",
        queryOrder: 91,
        preview: buildSessionPreview(ctx, latestClosedSession.id),
        meta: {
          repoId: repo.id,
          providerId: latestClosedSession.provider,
          sessionId: latestClosedSession.id,
          status: latestClosedSession.status.toLowerCase(),
        },
        perform: (runtime) =>
          navigateToSessionTarget(
            {
              kind: "session",
              repoId: latestClosedSession.repoId,
              sessionId: latestClosedSession.id,
            },
            runtime.navigate,
            { resume: true },
          ),
      });
    }

    for (const statusCommand of STATUS_COMMANDS) {
      const target = getLatestMatchingSession(ctx, {
        repoId: repo.id,
        statuses: statusCommand.statuses,
      });
      if (!target) continue;

      items.push({
        id: `command:open-${statusCommand.label.toLowerCase()}:${repo.id}`,
        kind: "command",
        title: `Open Latest ${statusCommand.label} Session in ${repo.name}`,
        subtitle: repo.path,
        aliases: statusCommand.aliases.flatMap((alias) => [
          ...buildScopedPhraseAliases(alias, repo.name),
          ...buildScopedPhraseAliases(`latest ${alias}`, repo.name),
        ]),
        keywords: [statusCommand.label.toLowerCase(), "latest", "session", repo.name, repo.path],
        iconName: "TerminalSquare",
        group: "Commands",
        queryOrder: 87,
        preview: buildSessionPreview(ctx, target.id),
        meta: {
          repoId: repo.id,
          providerId: target.provider,
          sessionId: target.id,
          status: target.status.toLowerCase(),
        },
        perform: (runtime) =>
          navigateToSessionTarget(
            { kind: "session", repoId: target.repoId, sessionId: target.id },
            runtime.navigate,
          ),
      });
    }

    const activeSessionsInRepo = getMatchingSessions(ctx, {
      repoId: repo.id,
      statuses: OPEN_SESSION_STATUSES,
    });
    if (activeSessionsInRepo.length > 0) {
      items.push({
        id: `command:stop-active:${repo.id}`,
        kind: "command",
        title: `Stop Active Sessions in ${repo.name}`,
        subtitle: `${activeSessionsInRepo.length} running, idle, or attention session${activeSessionsInRepo.length === 1 ? "" : "s"}`,
        aliases: [
          ...buildScopedPhraseAliases("stop active", repo.name),
          ...buildScopedPhraseAliases("stop all", repo.name),
        ],
        keywords: ["stop", "active", "sessions", repo.name, repo.path],
        iconName: "OctagonX",
        group: "Commands",
        queryOrder: 82,
        preview: buildActionPreview(
          `Stop Active Sessions in ${repo.name}`,
          "Terminate all running, idle, and attention sessions in this workspace.",
          [
            { label: "Workspace", value: repo.name },
            { label: "Sessions", value: String(activeSessionsInRepo.length) },
          ],
        ),
        meta: {
          repoId: repo.id,
        },
        perform: async (runtime) => {
          const confirmed = await confirmBulkStop({
            count: activeSessionsInRepo.length,
            title: `Stop active sessions in ${repo.name}?`,
            message:
              "This will terminate each active agent process in this workspace and move those sessions to Closed.",
          });
          if (!confirmed) return;

          await Promise.allSettled(
            activeSessionsInRepo.map((session) => runtime.stopSession(session.id)),
          );
        },
      });
    }

    const unarchivedClosedSessions = getMatchingSessions(ctx, {
      repoId: repo.id,
      statuses: ["closed"],
    });
    if (unarchivedClosedSessions.length > 0) {
      items.push({
        id: `command:archive-closed:${repo.id}`,
        kind: "command",
        title: `Archive Closed Sessions in ${repo.name}`,
        subtitle: `${unarchivedClosedSessions.length} closed session${unarchivedClosedSessions.length === 1 ? "" : "s"}`,
        aliases: [
          ...buildScopedPhraseAliases("archive closed", repo.name),
          ...buildScopedPhraseAliases("archive closed sessions", repo.name),
        ],
        keywords: ["archive", "closed", "sessions", repo.name, repo.path],
        iconName: "Archive",
        group: "Commands",
        queryOrder: 76,
        preview: buildActionPreview(
          `Archive Closed Sessions in ${repo.name}`,
          "Move all closed sessions in this workspace to Archived.",
          [
            { label: "Workspace", value: repo.name },
            { label: "Sessions", value: String(unarchivedClosedSessions.length) },
          ],
        ),
        meta: {
          repoId: repo.id,
        },
        perform: () => {
          for (const session of unarchivedClosedSessions) {
            useSessionStore.getState().archiveSession(session.id);
          }
        },
      });
    }

    for (const provider of ctx.providers) {
      const sessionName = providerSessionName(provider.id, ctx);
      const latestProviderSession = getLatestMatchingSession(ctx, {
        repoId: repo.id,
        providerId: provider.id,
      });
      if (latestProviderSession) {
        items.push({
          id: `command:open-latest-provider:${provider.id}:${repo.id}`,
          kind: "command",
          title: `Open Latest ${sessionName} Session in ${repo.name}`,
          subtitle: `${providerName(provider.id, ctx)} · ${repo.path}`,
          aliases: [
            ...buildScopedPhraseAliases(`latest ${sessionName}`, repo.name),
            ...buildScopedPhraseAliases(`latest ${provider.displayName}`, repo.name),
            ...buildScopedPhraseAliases(`${sessionName} latest`, repo.name),
          ],
          keywords: [
            "latest",
            sessionName,
            provider.id,
            provider.displayName,
            repo.name,
            repo.path,
          ],
          iconName: "History",
          group: "Commands",
          queryOrder: 90,
          preview: buildSessionPreview(ctx, latestProviderSession.id),
          meta: {
            repoId: repo.id,
            providerId: provider.id,
            sessionId: latestProviderSession.id,
            status: latestProviderSession.status.toLowerCase(),
          },
          perform: (runtime) =>
            navigateToSessionTarget(
              {
                kind: "session",
                repoId: latestProviderSession.repoId,
                sessionId: latestProviderSession.id,
              },
              runtime.navigate,
            ),
        });
      }

      const latestProviderClosedSession = getLatestMatchingSession(ctx, {
        repoId: repo.id,
        providerId: provider.id,
        statuses: CLOSED_SESSION_STATUSES,
      });
      if (latestProviderClosedSession) {
        items.push({
          id: `command:resume-latest-provider:${provider.id}:${repo.id}`,
          kind: "command",
          title: `Resume Latest ${sessionName} Session in ${repo.name}`,
          subtitle: `${providerName(provider.id, ctx)} · ${repo.path}`,
          aliases: [
            ...buildScopedPhraseAliases(`resume latest ${sessionName}`, repo.name),
            ...buildScopedPhraseAliases(`resume latest ${provider.displayName}`, repo.name),
          ],
          keywords: [
            "resume",
            "latest",
            sessionName,
            provider.id,
            provider.displayName,
            repo.name,
            repo.path,
          ],
          iconName: "RotateCcw",
          group: "Commands",
          queryOrder: 92,
          preview: buildSessionPreview(ctx, latestProviderClosedSession.id),
          meta: {
            repoId: repo.id,
            providerId: provider.id,
            sessionId: latestProviderClosedSession.id,
            status: latestProviderClosedSession.status.toLowerCase(),
          },
          perform: (runtime) =>
            navigateToSessionTarget(
              {
                kind: "session",
                repoId: latestProviderClosedSession.repoId,
                sessionId: latestProviderClosedSession.id,
              },
              runtime.navigate,
              { resume: true },
            ),
        });
      }

      for (const statusCommand of STATUS_COMMANDS) {
        const target = getLatestMatchingSession(ctx, {
          repoId: repo.id,
          providerId: provider.id,
          statuses: statusCommand.statuses,
        });
        if (!target) continue;

        items.push({
          id: `command:open-${statusCommand.label.toLowerCase()}-${provider.id}:${repo.id}`,
          kind: "command",
          title: `Open Latest ${sessionName} ${statusCommand.label} Session in ${repo.name}`,
          subtitle: `${providerName(provider.id, ctx)} · ${repo.path}`,
          aliases: statusCommand.aliases.flatMap((alias) => [
            ...buildScopedPhraseAliases(`${alias} ${sessionName}`, repo.name),
            ...buildScopedPhraseAliases(`${alias} ${provider.displayName}`, repo.name),
            ...buildScopedPhraseAliases(`${sessionName} ${alias}`, repo.name),
          ]),
          keywords: [
            statusCommand.label.toLowerCase(),
            sessionName,
            provider.id,
            provider.displayName,
            repo.name,
            repo.path,
          ],
          iconName: "TerminalSquare",
          group: "Commands",
          queryOrder: 88,
          preview: buildSessionPreview(ctx, target.id),
          meta: {
            repoId: repo.id,
            providerId: provider.id,
            sessionId: target.id,
            status: target.status.toLowerCase(),
          },
          perform: (runtime) =>
            navigateToSessionTarget(
              { kind: "session", repoId: target.repoId, sessionId: target.id },
              runtime.navigate,
            ),
        });
      }

      const activeProviderSessions = getMatchingSessions(ctx, {
        repoId: repo.id,
        providerId: provider.id,
        statuses: OPEN_SESSION_STATUSES,
      });
      if (activeProviderSessions.length > 0) {
        items.push({
          id: `command:stop-provider:${provider.id}:${repo.id}`,
          kind: "command",
          title: `Stop Active ${sessionName} Sessions in ${repo.name}`,
          subtitle: `${activeProviderSessions.length} active ${providerName(provider.id, ctx)} session${activeProviderSessions.length === 1 ? "" : "s"}`,
          aliases: [
            ...buildScopedPhraseAliases(`stop ${sessionName}`, repo.name),
            ...buildScopedPhraseAliases(`stop ${provider.displayName}`, repo.name),
          ],
          keywords: ["stop", sessionName, provider.id, provider.displayName, repo.name, repo.path],
          iconName: "OctagonX",
          group: "Commands",
          queryOrder: 84,
          preview: buildActionPreview(
            `Stop Active ${sessionName} Sessions in ${repo.name}`,
            "Terminate the active sessions for this provider in the selected workspace.",
            [
              { label: "Workspace", value: repo.name },
              { label: "Provider", value: providerName(provider.id, ctx) },
              { label: "Sessions", value: String(activeProviderSessions.length) },
            ],
          ),
          meta: {
            repoId: repo.id,
            providerId: provider.id,
          },
          perform: async (runtime) => {
            const confirmed = await confirmBulkStop({
              count: activeProviderSessions.length,
              title: `Stop active ${sessionName} sessions in ${repo.name}?`,
              message:
                "This will terminate each active agent process for this provider and move those sessions to Closed.",
            });
            if (!confirmed) return;

            await Promise.allSettled(
              activeProviderSessions.map((session) => runtime.stopSession(session.id)),
            );
          },
        });
      }
    }
  }

  return items;
}

function createPowerCommandItems(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];

  if (ctx.activeSessionId) {
    const otherOpenSessions = getMatchingSessions(ctx, {
      statuses: OPEN_SESSION_STATUSES,
    }).filter((session) => session.id !== ctx.activeSessionId);

    if (otherOpenSessions.length > 0) {
      items.push({
        id: "command:stop-all-except-current",
        kind: "command",
        title: "Stop All Except Current",
        subtitle: `${otherOpenSessions.length} other active session${otherOpenSessions.length === 1 ? "" : "s"}`,
        aliases: ["stop all except current", "keep current stop others"],
        keywords: ["stop", "all", "except", "current", "sessions"],
        iconName: "OctagonX",
        group: "Commands",
        queryOrder: 81,
        when: () => Boolean(ctx.activeSessionId),
        preview: buildActionPreview(
          "Stop All Except Current",
          "Terminate every other running, idle, or attention session and keep the current one open.",
          [{ label: "Sessions", value: String(otherOpenSessions.length) }],
        ),
        perform: async (runtime) => {
          const confirmed = await confirmBulkStop({
            count: otherOpenSessions.length,
            title: "Stop all other sessions?",
            message:
              "This will terminate every other active agent process and move those sessions to Closed.",
          });
          if (!confirmed) return;

          await Promise.allSettled(
            otherOpenSessions.map((session) => runtime.stopSession(session.id)),
          );
        },
      });
    }
  }

  if (ctx.activeRepo) {
    const activeRepo = ctx.activeRepo;

    items.push({
      id: `command:${activeRepo.pinned ? "unpin" : "pin"}-workspace:${activeRepo.id}`,
      kind: "command",
      title: activeRepo.pinned ? "Unpin Current Workspace" : "Pin Current Workspace",
      subtitle: activeRepo.name,
      aliases: [
        `${activeRepo.pinned ? "unpin" : "pin"} workspace`,
        `${activeRepo.pinned ? "unpin" : "pin"} current workspace`,
      ],
      keywords: ["pin", "unpin", "workspace", activeRepo.name, activeRepo.path],
      iconName: activeRepo.pinned ? "PinOff" : "Pin",
      group: "Commands",
      queryOrder: 72,
      preview: buildActionPreview(
        activeRepo.pinned ? "Unpin Current Workspace" : "Pin Current Workspace",
        "Toggle whether the active workspace stays pinned near the top of the sidebar.",
        [
          { label: "Workspace", value: activeRepo.name },
          { label: "Pinned", value: activeRepo.pinned ? "Yes" : "No" },
        ],
      ),
      meta: {
        repoId: activeRepo.id,
        pinned: activeRepo.pinned,
      },
      perform: () => {
        useRepoStore.getState().updateRepo(activeRepo.id, {
          pinned: !activeRepo.pinned,
        });
      },
    });
  }

  if (ctx.activeSession) {
    const activeProvider = findProvider(ctx, ctx.activeSession.provider);
    const providerSessionId = activeProvider?.getProviderSessionId?.(ctx.activeSession) ?? null;
    const resumeCommand =
      activeProvider && providerSessionId ? buildResumeShellCommand(ctx, ctx.activeSession) : null;
    const prompt = ctx.activeSession.prompt.trim();

    if (prompt) {
      items.push({
        id: "command:clone-current-session",
        kind: "command",
        title: "Clone Current Session",
        subtitle: `${ctx.activeSession.repoName} · ${providerName(ctx.activeSession.provider, ctx)}`,
        aliases: ["clone current session", "duplicate current session"],
        keywords: [
          "clone",
          "duplicate",
          "current",
          "session",
          ctx.activeSession.title,
          ctx.activeSession.repoName,
        ].filter(Boolean) as string[],
        iconName: "Plus",
        group: "Commands",
        queryOrder: 86,
        preview: buildSessionPreview(ctx, ctx.activeSession.id),
        meta: {
          repoId: ctx.activeSession.repoId,
          providerId: ctx.activeSession.provider,
          sessionId: ctx.activeSession.id,
          status: ctx.activeSession.status.toLowerCase(),
        },
        perform: async (runtime) => {
          const sessionId = await runtime.startSession({
            prompt: ctx.activeSession?.prompt ?? "",
            providerId: ctx.activeSession?.provider,
            repoId: ctx.activeSession?.repoId,
          });
          runtime.navigate(buildSessionPath(sessionId));
        },
      });

      for (const provider of ctx.providers) {
        if (provider.id === ctx.activeSession.provider) continue;
        const sessionName = providerSessionName(provider.id, ctx);
        items.push({
          id: `command:duplicate-current:${provider.id}`,
          kind: "command",
          title: `Duplicate Current Session with ${sessionName}`,
          subtitle: ctx.activeSession.repoName,
          aliases: [
            `duplicate current with ${sessionName}`,
            `duplicate current with ${provider.displayName}`,
            `${sessionName} current session`,
          ],
          keywords: [
            "duplicate",
            "current",
            "session",
            sessionName,
            provider.id,
            provider.displayName,
            ctx.activeSession.repoName,
          ],
          iconName: "Cpu",
          group: "Commands",
          queryOrder: 85,
          preview: buildScopedLaunchPreview(
            `Duplicate Current Session with ${sessionName}`,
            "Start a fresh session in the same workspace using the current prompt.",
            ctx.activeSession.repoName,
            ctx.activeSession.repoPath,
            providerName(provider.id, ctx),
          ),
          meta: {
            repoId: ctx.activeSession.repoId,
            providerId: provider.id,
            sessionId: ctx.activeSession.id,
          },
          perform: async (runtime) => {
            const sessionId = await runtime.startSession({
              prompt: ctx.activeSession?.prompt ?? "",
              providerId: provider.id,
              repoId: ctx.activeSession?.repoId,
            });
            runtime.navigate(buildSessionPath(sessionId));
          },
        });
      }
    }

    if (resumeCommand) {
      items.push({
        id: "command:copy-resume-command",
        kind: "command",
        title: "Copy Resume Command",
        subtitle: providerName(ctx.activeSession.provider, ctx),
        aliases: ["copy resume command", "copy cli resume", "resume command"],
        keywords: ["copy", "resume", "command", ctx.activeSession.title].filter(
          Boolean,
        ) as string[],
        iconName: "ClipboardCopy",
        group: "Commands",
        queryOrder: 84,
        preview: buildActionPreview(
          "Copy Resume Command",
          "Copy the provider CLI command needed to reopen this session outside AgTower.",
          [
            { label: "Provider", value: providerName(ctx.activeSession.provider, ctx) },
            { label: "Command", value: resumeCommand },
          ],
        ),
        meta: {
          repoId: ctx.activeSession.repoId,
          providerId: ctx.activeSession.provider,
          sessionId: ctx.activeSession.id,
        },
        perform: async () => {
          await navigator.clipboard.writeText(resumeCommand);
          toast.success("Resume command copied");
        },
      });
    }
  }

  return items;
}

export function getPaletteItems(ctx: PaletteContext): PaletteItem[] {
  return [
    ...createCoreCommands(ctx),
    ...createScopedSessionCommandItems(ctx),
    ...createPowerCommandItems(ctx),
    ...createThemeItems(ctx),
    ...createStartupItems(ctx),
    ...createNotificationItems(ctx),
    ...createProviderItems(ctx),
    ...createAutoArchiveItems(ctx),
    ...createWorkspaceItems(ctx),
    ...createSessionItems(ctx),
    ...createDangerItems(),
  ];
}
