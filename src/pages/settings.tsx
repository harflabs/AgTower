import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bell,
  BellRing,
  Cpu,
  DatabaseZap,
  Info,
  Laptop,
  Monitor,
  Moon,
  SquareSplitHorizontal,
  Sun,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useAppShellToolbar } from "@/components/app-shell-toolbar";
import { SetupAssistant } from "@/components/setup-assistant/setup-assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreferenceSelect } from "@/components/ui/preference-select";
import { Switch } from "@/components/ui/switch";
import { useWindowTitle } from "@/hooks/use-window-title";
import { clearClientSessionState, resetClientAppState } from "@/lib/app-reset";
import { APP_VERSION, readAppVersion } from "@/lib/app-version";
import { clearSessionCache, resetEverything } from "@/lib/engine";
import { confirmDestructiveAction } from "@/lib/native-dialog";
import {
  setArchiveAfterDays,
  setDefaultProviderPreference,
  setDesktopNotificationsEnabled,
  setInAppNotificationsEnabled,
  setLaunchInTmuxEnabled,
  setNotificationSoundEnabled,
  setStartupBehaviorPreference,
  setThemeMode,
} from "@/lib/settings-actions";
import { resolveSettingsDetail } from "@/lib/toolbar-meta";
import { cn } from "@/lib/utils";
import { getAllProviders } from "@/providers/registry";
import { useProviderAvailabilityStore } from "@/stores/provider-availability-store";
import { useSettingsStore } from "@/stores/settings-store";

const SETTINGS_GROUP_CLASS_NAME = "native-panel";
const SETTINGS_HEADER_CLASS_NAME = "native-panel-header";
const SETTINGS_CONTENT_CLASS_NAME = "native-panel-content";

/** Render a relative-time string like "2 minutes ago" with sane fallbacks. */
function formatLastChecked(timestamp: number | null): string {
  if (timestamp === null) return "Not yet checked";
  const ageMs = Date.now() - timestamp;
  if (ageMs < 30_000) return "Just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "Less than a minute ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleString();
}

/**
 * Surface the cached provider availability the rest of the app uses to
 * gate create-session affordances. Each provider gets a row showing
 * "Available • v1.2.3" or "Not available" so the user can confirm what
 * AgTower thinks the state is, plus a Refresh button that re-probes
 * every provider's CLI without restarting the app — needed after the
 * user installs / uninstalls / changes the path of a CLI.
 */
function ProviderAvailabilitySection() {
  const allProviders = useMemo(() => getAllProviders(), []);
  const availability = useProviderAvailabilityStore((s) => s.availability);
  const isRefreshing = useProviderAvailabilityStore((s) => s.isRefreshing);
  const lastRefreshedAt = useProviderAvailabilityStore((s) => s.lastRefreshedAt);
  const refresh = useProviderAvailabilityStore((s) => s.refresh);

  return (
    <section className={SETTINGS_GROUP_CLASS_NAME}>
      <header className={SETTINGS_HEADER_CLASS_NAME}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={SETTINGS_TITLE_CLASS_NAME}>Provider availability</h2>
            <p className={SETTINGS_DESCRIPTION_CLASS_NAME}>
              AgTower hides "New Session" affordances for providers whose CLI it can't reach.
              Refresh after installing, uninstalling, or repointing a CLI.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          Last checked: {formatLastChecked(lastRefreshedAt)}
        </p>
      </header>

      <div className={SETTINGS_CONTENT_CLASS_NAME}>
        {allProviders.map((provider) => {
          const entry = availability[provider.id];
          // No entry → optimistic "Available" matches what the gating
          // logic in useAvailableProviders does on cold start.
          const available = entry === undefined ? true : entry.available;
          const detail = entry?.version
            ? `${available ? "Available" : "Not available"} • v${entry.version}`
            : available
              ? entry === undefined
                ? "Awaiting first check"
                : "Available"
              : "Not available";
          return (
            <div key={provider.id} className="native-preference-row">
              <span className="text-sm font-medium">{provider.displayName}</span>
              <span
                className={cn(
                  "native-badge-subtle text-[11px]",
                  !available && "border-destructive/25 text-destructive",
                )}
              >
                {detail}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
const SETTINGS_ROW_CLASS_NAME = "native-preference-row";
const SETTINGS_ROW_ICON_CLASS_NAME = "size-4 shrink-0 text-muted-foreground";
const SETTINGS_TITLE_CLASS_NAME = "text-sm font-semibold text-foreground";
const SETTINGS_DESCRIPTION_CLASS_NAME = "mt-1 text-xs leading-5 text-muted-foreground";
const SETTINGS_DESTRUCTIVE_ROW_CLASS_NAME = "native-danger-row";

export default function Settings() {
  useWindowTitle("AgTower — Settings");
  const location = useLocation();
  const navigate = useNavigate();
  const notifications = useSettingsStore((s) => s.notifications);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const startupBehavior = useSettingsStore((s) => s.startupBehavior);
  const theme = useSettingsStore((s) => s.theme);
  const archiveAfterDays = useSettingsStore((s) => s.archiveAfterDays);
  const [archiveAfterDaysInput, setArchiveAfterDaysInput] = useState(String(archiveAfterDays));
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const launchInTmux = useSettingsStore((s) => s.launchInTmux);

  async function handleLaunchInTmuxChange(next: boolean) {
    if (!next) {
      setLaunchInTmuxEnabled(false);
      return;
    }
    try {
      const result = await invoke<{ available: boolean; version: string | null }>(
        "check_tmux_available",
      );
      if (!result.available) {
        toast.error("tmux not found. Install it first (e.g. `brew install tmux`) and try again.");
        return;
      }
      setLaunchInTmuxEnabled(true);
      toast.success(
        result.version
          ? `New sessions will launch in ${result.version}.`
          : "New sessions will launch in tmux.",
      );
    } catch (err) {
      toast.error(`Failed to check tmux: ${String(err)}`);
    }
  }

  async function handleDesktopNotificationsChange(next: boolean) {
    try {
      await setDesktopNotificationsEnabled(next);
    } catch (err) {
      toast.error(`Failed to save desktop notification setting: ${String(err)}`);
    }
  }

  async function handleNotificationSoundChange(next: boolean) {
    try {
      await setNotificationSoundEnabled(next);
    } catch (err) {
      toast.error(`Failed to save notification sound setting: ${String(err)}`);
    }
  }

  const providers = useMemo(() => getAllProviders(), []);
  const providerDisplayNames = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.id, provider.displayName])),
    [providers],
  );
  const isSetupAssistantOpen = new URLSearchParams(location.search).get("assistant") === "setup";
  const shellToolbarDescriptor = useMemo(
    () => ({
      detail: isSetupAssistantOpen
        ? "Inspect providers, history, and defaults"
        : resolveSettingsDetail(location.search, providerDisplayNames),
      kind: "title" as const,
      title: isSetupAssistantOpen ? "Setup Assistant" : "Settings",
    }),
    [isSetupAssistantOpen, location.search, providerDisplayNames],
  );
  useAppShellToolbar(shellToolbarDescriptor);

  useEffect(() => {
    setArchiveAfterDaysInput(String(archiveAfterDays));
  }, [archiveAfterDays]);

  useEffect(() => {
    let mounted = true;
    void readAppVersion().then((version) => {
      if (mounted) setAppVersion(version);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sectionId = params.get("section");
    if (!sectionId) return;

    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [location.search]);

  async function saveArchiveAfterDays() {
    const next = Number.parseInt(archiveAfterDaysInput, 10);
    if (!Number.isFinite(next) || next < 1) {
      setArchiveAfterDaysInput(String(archiveAfterDays));
      toast.error("Auto-archive days must be at least 1");
      return;
    }
    if (next === archiveAfterDays) return;

    try {
      await setArchiveAfterDays(next);
      toast.success("Auto-archive updated");
    } catch (err) {
      setArchiveAfterDaysInput(String(archiveAfterDays));
      toast.error(`Failed to save auto-archive setting: ${String(err)}`);
    }
  }

  async function handleClearSessionCache() {
    const confirmed = await confirmDestructiveAction({
      title: "Clear session cache?",
      message:
        "This will delete all session data from the app database. On restart, sessions will be re-imported from agent files with correct session IDs. Your workspaces and agent conversation history are not affected.",
      okLabel: "Clear Cache",
    });
    if (!confirmed) return;

    try {
      await clearSessionCache();
      clearClientSessionState();
      toast.success("Session cache cleared. Restart the app to re-import sessions.");
    } catch (err) {
      toast.error(`Failed to clear cache: ${String(err)}`);
    }
  }

  async function handleResetEverything() {
    const confirmed = await confirmDestructiveAction({
      title: "Reset everything?",
      message:
        "This will delete the entire app database, including sessions, workspace state, and settings. Agent conversation data is not affected. You will need to re-add your workspaces after restarting the app.",
      okLabel: "Reset Everything",
    });
    if (!confirmed) return;

    try {
      await resetEverything();
      resetClientAppState();
      toast.success("Everything reset. Restart the app now.");
    } catch (err) {
      toast.error(`Failed to reset: ${String(err)}`);
    }
  }

  if (isSetupAssistantOpen) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[min(96rem,100vw)] flex-col gap-4 p-5">
          <div className="flex justify-start">
            <Button variant="ghost" className="gap-2" onClick={() => navigate("/settings")}>
              <ArrowLeft className="size-4" />
              Back to Settings
            </Button>
          </div>
          <SetupAssistant mode="settings" onDone={() => navigate("/settings", { replace: true })} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-4 p-5">
        <div className="space-y-4">
          <section className={SETTINGS_GROUP_CLASS_NAME}>
            <header className={SETTINGS_HEADER_CLASS_NAME}>
              <h2 className={SETTINGS_TITLE_CLASS_NAME}>Setup Assistant</h2>
              <p className={SETTINGS_DESCRIPTION_CLASS_NAME}>
                Re-check installed providers, inspect importable history, and update your default
                onboarding choices.
              </p>
            </header>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Open the guided setup assistant any time to review what AgTower found on your
                system, bring past sessions in, or reset your default provider path.
              </p>
              <Button onClick={() => navigate("/settings?assistant=setup")}>Open Assistant</Button>
            </div>
          </section>

          <section className={SETTINGS_GROUP_CLASS_NAME}>
            <header className={SETTINGS_HEADER_CLASS_NAME}>
              <h2 className={SETTINGS_TITLE_CLASS_NAME}>General</h2>
              <p className={SETTINGS_DESCRIPTION_CLASS_NAME}>
                Application settings and startup behavior
              </p>
            </header>
            <div className={SETTINGS_CONTENT_CLASS_NAME}>
              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <Monitor className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label className="text-sm font-medium">Startup behavior</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose what to show when the app launches
                    </p>
                  </div>
                </div>
                <PreferenceSelect
                  value={startupBehavior}
                  onValueChange={setStartupBehaviorPreference}
                  className="w-[190px]"
                  options={[
                    { value: "dashboard", label: "Show Dashboard" },
                    { value: "restore", label: "Restore Last Session" },
                  ]}
                />
              </div>

              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  {theme === "dark" ? (
                    <Moon className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  ) : theme === "light" ? (
                    <Sun className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  ) : (
                    <Laptop className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  )}
                  <div>
                    <Label className="text-sm font-medium">Theme</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose your preferred appearance
                    </p>
                  </div>
                </div>
                <PreferenceSelect
                  value={theme}
                  onValueChange={setThemeMode}
                  className="w-[190px]"
                  options={[
                    { value: "system", label: "System" },
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                  ]}
                />
              </div>

              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <Cpu className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label className="text-sm font-medium">Default agent provider</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose which provider new sessions should start with
                    </p>
                  </div>
                </div>
                <PreferenceSelect
                  value={defaultProvider}
                  onValueChange={setDefaultProviderPreference}
                  className="w-[190px]"
                  options={providers.map((provider) => ({
                    value: provider.id,
                    label: provider.displayName,
                  }))}
                />
              </div>

              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <Archive className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label htmlFor="archive-after-days" className="text-sm font-medium">
                      Auto-archive closed sessions
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Closed sessions move to Archived after this many days
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="archive-after-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={archiveAfterDaysInput}
                    onChange={(e) => setArchiveAfterDaysInput(e.target.value)}
                    onBlur={() => void saveArchiveAfterDays()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-20 text-right tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              </div>

              <div className="native-preference-row-start">
                <div className="flex flex-1 items-start gap-3">
                  <SquareSplitHorizontal className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label htmlFor="launch-in-tmux" className="text-sm font-medium">
                      Launch sessions in tmux{" "}
                      <span className="native-badge-subtle ml-1 uppercase tracking-wide">
                        Experimental
                      </span>
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Wraps every new session in <code className="text-xs">tmux new-session</code>.
                      Unlocks Claude Code&apos;s native agent-teams split-pane mode. Requires{" "}
                      <code className="text-xs">tmux</code> to be installed (e.g.{" "}
                      <code className="text-xs">brew install tmux</code>).
                    </p>
                  </div>
                </div>
                <Switch
                  id="launch-in-tmux"
                  checked={launchInTmux}
                  onCheckedChange={(checked) => void handleLaunchInTmuxChange(checked)}
                  className="mt-1 shrink-0"
                />
              </div>
            </div>
          </section>

          <ProviderAvailabilitySection />

          {providers.map((provider) => (
            <section
              key={provider.id}
              id={`provider-${provider.id}`}
              className={SETTINGS_GROUP_CLASS_NAME}
            >
              <provider.settings.SettingsSection />
            </section>
          ))}

          <section className={SETTINGS_GROUP_CLASS_NAME}>
            <header className={SETTINGS_HEADER_CLASS_NAME}>
              <h2 className={SETTINGS_TITLE_CLASS_NAME}>Notifications</h2>
              <p className={SETTINGS_DESCRIPTION_CLASS_NAME}>
                Configure how you're notified when agents finish
              </p>
            </header>
            <div className={SETTINGS_CONTENT_CLASS_NAME}>
              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <Bell className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label htmlFor="desktop-notifications" className="text-sm font-medium">
                      Desktop notifications
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show native OS notifications when agents complete or error
                    </p>
                  </div>
                </div>
                <Switch
                  id="desktop-notifications"
                  checked={notifications.desktop}
                  onCheckedChange={(checked) => void handleDesktopNotificationsChange(checked)}
                />
              </div>

              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <BellRing className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label htmlFor="inapp-notifications" className="text-sm font-medium">
                      In-app toasts
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show toast notifications inside the app
                    </p>
                  </div>
                </div>
                <Switch
                  id="inapp-notifications"
                  checked={notifications.inApp}
                  onCheckedChange={setInAppNotificationsEnabled}
                />
              </div>

              <div className={SETTINGS_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <Volume2 className={SETTINGS_ROW_ICON_CLASS_NAME} />
                  <div>
                    <Label htmlFor="sound-notifications" className="text-sm font-medium">
                      Sound
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Play a sound when agents complete or error
                    </p>
                  </div>
                </div>
                <Switch
                  id="sound-notifications"
                  checked={notifications.sound}
                  onCheckedChange={(checked) => void handleNotificationSoundChange(checked)}
                />
              </div>
            </div>
          </section>

          <section className={SETTINGS_GROUP_CLASS_NAME}>
            <header className={SETTINGS_HEADER_CLASS_NAME}>
              <h2 className={SETTINGS_TITLE_CLASS_NAME}>About</h2>
            </header>
            <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <Info className={SETTINGS_ROW_ICON_CLASS_NAME} />
                <div className="space-y-1">
                  <p>
                    <span className="font-medium text-foreground">AgTower</span> v{appVersion}
                  </p>
                  <p>Tauri 2 + React 19</p>
                </div>
              </div>
            </div>
          </section>

          <section className={cn(SETTINGS_GROUP_CLASS_NAME, "border-destructive/20")}>
            <header className={SETTINGS_HEADER_CLASS_NAME}>
              <h2 className={SETTINGS_TITLE_CLASS_NAME}>Data</h2>
              <p className={SETTINGS_DESCRIPTION_CLASS_NAME}>
                Reset local AgTower state. Agent conversation data is not affected.
              </p>
            </header>
            <div className="space-y-0 px-4 py-1.5">
              <div className={SETTINGS_DESTRUCTIVE_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <DatabaseZap className="size-4 shrink-0 text-destructive" />
                  <div>
                    <Label className="text-sm font-medium">Clear Session Cache</Label>
                    <p className="text-sm text-muted-foreground">
                      Deletes all session data from the app. Sessions will be re-imported from agent
                      session files on restart with correct session IDs. Workspaces are preserved.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-4 shrink-0"
                  onClick={() => void handleClearSessionCache()}
                >
                  Clear Cache...
                </Button>
              </div>

              <div className={SETTINGS_DESTRUCTIVE_ROW_CLASS_NAME}>
                <div className="flex items-center gap-3">
                  <AlertTriangle className="size-4 shrink-0 text-destructive" />
                  <div>
                    <Label className="text-sm font-medium">Reset Everything</Label>
                    <p className="text-sm text-muted-foreground">
                      Deletes the entire app database including sessions, workspaces, and all
                      settings. You&apos;ll need to re-add workspaces after restart.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-4 shrink-0"
                  onClick={() => void handleResetEverything()}
                >
                  Reset Everything...
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
