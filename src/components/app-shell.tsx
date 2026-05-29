import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  type AppShellTitleToolbarDescriptor,
  AppShellToolbarContext,
  type AppShellToolbarDescriptor,
  type AppShellToolbarRegistration,
} from "@/components/app-shell-toolbar";
import { AppShellTitleToolbar } from "@/components/app-shell-toolbar-content";
import AppSidebar from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette/index";
import { DashboardShellToolbar } from "@/components/dashboard/dashboard-shell-toolbar";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { PageTransition } from "@/components/page-transition";
import { SessionShellToolbar } from "@/components/session/session-header";
import { ShortcutBar } from "@/components/shortcut-bar";
import { ShortcutModal } from "@/components/shortcut-modal";
import { SessionDragGhost } from "@/components/sidebar/session-drag-ghost";
import { IconButton } from "@/components/ui/icon-button";
import {
  SIDEBAR_MOTION_DURATION_MS,
  SIDEBAR_MOTION_EASING,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useAttentionSignals } from "@/hooks/use-attention-signals";
import { useDeepLink } from "@/hooks/use-deep-link";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useNativeAppCommands } from "@/hooks/use-native-app-commands";
import { useNativeMacOSWindowChrome } from "@/hooks/use-native-macos-window-chrome";
import {
  useNativeWindowDrag,
  useNativeWindowTitlebarDoubleClick,
} from "@/hooks/use-native-window-drag";
import { useSession } from "@/hooks/use-session";
import { useSleepPrevention } from "@/hooks/use-sleep-prevention";
import { useSystemAccentColor } from "@/hooks/use-system-accent-color";
import { useUpdater } from "@/hooks/use-updater";
import { useWindowActiveState } from "@/hooks/use-window-active-state";
import { IS_MACOS } from "@/lib/platform";
import { resolveToolbarMeta } from "@/lib/toolbar-meta";
import { cn } from "@/lib/utils";
import { discoverCliSessions } from "@/providers/claude-code/discovery";
import { discoverCodexSessions } from "@/providers/codex/discovery";
import { getAllProviders } from "@/providers/registry";
import { useRepoStore } from "@/stores/repo-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";

function describeDashboardSubtitle({
  attentionCount,
  runningCount,
}: {
  attentionCount: number;
  runningCount: number;
}) {
  if (runningCount > 0 && attentionCount > 0) {
    return `${runningCount} running, ${attentionCount} need attention`;
  }

  if (attentionCount > 0) {
    return attentionCount === 1
      ? "1 session needs attention"
      : `${attentionCount} sessions need attention`;
  }

  if (runningCount > 0) {
    return runningCount === 1 ? "1 active session" : `${runningCount} active sessions`;
  }

  return "No active sessions";
}

function useToolbarMeta() {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const activeRepoId = useRepoStore((s) => s.activeRepoId);
  const repos = useRepoStore((s) => s.repos);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const repoCount = Object.keys(repos).length;
  const routeSessionId = params.id;
  const sessionId = location.pathname.startsWith("/session/")
    ? (activeSessionId ?? routeSessionId)
    : routeSessionId;
  const session = sessionId ? sessions[sessionId] : undefined;
  const activeRepo = activeRepoId ? repos[activeRepoId] : null;
  const providerDisplayNames = Object.fromEntries(
    getAllProviders().map((provider) => [provider.id, provider.displayName]),
  );

  return resolveToolbarMeta({
    activeRepoName: activeRepo?.name ?? null,
    pathname: location.pathname,
    providerDisplayNames,
    repoCount,
    search: location.search,
    sessionRepoName: session?.repoName ?? null,
    sessionTitle: session?.title ?? null,
  });
}

function AppShellChrome({
  toolbarDescriptor,
  toolbarMeta,
}: {
  toolbarDescriptor: AppShellToolbarDescriptor | null;
  toolbarMeta: ReturnType<typeof useToolbarMeta>;
}) {
  const { isMobile, open, toggleSidebar } = useSidebar();
  const handleToolbarMouseDown = useNativeWindowDrag(IS_MACOS);
  const handleToolbarDoubleClick = useNativeWindowTitlebarDoubleClick(IS_MACOS);
  const resolvedToolbarDescriptor: AppShellToolbarDescriptor =
    toolbarDescriptor ??
    ({
      detail: toolbarMeta.detail,
      kind: "title",
      title: toolbarMeta.title,
    } satisfies AppShellTitleToolbarDescriptor);
  const usesLeadingInset =
    resolvedToolbarDescriptor.kind === "session" || resolvedToolbarDescriptor.kind === "dashboard";
  const nativeChromeTitle =
    resolvedToolbarDescriptor.kind === "title"
      ? resolvedToolbarDescriptor.title
      : toolbarMeta.title;
  const nativeChromeSubtitle =
    resolvedToolbarDescriptor.kind === "title"
      ? null
      : resolvedToolbarDescriptor.kind === "session"
        ? (toolbarMeta.detail ?? null)
        : resolvedToolbarDescriptor.kind === "dashboard"
          ? describeDashboardSubtitle({
              attentionCount: resolvedToolbarDescriptor.attentionCount,
              runningCount: resolvedToolbarDescriptor.runningCount,
            })
          : null;

  useNativeMacOSWindowChrome({
    hideTitle:
      resolvedToolbarDescriptor.kind === "session" ||
      resolvedToolbarDescriptor.kind === "dashboard",
    showsSidebarToggle: !isMobile,
    subtitle: nativeChromeSubtitle,
    title: nativeChromeTitle,
  });

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        {IS_MACOS ? (
          <header className="relative isolate shrink-0">
            <div
              data-window-drag-surface
              onMouseDownCapture={handleToolbarMouseDown}
              onDoubleClickCapture={handleToolbarDoubleClick}
              style={{
                transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                transitionTimingFunction: SIDEBAR_MOTION_EASING,
              }}
              className="window-toolbar-row relative z-10 flex h-[var(--window-native-titlebar-height)] items-center px-0"
            >
              {resolvedToolbarDescriptor.kind === "session" ? (
                <div
                  style={{
                    transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                    transitionTimingFunction: SIDEBAR_MOTION_EASING,
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center pr-1.5 transition-[padding-left] motion-reduce:transition-none",
                    open ? "pl-4" : "pl-[calc(var(--window-titlebar-safe-area)+3rem)]",
                  )}
                >
                  <SessionShellToolbar
                    sessionId={resolvedToolbarDescriptor.sessionId}
                    onDelete={resolvedToolbarDescriptor.onDelete}
                    onArchive={resolvedToolbarDescriptor.onArchive}
                    onStop={resolvedToolbarDescriptor.onStop}
                    onClose={resolvedToolbarDescriptor.onClose}
                  />
                </div>
              ) : resolvedToolbarDescriptor.kind === "dashboard" ? (
                <div
                  style={{
                    transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                    transitionTimingFunction: SIDEBAR_MOTION_EASING,
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center pr-1.5 transition-[padding-left] motion-reduce:transition-none",
                    open ? "pl-4" : "pl-[calc(var(--window-titlebar-safe-area)+3rem)]",
                  )}
                >
                  <DashboardShellToolbar
                    attentionCount={resolvedToolbarDescriptor.attentionCount}
                    onStopAll={resolvedToolbarDescriptor.onStopAll}
                    onWorkspaceFilterChange={resolvedToolbarDescriptor.onWorkspaceFilterChange}
                    runningCount={resolvedToolbarDescriptor.runningCount}
                    title={resolvedToolbarDescriptor.title}
                    workspaceFilter={resolvedToolbarDescriptor.workspaceFilter}
                    workspaces={resolvedToolbarDescriptor.workspaces}
                  />
                </div>
              ) : null}
            </div>
          </header>
        ) : (
          <>
            {!isMobile && (
              <div className="pointer-events-none absolute left-0 top-0 z-30 h-[var(--window-toolbar-height)]">
                <div className="window-toolbar-row flex h-full items-center pl-3.5">
                  <IconButton
                    label={open ? "Hide sidebar" : "Show sidebar"}
                    tooltip={open ? "Hide Sidebar" : "Show Sidebar"}
                    type="button"
                    variant="ghost"
                    size="toolbar-icon"
                    className="pointer-events-auto shrink-0 rounded-md border-0 bg-transparent text-foreground/60 shadow-none hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.1] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.14]"
                    onClick={toggleSidebar}
                  >
                    {open ? (
                      <PanelLeftClose className="size-4" strokeWidth={1.5} />
                    ) : (
                      <PanelLeftOpen className="size-4" strokeWidth={1.5} />
                    )}
                  </IconButton>
                </div>
              </div>
            )}

            <header className="relative isolate shrink-0">
              <div
                data-window-drag-surface
                onMouseDownCapture={handleToolbarMouseDown}
                onDoubleClickCapture={handleToolbarDoubleClick}
                style={{
                  transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                  transitionTimingFunction: SIDEBAR_MOTION_EASING,
                }}
                className="window-toolbar-row relative z-10 flex h-[var(--window-toolbar-height)] items-center px-0"
              >
                {resolvedToolbarDescriptor.kind === "session" ? (
                  <div
                    style={{
                      transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                      transitionTimingFunction: SIDEBAR_MOTION_EASING,
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center pr-1.5 transition-[padding-left] motion-reduce:transition-none",
                      usesLeadingInset
                        ? open
                          ? "pl-4"
                          : "pl-[calc(var(--window-titlebar-safe-area)+3rem)]"
                        : undefined,
                    )}
                  >
                    <SessionShellToolbar
                      sessionId={resolvedToolbarDescriptor.sessionId}
                      onDelete={resolvedToolbarDescriptor.onDelete}
                      onArchive={resolvedToolbarDescriptor.onArchive}
                      onStop={resolvedToolbarDescriptor.onStop}
                      onClose={resolvedToolbarDescriptor.onClose}
                    />
                  </div>
                ) : resolvedToolbarDescriptor.kind === "dashboard" ? (
                  <div
                    style={{
                      transitionDuration: `${SIDEBAR_MOTION_DURATION_MS}ms`,
                      transitionTimingFunction: SIDEBAR_MOTION_EASING,
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center pr-1.5 transition-[padding-left] motion-reduce:transition-none",
                      usesLeadingInset
                        ? open
                          ? "pl-4"
                          : "pl-[calc(var(--window-titlebar-safe-area)+3rem)]"
                        : undefined,
                    )}
                  >
                    <DashboardShellToolbar
                      attentionCount={resolvedToolbarDescriptor.attentionCount}
                      onStopAll={resolvedToolbarDescriptor.onStopAll}
                      onWorkspaceFilterChange={resolvedToolbarDescriptor.onWorkspaceFilterChange}
                      runningCount={resolvedToolbarDescriptor.runningCount}
                      title={resolvedToolbarDescriptor.title}
                      workspaceFilter={resolvedToolbarDescriptor.workspaceFilter}
                      workspaces={resolvedToolbarDescriptor.workspaces}
                    />
                  </div>
                ) : (
                  <AppShellTitleToolbar
                    detail={resolvedToolbarDescriptor.detail}
                    title={resolvedToolbarDescriptor.title}
                  />
                )}
              </div>
            </header>
          </>
        )}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
        {!IS_MACOS && <ShortcutBar />}
      </SidebarInset>
      <CommandPalette />
      <NewSessionDialog />
      <ShortcutModal />
      <SessionDragGhost />
      <Toaster position="bottom-right" richColors closeButton visibleToasts={5} duration={4000} />
    </>
  );
}

export default function AppShell() {
  useSleepPrevention();
  useAttentionSignals();
  useWindowActiveState();
  useFullscreenState();
  useSystemAccentColor();
  useDeepLink();
  useUpdater();
  const toolbarMeta = useToolbarMeta();
  const [toolbarRegistration, setToolbarRegistration] =
    useState<AppShellToolbarRegistration | null>(null);
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const routeSessionId = params.id ?? null;
  const sessionId = location.pathname.startsWith("/session/")
    ? (activeSessionId ?? routeSessionId)
    : null;
  const session = sessionId ? sessions[sessionId] : null;
  const executeCommand = useNativeAppCommands({
    navigate,
    pathname: location.pathname,
    session,
    sessionId,
  });
  useKeyboardShortcuts(executeCommand);
  const { startTerminalSession } = useSession();
  const syncingCliSessionsRef = useRef(false);

  const sidebarOpen = useSidebarStore((s) => s.sidebarOpen);
  const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
  const setSidebarOpen = useSidebarStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth);
  const registerToolbar = useCallback(
    (ownerId: string, descriptor: AppShellToolbarDescriptor | null) => {
      setToolbarRegistration((current) => {
        if (!descriptor) {
          return current?.ownerId === ownerId ? null : current;
        }

        return { ownerId, descriptor };
      });
    },
    [],
  );
  const toolbarContextValue = useMemo(
    () => ({
      registerToolbar,
    }),
    [registerToolbar],
  );

  // Listen for toast "View" button navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const sessionId = (e as CustomEvent).detail;
      if (sessionId) navigate(`/session/${sessionId}`);
    };
    window.addEventListener("navigate-to-session", handler);
    return () => window.removeEventListener("navigate-to-session", handler);
  }, [navigate]);

  useEffect(() => {
    const handler = () => {
      startTerminalSession()
        .then((sessionId) => {
          navigate(`/session/${sessionId}`);
        })
        .catch((error) => {
          console.error("[sidebar] Failed to start terminal session:", error);
        });
    };
    window.addEventListener("new-terminal-session", handler);
    return () => window.removeEventListener("new-terminal-session", handler);
  }, [navigate, startTerminalSession]);

  useEffect(() => {
    const handler = () => {
      if (syncingCliSessionsRef.current) return;
      syncingCliSessionsRef.current = true;
      const toastId = toast.loading("Syncing CLI sessions...");

      void Promise.all([discoverCliSessions(), discoverCodexSessions()])
        .then(([claudeResult, codexResult]) => {
          const imported = claudeResult.imported + codexResult.imported;
          const skipped = claudeResult.skipped + codexResult.skipped;
          const errors = claudeResult.errors + codexResult.errors;
          const summary =
            imported > 0
              ? `Imported ${imported} CLI ${imported === 1 ? "session" : "sessions"}`
              : "No new CLI sessions";
          const detail =
            errors > 0
              ? `${skipped} skipped, ${errors} ${errors === 1 ? "error" : "errors"}`
              : `${skipped} skipped`;

          if (errors > 0) {
            toast.error(summary, { description: detail, id: toastId });
          } else {
            toast.success(summary, { description: detail, id: toastId });
          }
        })
        .catch((error) => {
          console.error("[app-shell] Failed to sync CLI sessions:", error);
          toast.error("Failed to sync CLI sessions", { id: toastId });
        })
        .finally(() => {
          syncingCliSessionsRef.current = false;
        });
    };

    window.addEventListener("sync-cli-sessions", handler);
    return () => window.removeEventListener("sync-cli-sessions", handler);
  }, []);

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      width={sidebarWidth}
      onWidthChange={setSidebarWidth}
    >
      <AppShellToolbarContext.Provider value={toolbarContextValue}>
        <AppShellChrome
          toolbarDescriptor={toolbarRegistration?.descriptor ?? null}
          toolbarMeta={toolbarMeta}
        />
      </AppShellToolbarContext.Provider>
    </SidebarProvider>
  );
}
