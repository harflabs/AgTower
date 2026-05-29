import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Command as CommandIcon,
  ExternalLink,
  FolderClock,
  Import,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
  Sun,
  TerminalSquare,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useNativeWindowDrag,
  useNativeWindowTitlebarDoubleClick,
} from "@/hooks/use-native-window-drag";
import { requestNotificationPermission } from "@/lib/notifications";
import { type HistoryImportPreference, loadOnboardingState } from "@/lib/onboarding-state";
import { IS_MACOS } from "@/lib/platform";
import { setThemeMode } from "@/lib/settings-actions";
import { loadSetupAssistantSnapshot, type SetupAssistantSnapshot } from "@/lib/setup-assistant";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { DemoBoard, DemoPalette } from "./setup-assistant-demo";
import {
  type FinishSetupAssistantResult,
  finishSetupAssistantFlow,
} from "./setup-assistant-finish";
import {
  compactPath,
  DEFAULT_DEMO_SESSION_ID,
  DEMO_PALETTE_GROUP_ORDER,
  type DemoCommand,
  type DemoSessionEntry,
  type DemoSessionId,
  type DemoView,
  getDemoSessionById,
  getPlatformCommandLabel,
  getStepLabel,
  getStepSequence,
  normalizeDemoSearch,
  type ProviderChoice,
  resolveDemoTheme,
  type SetupAssistantMode,
  type SetupAssistantStep,
  type SetupPaletteCommandId,
  scoreDemoSearch,
  statusLabel,
  statusTone,
} from "./setup-assistant-model";
import {
  ProgressRail,
  SettingsStepCard,
  StepFooter,
  StepFooterDock,
  StepShell,
} from "./setup-assistant-primitives";
import { SetupAssistantWelcomeScreen } from "./setup-assistant-welcome";

interface SetupAssistantProps {
  mode: SetupAssistantMode;
  onDone?: () => void;
}

const SETUP_PROVIDER_META: Record<
  ProviderChoice,
  {
    website: string;
  }
> = {
  "claude-code": {
    website: "https://docs.anthropic.com/en/docs/claude-code/overview",
  },
  codex: {
    website: "https://developers.openai.com/codex/cli",
  },
};
const AGTOWER_WEBSITE_URL = "https://agtower.ai";
const AGTOWER_REPO_URL = "https://github.com/harflabs/agtower";
const ONBOARDING_INSET_CARD_CLASS_NAME = "native-inset-panel";

function getOnboardingChoiceRowClassName(selected: boolean, disabled = false) {
  return cn(
    "flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left control-transition-native outline-none focus-ring-default sm:px-5",
    selected ? "bg-interactive-selected text-interactive-selected-foreground" : "hover:bg-muted/55",
    disabled && "cursor-not-allowed opacity-55 hover:bg-transparent",
  );
}

function getOnboardingSelectionIndicatorClassName(selected: boolean, disabled = false) {
  return cn(
    "inline-flex size-5 shrink-0 items-center justify-center rounded-full border control-transition-native",
    selected
      ? "border-primary/15 bg-primary text-primary-foreground shadow-none"
      : "border-border/70 bg-background/75 text-transparent",
    disabled && "opacity-70",
  );
}

function SystemProviderListSkeleton() {
  return (
    <div className="native-panel divide-y divide-border/55" aria-hidden="true">
      {(Object.keys(SETUP_PROVIDER_META) as ProviderChoice[]).map((providerId, index) => (
        <div
          key={providerId}
          className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <Skeleton className="size-10 shrink-0 rounded-[4px]" />

            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className={cn("h-4", index === 0 ? "w-24" : "w-14")} />
                <Skeleton className="size-6 rounded-[4px]" />
              </div>
              <Skeleton className={cn("h-4", index === 0 ? "w-44" : "w-32")} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="h-5 w-12 rounded-[4px]" />
            <div className="min-w-14 space-y-1.5">
              <Skeleton className="ml-auto h-3 w-12" />
              <Skeleton className="ml-auto h-4 w-3.5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function createEmptyDemoSessionEntries(): Record<DemoSessionId, DemoSessionEntry[]> {
  return {
    "observer-race": [],
    "webhook-retries": [],
    "release-notes": [],
  };
}

function createEmptyDemoSessionInputs(): Record<DemoSessionId, string> {
  return {
    "observer-race": "",
    "webhook-retries": "",
    "release-notes": "",
  };
}

export function SetupAssistant({ mode, onDone }: SetupAssistantProps) {
  const navigate = useNavigate();
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const desktopNotificationsSetting = useSettingsStore((s) => s.notifications.desktop);
  const themePreference = useSettingsStore((s) => s.theme);
  const demoInputRef = useRef<HTMLInputElement>(null);
  const demoSessionInputRef = useRef<HTMLInputElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [welcomeReplayToken, setWelcomeReplayToken] = useState(0);
  const [snapshot, setSnapshot] = useState<SetupAssistantSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [demoView, setDemoView] = useState<DemoView>("dashboard");
  const [demoSessionClosed, setDemoSessionClosed] = useState(false);
  const [demoActiveSessionId, setDemoActiveSessionId] =
    useState<DemoSessionId>(DEFAULT_DEMO_SESSION_ID);
  const [demoSessionEntriesById, setDemoSessionEntriesById] = useState<
    Record<DemoSessionId, DemoSessionEntry[]>
  >(() => createEmptyDemoSessionEntries());
  const [demoSessionInputsById, setDemoSessionInputsById] = useState<Record<DemoSessionId, string>>(
    () => createEmptyDemoSessionInputs(),
  );
  const [demoSearch, setDemoSearch] = useState("");
  const [demoSelectedCommandIndex, setDemoSelectedCommandIndex] = useState(0);
  const [demoActionsRun, setDemoActionsRun] = useState(0);
  const [historyPreference, setHistoryPreference] = useState<HistoryImportPreference | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderChoice>(
    defaultProvider === "codex" ? "codex" : "claude-code",
  );
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabledChoice] = useState<
    boolean | null
  >(null);
  const [notificationStepNotice, setNotificationStepNotice] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  const steps = useMemo(() => getStepSequence(mode), [mode]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const demoTheme = resolveDemoTheme(themePreference);
  const canUseSetupPalette = mode === "onboarding";
  const activeDemoSession = useMemo(
    () => getDemoSessionById(demoActiveSessionId),
    [demoActiveSessionId],
  );
  const activeDemoSessionEntries = demoSessionEntriesById[demoActiveSessionId];
  const activeDemoSessionInput = demoSessionInputsById[demoActiveSessionId];

  const refreshSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    try {
      setSnapshot(await loadSetupAssistantSnapshot());
    } catch (error) {
      console.error("[setup-assistant] Failed to load snapshot:", error);
      toast.error("Failed to inspect your local setup");
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    loadOnboardingState()
      .then((state) => {
        if (state) {
          setHistoryPreference(state.historyImportPreference);
        }
      })
      .catch((error) => {
        console.error("[setup-assistant] Failed to load onboarding state:", error);
      });
  }, []);

  const availableProviders = useMemo(
    () => snapshot?.providers.filter((provider) => provider.status === "ready") ?? [],
    [snapshot?.providers],
  );

  const canAdvanceFromStep = useMemo(() => {
    switch (step) {
      case "demo":
        return true;
      case "system":
        return !loadingSnapshot && snapshot !== null;
      case "history":
        return (
          snapshot !== null && (snapshot.totalImportableCount === 0 || Boolean(historyPreference))
        );
      case "provider":
        return !loadingSnapshot && availableProviders.length > 0;
      case "notifications":
        return desktopNotificationsEnabled !== null && !isFinishing;
      default:
        return step !== "welcome";
    }
  }, [
    availableProviders.length,
    desktopNotificationsEnabled,
    historyPreference,
    isFinishing,
    loadingSnapshot,
    snapshot,
    snapshot?.totalImportableCount,
    step,
  ]);

  const notificationsTool = useMemo(
    () => snapshot?.tools.find((tool) => tool.id === "notifications") ?? null,
    [snapshot?.tools],
  );
  const providersNeedingAttention = useMemo(
    () => snapshot?.providers.filter((provider) => provider.status === "available") ?? [],
    [snapshot?.providers],
  );

  const paletteCommands = useMemo<DemoCommand[]>(() => {
    const commands: DemoCommand[] = [];

    if (step === "welcome") {
      commands.push({
        id: "start-onboarding",
        title: "Start onboarding",
        detail: "Open the demo walkthrough",
        group: "This Screen",
        icon: ArrowRight,
        aliases: ["start", "begin onboarding", "continue onboarding"],
        keywords: ["start", "begin", "onboarding", "demo"],
      });
      commands.push({
        id: "restart-welcome-animation",
        title: "Replay intro",
        detail: "Restart the welcome animation",
        group: "This Screen",
        icon: RefreshCw,
        aliases: ["restart animation", "replay animation", "restart intro"],
        keywords: ["welcome", "animation", "intro", "restart", "replay"],
      });
    }

    if (step === "demo") {
      if (demoView === "dashboard") {
        commands.push({
          id: "open-session",
          title: "Open session",
          detail: activeDemoSession.title,
          group: "This Screen",
          icon: TerminalSquare,
          aliases: ["open session", "show session", "session"],
          keywords: ["session", "open", "show", "sample"],
        });
      } else {
        commands.push({
          id: "open-dashboard",
          title: "Open dashboard",
          detail: "Kanban board",
          group: "This Screen",
          icon: LayoutDashboard,
          aliases: ["open dashboard", "dashboard", "home"],
          keywords: ["dashboard", "home", "back"],
        });
        commands.push({
          id: "close-session",
          title: "Close session",
          detail: "Return to dashboard",
          group: "This Screen",
          icon: X,
          aliases: ["close session", "done", "finish"],
          keywords: ["close", "session", "done", "finish"],
        });
      }
    }

    if (step === "system") {
      commands.push({
        id: "refresh-system",
        title: "Refresh checks",
        detail: "Check providers again",
        group: "This Screen",
        icon: RefreshCw,
        aliases: ["refresh", "reload", "recheck"],
        keywords: ["system", "checks", "providers"],
      });
    }

    if (step === "history") {
      commands.push({
        id: "history-auto",
        title: "Bring history in",
        detail: `${snapshot?.totalImportableCount ?? 0} ready to import`,
        group: "This Screen",
        icon: Import,
        aliases: ["import history", "bring history", "import sessions"],
        keywords: ["history", "import", "sessions", "claude", "codex"],
      });
      commands.push({
        id: "history-manual",
        title: "Start clean",
        detail: "Import later from Settings",
        group: "This Screen",
        icon: FolderClock,
        aliases: ["start clean", "import later", "manual"],
        keywords: ["clean", "manual", "later", "history"],
      });
    }

    if (step === "provider") {
      for (const provider of availableProviders) {
        commands.push({
          id: `provider:${provider.id}`,
          title: `Use ${provider.displayName}`,
          detail:
            selectedProvider === provider.id ? `${provider.detail} · selected` : provider.detail,
          group: "This Screen",
          icon: TerminalSquare,
          aliases: [provider.displayName, `set provider ${provider.displayName}`],
          keywords: ["provider", provider.id, "default"],
        });
      }
    }

    if (step === "notifications") {
      commands.push({
        id: "notifications-on",
        title: "Allow alerts",
        detail: notificationsTool?.status === "ready" ? "Keep desktop alerts on" : "Ask macOS now",
        group: "This Screen",
        icon: Bell,
        aliases: ["alerts on", "enable alerts", "notifications on"],
        keywords: ["notifications", "alerts", "enable", "allow"],
      });
      commands.push({
        id: "notifications-off",
        title: "Not now",
        detail: "Keep alerts off",
        group: "This Screen",
        icon: BellOff,
        aliases: ["notifications off", "disable notifications", "alerts off"],
        keywords: ["notifications", "alerts", "off", "later"],
      });
      commands.push({
        id: "open-website",
        title: "Visit website",
        detail: "agtower.ai",
        group: "This Screen",
        icon: ExternalLink,
        aliases: ["website", "open website", "agtower site"],
        keywords: ["website", "site", "agtower", "docs"],
      });
      commands.push({
        id: "star-repo",
        title: "Star repo",
        detail: "github.com/harflabs/agtower",
        group: "This Screen",
        icon: Star,
        aliases: ["github", "open repo", "star github"],
        keywords: ["repo", "github", "star", "source"],
      });
    }

    commands.push({
      id: demoTheme === "dark" ? "switch-light" : "switch-dark",
      title: demoTheme === "dark" ? "Set theme to light" : "Set theme to dark",
      detail: "Appearance",
      group: "Appearance",
      icon: demoTheme === "dark" ? Sun : Moon,
      aliases:
        demoTheme === "dark"
          ? ["light mode", "theme light", "light"]
          : ["dark mode", "theme dark", "dark"],
      keywords:
        demoTheme === "dark" ? ["theme", "appearance", "light"] : ["theme", "appearance", "dark"],
    });

    if (step === "notifications" && canAdvanceFromStep) {
      commands.push({
        id: "finish-flow",
        title: mode === "onboarding" ? "Finish onboarding" : "Finish setup",
        detail: mode === "onboarding" ? "Open the dashboard" : "Close setup assistant",
        group: "Navigation",
        icon: CheckCircle2,
        aliases: ["finish", "done", "complete"],
        keywords: ["finish", "done", "complete"],
      });
    } else if (stepIndex < steps.length - 1 && canAdvanceFromStep) {
      commands.push({
        id: "next-step",
        title: "Next step",
        detail: `Go to ${getStepLabel(steps[stepIndex + 1] ?? steps[steps.length - 1])}`,
        group: "Navigation",
        icon: ArrowRight,
        aliases: ["next", "continue"],
        keywords: ["next", "continue", "step"],
      });
    }

    if (stepIndex > 0) {
      commands.push({
        id: "previous-step",
        title: "Previous step",
        detail: `Go to ${getStepLabel(steps[stepIndex - 1] ?? steps[0])}`,
        group: "Navigation",
        icon: ArrowLeft,
        aliases: ["back", "previous", "prev"],
        keywords: ["previous", "back", "step"],
      });
    }

    return commands;
  }, [
    availableProviders,
    activeDemoSession.title,
    canAdvanceFromStep,
    demoTheme,
    demoView,
    mode,
    selectedProvider,
    snapshot?.totalImportableCount,
    notificationsTool?.status,
    step,
    stepIndex,
    steps,
  ]);

  const filteredPaletteCommands = useMemo(() => {
    const groupRank: Record<DemoCommand["group"], number> = {
      "This Screen": DEMO_PALETTE_GROUP_ORDER.indexOf("This Screen"),
      Navigation: DEMO_PALETTE_GROUP_ORDER.indexOf("Navigation"),
      Appearance: DEMO_PALETTE_GROUP_ORDER.indexOf("Appearance"),
    };

    const query = normalizeDemoSearch(demoSearch);
    if (!query) {
      return [...paletteCommands].sort(
        (left, right) => groupRank[left.group] - groupRank[right.group],
      );
    }

    return paletteCommands
      .map((command, index) => {
        const candidates = [
          normalizeDemoSearch(command.title),
          normalizeDemoSearch(command.detail),
          ...(command.aliases ?? []).map(normalizeDemoSearch),
          ...(command.keywords ?? []).map(normalizeDemoSearch),
        ];

        const bestScore = candidates.reduce(
          (best, candidate) => Math.max(best, scoreDemoSearch(candidate, query)),
          0,
        );

        return { command, score: bestScore, index };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          groupRank[left.command.group] - groupRank[right.command.group] ||
          right.score - left.score ||
          left.index - right.index,
      )
      .map((entry) => entry.command);
  }, [demoSearch, paletteCommands]);

  const openDemoPalette = useCallback(() => {
    setPaletteOpen(true);
    setDemoSearch("");
    setDemoSelectedCommandIndex(0);
  }, []);

  const closeDemoPalette = useCallback(() => {
    setPaletteOpen(false);
    setDemoSearch("");
    setDemoSelectedCommandIndex(0);
  }, []);

  const showBlockedAdvanceHint = useCallback((message: string) => {
    toast(message);
  }, []);

  const markDemoActionComplete = useCallback(() => {
    setDemoActionsRun((count) => count + 1);
  }, []);

  const handlePrimaryActionClick = useCallback(
    (blockedHint: string | null, action: () => void) => {
      if (blockedHint) {
        showBlockedAdvanceHint(blockedHint);
        return;
      }

      action();
    },
    [showBlockedAdvanceHint],
  );

  const openSetupResource = useCallback((url: string) => {
    void openUrl(url).catch((error) => {
      console.error("[setup-assistant] Failed to open setup resource:", error);
      toast.error("Failed to open website");
    });
  }, []);

  const submitDemoSessionInput = useCallback(() => {
    const value = activeDemoSessionInput.trim();
    if (!value) return;

    setDemoSessionEntriesById((current) => ({
      ...current,
      [demoActiveSessionId]: [
        ...current[demoActiveSessionId],
        { id: crypto.randomUUID(), text: value },
      ],
    }));
    setDemoSessionInputsById((current) => ({
      ...current,
      [demoActiveSessionId]: "",
    }));
    markDemoActionComplete();
  }, [activeDemoSessionInput, demoActiveSessionId, markDemoActionComplete]);

  const openDemoSession = useCallback((sessionId?: DemoSessionId) => {
    if (sessionId) {
      setDemoActiveSessionId(sessionId);
    }

    setDemoSessionClosed(false);
    setDemoView("session");
  }, []);

  const openDemoSessionAndMarkComplete = useCallback(
    (sessionId?: DemoSessionId) => {
      openDemoSession(sessionId);
      markDemoActionComplete();
    },
    [markDemoActionComplete, openDemoSession],
  );

  const openDemoDashboardAndMarkComplete = useCallback(() => {
    setDemoView("dashboard");
    markDemoActionComplete();
  }, [markDemoActionComplete]);

  const toggleDemoThemeAndMarkComplete = useCallback(() => {
    setThemeMode(demoTheme === "dark" ? "light" : "dark");
    markDemoActionComplete();
  }, [demoTheme, markDemoActionComplete]);

  const goNext = useCallback(() => {
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [steps.length]);

  const goPrevious = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);

  const goToDemo = useCallback(() => {
    const demoIndex = steps.indexOf("demo");
    if (demoIndex === -1) {
      goNext();
      return;
    }

    setStepIndex(demoIndex);
    setDemoActiveSessionId(DEFAULT_DEMO_SESSION_ID);
    setDemoView("dashboard");
    setDemoSessionClosed(false);
    setDemoSessionEntriesById(createEmptyDemoSessionEntries());
    setDemoSessionInputsById(createEmptyDemoSessionInputs());
    setDemoSearch("");
    setDemoSelectedCommandIndex(0);
    setDemoActionsRun(0);
    setPaletteOpen(false);
  }, [goNext, steps]);

  useEffect(() => {
    if (!paletteOpen) return;
    requestAnimationFrame(() => {
      demoInputRef.current?.focus();
    });
  }, [paletteOpen]);

  useEffect(() => {
    if (step !== "demo" || demoView !== "session" || paletteOpen) return;

    requestAnimationFrame(() => {
      demoSessionInputRef.current?.focus();
    });
  }, [demoView, paletteOpen, step]);

  useEffect(() => {
    if (!paletteOpen) return;
    if (filteredPaletteCommands.length === 0) {
      setDemoSelectedCommandIndex(0);
      return;
    }
    setDemoSelectedCommandIndex((current) =>
      Math.max(0, Math.min(current, filteredPaletteCommands.length - 1)),
    );
  }, [filteredPaletteCommands.length, paletteOpen]);

  useEffect(() => {
    if (availableProviders.length === 0) return;
    if (availableProviders.some((provider) => provider.id === selectedProvider)) return;
    setSelectedProvider(availableProviders[0].id);
  }, [availableProviders, selectedProvider]);

  useEffect(() => {
    if (desktopNotificationsEnabled !== null) return;
    if (mode !== "settings") return;

    if (!desktopNotificationsSetting) {
      setDesktopNotificationsEnabledChoice(false);
      return;
    }

    if (notificationsTool?.status === "ready") {
      setDesktopNotificationsEnabledChoice(true);
    }
  }, [desktopNotificationsEnabled, desktopNotificationsSetting, mode, notificationsTool?.status]);

  useEffect(() => {
    if (desktopNotificationsEnabled !== null) return;
    if (mode !== "onboarding") return;
    if (step !== "notifications") return;

    setDesktopNotificationsEnabledChoice(false);
  }, [desktopNotificationsEnabled, mode, step]);

  const applyDesktopNotificationsChoice = useCallback(
    async (enabled: boolean) => {
      setNotificationStepNotice(null);
      if (!enabled) {
        setDesktopNotificationsEnabledChoice(false);
        return;
      }

      try {
        const granted = await requestNotificationPermission();
        if (!granted) {
          setDesktopNotificationsEnabledChoice(false);
          setNotificationStepNotice(
            "macOS did not grant desktop alerts. You can turn them on later from Settings or rerun setup.",
          );
          toast("Notification permission was not granted");
          return;
        }

        setDesktopNotificationsEnabledChoice(true);
        await refreshSnapshot();
      } catch (error) {
        console.error("[setup-assistant] Failed to request notification permission:", error);
        toast.error("Failed to request notification permission");
      }
    },
    [refreshSnapshot],
  );

  const finishFlow = useCallback(
    async (preferenceOverride?: HistoryImportPreference) => {
      if (isFinishing) return;
      const preference = preferenceOverride ?? historyPreference ?? "manual";
      const resolvedDesktopNotificationsEnabled = desktopNotificationsEnabled ?? false;

      setIsFinishing(true);
      try {
        const result: FinishSetupAssistantResult = await finishSetupAssistantFlow({
          desktopNotificationsEnabled: resolvedDesktopNotificationsEnabled,
          historyImportPreference: preference,
          selectedProvider,
          snapshot,
        });

        const importedCount = result.imports.reduce((total, entry) => total + entry.imported, 0);
        if (result.imports.length > 0) {
          await refreshSnapshot();
        }
        for (const warning of result.warnings) {
          toast(warning);
        }
        if (mode === "settings" && importedCount > 0) {
          toast.success(`Imported ${importedCount} session${importedCount === 1 ? "" : "s"}`);
        }
        onDone?.();
        if (mode === "onboarding") {
          navigate("/", { replace: true });
        }
      } catch (error) {
        console.error("[setup-assistant] Failed to finish:", error);
        toast.error(error instanceof Error ? error.message : "Failed to finish setup");
      } finally {
        setIsFinishing(false);
      }
    },
    [
      desktopNotificationsEnabled,
      historyPreference,
      isFinishing,
      mode,
      navigate,
      onDone,
      refreshSnapshot,
      selectedProvider,
      snapshot,
    ],
  );

  const executePaletteCommand = useCallback(
    (commandId: SetupPaletteCommandId) => {
      switch (commandId) {
        case "open-dashboard":
          setDemoView("dashboard");
          break;
        case "open-session":
          openDemoSession();
          break;
        case "close-session":
          setDemoSessionClosed(true);
          setDemoView("dashboard");
          break;
        case "switch-dark":
          setThemeMode("dark");
          break;
        case "switch-light":
          setThemeMode("light");
          break;
        case "start-onboarding":
          goToDemo();
          break;
        case "restart-welcome-animation":
          setWelcomeReplayToken((current) => current + 1);
          break;
        case "next-step":
          goNext();
          break;
        case "previous-step":
          goPrevious();
          break;
        case "refresh-system":
          void refreshSnapshot();
          break;
        case "history-auto":
          setHistoryPreference("auto");
          break;
        case "history-manual":
          setHistoryPreference("manual");
          break;
        case "notifications-on":
          void applyDesktopNotificationsChoice(true);
          break;
        case "notifications-off":
          void applyDesktopNotificationsChoice(false);
          break;
        case "open-website":
          openSetupResource(AGTOWER_WEBSITE_URL);
          break;
        case "star-repo":
          openSetupResource(AGTOWER_REPO_URL);
          break;
        case "finish-flow":
          void finishFlow();
          break;
        default:
          if (commandId.startsWith("provider:")) {
            const providerId = commandId.replace("provider:", "") as ProviderChoice;
            setSelectedProvider(providerId);
          }
          break;
      }

      closeDemoPalette();

      if (step === "demo") {
        markDemoActionComplete();
      }
    },
    [
      closeDemoPalette,
      finishFlow,
      goNext,
      goPrevious,
      goToDemo,
      openSetupResource,
      openDemoSession,
      applyDesktopNotificationsChoice,
      markDemoActionComplete,
      refreshSnapshot,
      step,
    ],
  );

  useEffect(() => {
    if (!canUseSetupPalette) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const isCommandPalette =
        (IS_MACOS ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCommandPalette) {
        event.preventDefault();
        if (paletteOpen) {
          closeDemoPalette();
        } else {
          openDemoPalette();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUseSetupPalette, closeDemoPalette, openDemoPalette, paletteOpen]);

  const handleStepSelect = useCallback(
    (targetStep: SetupAssistantStep) => {
      const targetIndex = steps.indexOf(targetStep);
      const currentIndex = steps.indexOf(step);
      if (targetIndex === -1 || targetIndex >= currentIndex) return;

      setStepIndex(targetIndex);

      setPaletteOpen(false);
    },
    [step, steps],
  );

  const enableOnboardingWindowDrag = mode === "onboarding";
  const handleOnboardingDragMouseDown = useNativeWindowDrag(enableOnboardingWindowDrag);
  const handleOnboardingDragDoubleClick = useNativeWindowTitlebarDoubleClick(
    enableOnboardingWindowDrag,
  );
  const shellClassName =
    mode === "onboarding" ? "onboarding-canvas h-screen overflow-hidden" : "min-h-0";
  const panelClassName =
    mode === "onboarding"
      ? "mx-auto flex h-screen max-w-[min(86rem,100vw)] flex-col"
      : "mx-auto flex w-full max-w-3xl flex-col gap-5";
  const fullscreenStepClassName =
    mode === "onboarding" ? "flex min-h-0 flex-1 flex-col gap-5" : "grid gap-5";
  const welcomeStepClassName =
    mode === "onboarding"
      ? "flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-5"
      : "flex w-full flex-col items-center gap-6";
  const onboardingStepMotionClassName = mode === "onboarding" ? "flex min-h-0 flex-1" : undefined;
  const onboardingStepShellClassName =
    mode === "onboarding" ? "max-w-5xl min-h-0 flex-1" : "max-w-5xl";
  const stepMotionInitial = { opacity: 0, y: 20 };
  const stepMotionAnimate = { opacity: 1, y: 0 };
  const stepMotionExit = { opacity: 0, y: -12 };
  const stepMotionTransition = { duration: 0.24 };
  const showOnboardingChrome = mode === "onboarding" && step !== "welcome";
  const showSettingsRail = mode === "settings" && step !== "welcome";
  const stickyFooter = mode === "onboarding";
  const primaryActionButtonSize = mode === "onboarding" ? "lg" : "default";
  const primaryActionButtonClassName = mode === "onboarding" ? "rounded-md px-4" : undefined;
  const blockedPrimaryActionButtonClassName =
    "cursor-not-allowed opacity-55 hover:bg-primary active:translate-y-0";
  const platformCommandLabel = getPlatformCommandLabel();
  const systemStepTitle = "Check your agent CLIs";
  const systemStepDescription = "AgTower looks for Claude Code and Codex on this Mac.";
  const demoStepTitle = demoView === "dashboard" ? "Try the dashboard" : "Try a session";
  const demoStepDescription =
    demoView === "dashboard"
      ? "Open a sample session or use the visible actions below to get a feel for AgTower."
      : "Review the thread, send a quick reply, then head back when you're ready.";
  const historyStepTitle = "Import previous sessions";
  const historyStepDescription =
    snapshot?.totalImportableCount === 0
      ? "No previous Claude Code or Codex sessions were found."
      : "Bring in detected history or start clean.";
  const providerStepTitle = "Choose your default agent";
  const providerStepDescription = "Used when you start a new session.";
  const notificationsStepTitle = "Finish up";
  const notificationsStepDescription = "Desktop alerts are optional. You can change them later.";
  const demoFooterHint =
    demoActionsRun === 0
      ? "Optional: open a sample session, switch theme, or use the palette."
      : "Try another action or continue.";
  const systemAdvanceBlockedHint = loadingSnapshot
    ? "Wait for the local setup check to finish."
    : snapshot
      ? null
      : "Retry the local setup check before continuing.";
  const historyAdvanceBlockedHint =
    snapshot?.totalImportableCount === 0 || historyPreference !== null
      ? null
      : "Choose whether to import previous sessions or start clean.";
  const providerAdvanceBlockedHint = loadingSnapshot
    ? "Wait for the local setup check to finish."
    : !snapshot
      ? "Retry the local setup check before continuing."
      : providersNeedingAttention.length > 0
        ? "AgTower could not inspect one or more installed providers. Fix local provider state, then refresh checks."
        : availableProviders.length === 0
          ? "Install Claude Code or Codex, then refresh checks."
          : null;
  const notificationsAdvanceBlockedHint = null;
  const providerAvailabilitySummary = loadingSnapshot
    ? "Checking your providers…"
    : availableProviders.length > 0
      ? availableProviders.length === 1
        ? "1 provider is ready to use."
        : `${availableProviders.length} providers are ready to use.`
      : providersNeedingAttention.length > 0
        ? providersNeedingAttention.length === 1
          ? "1 installed provider still needs attention."
          : `${providersNeedingAttention.length} installed providers still need attention.`
        : "Install Claude Code or Codex to launch sessions from AgTower.";
  const desktopAlertsBadgeClassName =
    desktopNotificationsEnabled === true
      ? "bg-success/12 text-success"
      : desktopNotificationsEnabled === false
        ? "bg-muted text-muted-foreground"
        : "bg-warning/12 text-warning-foreground";
  const desktopAlertsLabel =
    desktopNotificationsEnabled === true
      ? "On"
      : desktopNotificationsEnabled === false
        ? "Off"
        : "Optional";
  const desktopAlertsDetail =
    desktopNotificationsEnabled === true
      ? "AgTower may send native alerts when a session needs attention."
      : notificationsTool?.status === "ready"
        ? "macOS allows alerts, but AgTower will keep them off."
        : desktopNotificationsEnabled === false
          ? "Alerts stay off for now."
          : "Optional native alerts when a session needs attention.";
  const hasImportableHistory = (snapshot?.totalImportableCount ?? 0) > 0;

  const systemStepContent = loadingSnapshot ? (
    <SystemProviderListSkeleton />
  ) : (
    <div className="native-panel divide-y divide-border/55">
      {snapshot?.providers.map((provider) => {
        const providerMeta = SETUP_PROVIDER_META[provider.id];
        const totalSessionCount =
          provider.history.importableCount +
          provider.history.runningCount +
          provider.history.alreadyImportedCount;

        return (
          <div
            key={provider.id}
            className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3.5">
              <ProviderIcon
                provider={provider.id}
                variant="brand"
                size={40}
                className="object-contain"
              />

              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {provider.displayName}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label={`Open ${provider.displayName} website`}
                    onClick={() => openSetupResource(providerMeta.website)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
                <p className="truncate text-sm text-muted-foreground">{provider.detail}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <Badge className={cn("shrink-0", statusTone(provider.status))}>
                {statusLabel(provider.status)}
              </Badge>
              <div className="min-w-14 text-right">
                <p className="text-[11px] font-medium text-muted-foreground">Sessions</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {totalSessionCount}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
  const systemStepFooter = (
    <StepFooter
      hint={systemAdvanceBlockedHint ?? "Refresh after installing or changing a CLI path."}
    >
      <Button
        type="button"
        size={primaryActionButtonSize}
        className={cn(
          primaryActionButtonClassName,
          systemAdvanceBlockedHint && blockedPrimaryActionButtonClassName,
        )}
        aria-disabled={systemAdvanceBlockedHint ? true : undefined}
        title={systemAdvanceBlockedHint ?? undefined}
        onClick={() => handlePrimaryActionClick(systemAdvanceBlockedHint, goNext)}
      >
        Next
        <ArrowRight data-icon="inline-end" className="size-4" />
      </Button>
    </StepFooter>
  );
  const historyStepContent = hasImportableHistory ? (
    <div className="space-y-4">
      <div className="native-panel divide-y divide-border/55">
        <button
          type="button"
          aria-pressed={historyPreference === "auto"}
          onClick={() => setHistoryPreference("auto")}
          className={getOnboardingChoiceRowClassName(historyPreference === "auto")}
        >
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Import previous sessions</p>
            <p className="text-sm leading-5 text-muted-foreground">
              Add detected Claude Code and Codex history when setup finishes.
            </p>
          </div>
          <span
            aria-hidden="true"
            className={getOnboardingSelectionIndicatorClassName(historyPreference === "auto")}
          >
            <Check className="size-3.5 stroke-[3]" />
          </span>
        </button>

        <button
          type="button"
          aria-pressed={historyPreference === "manual"}
          onClick={() => setHistoryPreference("manual")}
          className={getOnboardingChoiceRowClassName(historyPreference === "manual")}
        >
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Start clean</p>
            <p className="text-sm leading-5 text-muted-foreground">Import later from Settings.</p>
          </div>
          <span
            aria-hidden="true"
            className={getOnboardingSelectionIndicatorClassName(historyPreference === "manual")}
          >
            <Check className="size-3.5 stroke-[3]" />
          </span>
        </button>
      </div>

      {historyPreference === "auto" ? (
        <div className="space-y-4">
          <div className={cn(ONBOARDING_INSET_CARD_CLASS_NAME, "px-4 py-3 sm:px-5")}>
            <p className="text-sm font-medium text-foreground">
              {snapshot?.totalImportableCount ?? 0} previous sessions will be imported.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Active sessions stay untouched; only completed history is added.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot?.providers.map((provider) => {
              const importableCount = provider.history.importableCount;
              const importableLabel =
                importableCount === 0
                  ? "No sessions ready to import"
                  : importableCount === 1
                    ? "1 session ready to import"
                    : `${importableCount} sessions ready to import`;
              const previewSessions = provider.history.preview.slice(0, 2);

              return (
                <div
                  key={provider.id}
                  className={cn(
                    ONBOARDING_INSET_CARD_CLASS_NAME,
                    "flex h-full flex-col p-4 sm:p-5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <ProviderIcon
                        provider={provider.id}
                        variant="brand"
                        size={36}
                        className="object-contain"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-semibold text-foreground">
                            {provider.displayName}
                          </p>
                          <Badge className={statusTone(provider.status)}>
                            {statusLabel(provider.status)}
                          </Badge>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{provider.detail}</p>
                        <p className="text-sm font-medium leading-6 text-foreground/82">
                          {importableLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-border/60 pt-3">
                    <p className="text-sm font-medium text-muted-foreground">Recent sessions</p>

                    {previewSessions.length > 0 ? (
                      <div className="mt-2 divide-y divide-border/60">
                        {previewSessions.map((session) => (
                          <div
                            key={`${provider.id}:${session.id}`}
                            className="min-w-0 py-2 first:pt-0 last:pb-0"
                          >
                            <p className="overflow-hidden text-sm font-medium text-foreground break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                              {session.title}
                            </p>
                            <p className="mt-1 truncate text-sm text-muted-foreground">
                              {compactPath(session.repoPath)}
                              {session.model ? ` • ${session.model}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        No recent sessions ready to import.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  ) : (
    <div className={cn(ONBOARDING_INSET_CARD_CLASS_NAME, "px-5 py-4 sm:px-6")}>
      <p className="text-base font-semibold text-foreground">Start with a clean dashboard</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        No completed Claude Code or Codex sessions were found. New sessions you start in AgTower
        will appear automatically.
      </p>
    </div>
  );
  const historyStepFooterHint =
    historyAdvanceBlockedHint ??
    (!hasImportableHistory
      ? "You can import history later from Settings if sessions appear."
      : historyPreference === "auto"
        ? "All detected sessions will be imported when you finish setup."
        : "You can import later from Settings.");
  const historyStepFooter = (
    <StepFooter hint={historyStepFooterHint}>
      <Button
        type="button"
        size={primaryActionButtonSize}
        className={cn(
          primaryActionButtonClassName,
          historyAdvanceBlockedHint && blockedPrimaryActionButtonClassName,
        )}
        aria-disabled={historyAdvanceBlockedHint ? true : undefined}
        disabled={isFinishing}
        title={historyAdvanceBlockedHint ?? undefined}
        onClick={() => handlePrimaryActionClick(historyAdvanceBlockedHint, goNext)}
      >
        Next
        <ArrowRight data-icon="inline-end" className="size-4" />
      </Button>
    </StepFooter>
  );
  const providerStepContent = (
    <div className="space-y-4">
      <div className="native-panel divide-y divide-border/55">
        {(snapshot?.providers ?? []).map((provider) => {
          const disabled = provider.status !== "ready";
          const providerMeta = SETUP_PROVIDER_META[provider.id];
          const providerDetails = (
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              <ProviderIcon
                provider={provider.id}
                variant="brand"
                size={40}
                className="object-contain"
              />

              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {provider.displayName}
                  </p>
                  <Badge className={statusTone(provider.status)}>
                    {statusLabel(provider.status)}
                  </Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">{provider.detail}</p>
              </div>
            </div>
          );

          if (disabled) {
            const needsPathFix = provider.status === "customPathInvalid";
            return (
              <div
                key={provider.id}
                className={cn(
                  getOnboardingChoiceRowClassName(false),
                  "cursor-default hover:bg-transparent",
                )}
              >
                {providerDetails}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-border/70 bg-background/70 hover:bg-background"
                  onClick={() => {
                    if (needsPathFix) {
                      navigate(`/settings?section=provider-${provider.id}`, { replace: true });
                    } else {
                      openSetupResource(providerMeta.website);
                    }
                  }}
                >
                  {needsPathFix ? "Fix path" : "Install"}
                  {needsPathFix ? (
                    <SettingsIcon className="size-3.5" />
                  ) : (
                    <ExternalLink className="size-3.5" />
                  )}
                </Button>
              </div>
            );
          }

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setSelectedProvider(provider.id)}
              aria-pressed={selectedProvider === provider.id}
              className={getOnboardingChoiceRowClassName(selectedProvider === provider.id)}
            >
              {providerDetails}

              <span
                aria-hidden="true"
                className={getOnboardingSelectionIndicatorClassName(
                  selectedProvider === provider.id,
                )}
              >
                <Check className="size-3.5 stroke-[3]" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
  const providerStepFooter = (
    <StepFooter hint={providerAdvanceBlockedHint ?? "You can change this later in Settings."}>
      <Button
        type="button"
        size={primaryActionButtonSize}
        className={cn(
          primaryActionButtonClassName,
          providerAdvanceBlockedHint && blockedPrimaryActionButtonClassName,
        )}
        aria-disabled={providerAdvanceBlockedHint ? true : undefined}
        title={providerAdvanceBlockedHint ?? undefined}
        onClick={() => handlePrimaryActionClick(providerAdvanceBlockedHint, goNext)}
      >
        Next
        <ArrowRight data-icon="inline-end" className="size-4" />
      </Button>
    </StepFooter>
  );
  const notificationsStepContent = (
    <div className="space-y-4">
      <div className={cn(ONBOARDING_INSET_CARD_CLASS_NAME, "p-5 sm:p-6")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-base font-semibold text-foreground">Desktop alerts</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {notificationsTool?.status === "ready"
                ? "Native alerts are already allowed on this Mac."
                : "Turn this on to ask macOS for permission and keep alerts on in AgTower."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge className={desktopAlertsBadgeClassName}>{desktopAlertsLabel}</Badge>
            <Switch
              checked={desktopNotificationsEnabled === true}
              aria-label="Desktop alerts"
              onCheckedChange={(checked) => void applyDesktopNotificationsChoice(checked)}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {notificationStepNotice ?? desktopAlertsDetail}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          className={cn(
            ONBOARDING_INSET_CARD_CLASS_NAME,
            "flex items-center justify-between gap-4 px-5 py-4 text-left control-transition-native outline-none hover:border-border hover:bg-background/78 focus-ring-default sm:px-6",
          )}
          onClick={() => openSetupResource(AGTOWER_WEBSITE_URL)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <ExternalLink className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Website</p>
              <p className="truncate text-sm text-muted-foreground">agtower.ai</p>
            </div>
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </button>

        <button
          type="button"
          className={cn(
            ONBOARDING_INSET_CARD_CLASS_NAME,
            "flex items-center justify-between gap-4 px-5 py-4 text-left control-transition-native outline-none hover:border-border hover:bg-background/78 focus-ring-default sm:px-6",
          )}
          onClick={() => openSetupResource(AGTOWER_REPO_URL)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Star className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Star repo</p>
              <p className="truncate text-sm text-muted-foreground">github.com/harflabs/agtower</p>
            </div>
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
  const notificationsStepFooter = (
    <StepFooter
      hint={notificationsAdvanceBlockedHint ?? "You can change alerts later in Settings."}
    >
      <Button
        type="button"
        size={primaryActionButtonSize}
        className={cn(
          primaryActionButtonClassName,
          notificationsAdvanceBlockedHint && blockedPrimaryActionButtonClassName,
        )}
        aria-disabled={notificationsAdvanceBlockedHint ? true : undefined}
        disabled={isFinishing}
        title={notificationsAdvanceBlockedHint ?? undefined}
        onClick={() =>
          handlePrimaryActionClick(notificationsAdvanceBlockedHint, () => {
            void finishFlow();
          })
        }
      >
        {isFinishing ? "Finishing…" : mode === "onboarding" ? "Finish" : "Done"}
        <ArrowRight data-icon="inline-end" className="size-4" />
      </Button>
    </StepFooter>
  );

  return (
    <div
      className={cn(shellClassName, "selection-chrome")}
      data-onboarding-step={step}
      data-testid="setup-assistant"
    >
      <div className={panelClassName}>
        {showOnboardingChrome ? (
          <div
            data-window-drag-surface
            onMouseDownCapture={handleOnboardingDragMouseDown}
            onDoubleClickCapture={handleOnboardingDragDoubleClick}
            className="sticky top-0 z-20 flex justify-center border-b border-border/35 bg-background/55 px-6 py-3 backdrop-blur-md lg:px-10"
          >
            <div className="flex items-center gap-3">
              <ProgressRail currentStep={step} steps={steps} onStepSelect={handleStepSelect} />
            </div>
          </div>
        ) : showSettingsRail ? (
          <div className="px-1 pt-1">
            <ProgressRail currentStep={step} steps={steps} onStepSelect={handleStepSelect} />
          </div>
        ) : null}

        {step === "welcome" ? (
          <motion.div
            key="welcome"
            className="relative flex min-h-0 flex-1"
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            {IS_MACOS ? (
              <div
                data-window-drag-surface
                onMouseDownCapture={handleOnboardingDragMouseDown}
                onDoubleClickCapture={handleOnboardingDragDoubleClick}
                className="absolute inset-x-0 top-0 z-20 h-[var(--window-native-titlebar-height)]"
              />
            ) : null}
            <SetupAssistantWelcomeScreen
              key={welcomeReplayToken}
              onStart={goToDemo}
              contentClassName={welcomeStepClassName}
            />
          </motion.div>
        ) : null}

        {step === "demo" ? (
          <motion.div
            key="demo"
            className={onboardingStepMotionClassName}
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            <StepShell
              containerClassName={onboardingStepShellClassName}
              title={demoStepTitle}
              description={demoStepDescription}
            >
              <div className={cn(fullscreenStepClassName, "gap-5")}>
                <DemoBoard
                  activeSessionId={demoActiveSessionId}
                  sessionEntries={activeDemoSessionEntries}
                  sessionInputRef={demoSessionInputRef}
                  sessionInputValue={activeDemoSessionInput}
                  onOpenSession={openDemoSessionAndMarkComplete}
                  onOpenDashboard={openDemoDashboardAndMarkComplete}
                  onSessionInputChange={(value) =>
                    setDemoSessionInputsById((current) => ({
                      ...current,
                      [demoActiveSessionId]: value,
                    }))
                  }
                  onSessionInputSubmit={submitDemoSessionInput}
                  paletteOpen={paletteOpen}
                  sessionClosed={demoSessionClosed}
                  view={demoView}
                />

                <StepFooterDock sticky={stickyFooter}>
                  <StepFooter
                    hint={
                      paletteOpen && filteredPaletteCommands.length === 0 ? (
                        "Type to search."
                      ) : paletteOpen ? (
                        <>
                          Use arrows, then press{" "}
                          <Kbd size="sm" className="mx-1 inline-flex align-middle">
                            Enter
                          </Kbd>
                          .
                        </>
                      ) : demoActionsRun === 0 ? (
                        <>
                          Optional: use the visible actions or open the palette with{" "}
                          <Kbd size="sm" className="mx-1 inline-flex align-middle">
                            {platformCommandLabel}
                          </Kbd>
                          .
                        </>
                      ) : (
                        demoFooterHint
                      )
                    }
                  >
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="rounded-md border-border/70 bg-background/70 px-3.5 hover:bg-background"
                        data-testid="onboarding-demo-primary-action"
                        onClick={
                          demoView === "dashboard"
                            ? () => openDemoSessionAndMarkComplete()
                            : openDemoDashboardAndMarkComplete
                        }
                      >
                        {demoView === "dashboard" ? (
                          <TerminalSquare className="size-4" />
                        ) : (
                          <LayoutDashboard className="size-4" />
                        )}
                        {demoView === "dashboard" ? "Open sample session" : "Dashboard"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="rounded-md border-border/70 bg-background/70 px-3.5 hover:bg-background"
                        data-testid="onboarding-demo-theme-action"
                        onClick={toggleDemoThemeAndMarkComplete}
                      >
                        {demoTheme === "dark" ? (
                          <Sun className="size-4" />
                        ) : (
                          <Moon className="size-4" />
                        )}
                        {demoTheme === "dark" ? "Light" : "Dark"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="rounded-md border-border/70 bg-background/70 px-3.5 hover:bg-background"
                        data-testid="onboarding-demo-palette-action"
                        onClick={openDemoPalette}
                      >
                        <CommandIcon className="size-4" />
                        Palette
                      </Button>
                      <Button type="button" size="lg" className="rounded-md px-4" onClick={goNext}>
                        Next
                        <ArrowRight data-icon="inline-end" className="size-4" />
                      </Button>
                    </div>
                  </StepFooter>
                </StepFooterDock>
              </div>
            </StepShell>
          </motion.div>
        ) : null}

        {step === "system" ? (
          <motion.div
            key="system"
            className={onboardingStepMotionClassName}
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            {mode === "settings" ? (
              <SettingsStepCard
                title={systemStepTitle}
                description={systemStepDescription}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshSnapshot()}
                  >
                    Refresh
                  </Button>
                }
                footer={systemStepFooter}
              >
                {systemStepContent}
              </SettingsStepCard>
            ) : (
              <StepShell
                containerClassName={onboardingStepShellClassName}
                title={systemStepTitle}
                description={systemStepDescription}
              >
                <div className={fullscreenStepClassName}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {providerAvailabilitySummary}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-border/70 bg-background/70 hover:bg-background"
                      onClick={() => void refreshSnapshot()}
                    >
                      Refresh
                    </Button>
                  </div>

                  {systemStepContent}

                  <StepFooterDock sticky={stickyFooter}>{systemStepFooter}</StepFooterDock>
                </div>
              </StepShell>
            )}
          </motion.div>
        ) : null}

        {step === "history" ? (
          <motion.div
            key="history"
            className={onboardingStepMotionClassName}
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            {mode === "settings" ? (
              <SettingsStepCard
                title={historyStepTitle}
                description={historyStepDescription}
                footer={historyStepFooter}
              >
                {historyStepContent}
              </SettingsStepCard>
            ) : (
              <StepShell
                containerClassName={onboardingStepShellClassName}
                title={historyStepTitle}
                description={historyStepDescription}
              >
                <div className={fullscreenStepClassName}>
                  <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
                    {historyStepContent}
                  </div>

                  <StepFooterDock sticky={stickyFooter}>{historyStepFooter}</StepFooterDock>
                </div>
              </StepShell>
            )}
          </motion.div>
        ) : null}

        {step === "provider" ? (
          <motion.div
            key="provider"
            className={onboardingStepMotionClassName}
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            {mode === "settings" ? (
              <SettingsStepCard
                title={providerStepTitle}
                description={providerStepDescription}
                footer={providerStepFooter}
              >
                {providerStepContent}
              </SettingsStepCard>
            ) : (
              <StepShell
                containerClassName={onboardingStepShellClassName}
                title={providerStepTitle}
                description={providerStepDescription}
              >
                <div className={fullscreenStepClassName}>
                  <div className="min-h-0 flex-1">{providerStepContent}</div>

                  <StepFooterDock sticky={stickyFooter}>{providerStepFooter}</StepFooterDock>
                </div>
              </StepShell>
            )}
          </motion.div>
        ) : null}

        {step === "notifications" ? (
          <motion.div
            key="notifications"
            className={onboardingStepMotionClassName}
            initial={stepMotionInitial}
            animate={stepMotionAnimate}
            exit={stepMotionExit}
            transition={stepMotionTransition}
          >
            {mode === "settings" ? (
              <SettingsStepCard
                title={notificationsStepTitle}
                description={notificationsStepDescription}
                footer={notificationsStepFooter}
              >
                {notificationsStepContent}
              </SettingsStepCard>
            ) : (
              <StepShell
                containerClassName={onboardingStepShellClassName}
                title={notificationsStepTitle}
                description={notificationsStepDescription}
              >
                <div className={fullscreenStepClassName}>
                  <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
                    {notificationsStepContent}
                  </div>

                  <StepFooterDock sticky={stickyFooter}>{notificationsStepFooter}</StepFooterDock>
                </div>
              </StepShell>
            )}
          </motion.div>
        ) : null}

        <AnimatePresence>
          {canUseSetupPalette && paletteOpen ? (
            <DemoPalette
              commands={filteredPaletteCommands}
              query={demoSearch}
              selectedIndex={demoSelectedCommandIndex}
              inputRef={demoInputRef}
              onDismiss={closeDemoPalette}
              onSearchChange={(value) => {
                setDemoSearch(value);
                setDemoSelectedCommandIndex(0);
              }}
              onCommandHover={setDemoSelectedCommandIndex}
              onCommandSelect={executePaletteCommand}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
