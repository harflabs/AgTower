import { Bot, Plus, SlidersHorizontal, Terminal, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreferenceSelect } from "@/components/ui/preference-select";
import { cn } from "@/lib/utils";
import { getProvider } from "@/providers/registry";
import type { LaunchOption } from "@/providers/types";
import { useSettingsStore } from "@/stores/settings-store";

/** One launch-option default row. Subscribes to its own settings value so a
 *  change re-renders just this control rather than the whole section. */
function LaunchOptionRow({ providerId, option }: { providerId: string; option: LaunchOption }) {
  const value = useSettingsStore(
    (s) => (s.providerSettings[providerId]?.[option.key] as string) ?? "",
  );
  const setProviderSetting = useSettingsStore((s) => s.setProviderSetting);
  const controlId = useId();

  return (
    <div className="native-preference-row-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <Label htmlFor={controlId} className="text-sm font-medium">
            {option.label}
          </Label>
          {option.description ? (
            <p className="text-sm text-muted-foreground">{option.description}</p>
          ) : null}
        </div>
      </div>
      <div className="native-preference-control mt-0.5">
        <PreferenceSelect
          className="w-[190px]"
          value={value}
          onValueChange={(next) => setProviderSetting(providerId, option.key, next)}
          options={option.choices.map((choice) => ({
            value: choice.value,
            label: choice.label,
          }))}
        />
      </div>
    </div>
  );
}

interface ProviderCliInfo {
  available: boolean;
  version: string | null;
}

interface ProviderSettingsSectionProps {
  providerId: string;
  title: string;
  description: string;
  versionLabel: string;
  notFoundLabel: string;
  cliLabel: string;
  cliPlaceholder: string;
  defaultModelPlaceholder: string;
  envDescription: string;
  detectCli: (cliPath?: string) => Promise<ProviderCliInfo>;
}

export function ProviderSettingsSection({
  providerId,
  title,
  description,
  versionLabel,
  notFoundLabel,
  cliLabel,
  cliPlaceholder,
  defaultModelPlaceholder,
  envDescription,
  detectCli,
}: ProviderSettingsSectionProps) {
  const cliPath = useSettingsStore(
    (s) => (s.providerSettings[providerId]?.cliPath as string) ?? "",
  );
  const defaultModel = useSettingsStore(
    (s) => (s.providerSettings[providerId]?.defaultModel as string) ?? "",
  );
  const envVars = useSettingsStore(
    useShallow((s) => (s.providerSettings[providerId]?.envVars as Record<string, string>) ?? {}),
  );
  const setProviderSetting = useSettingsStore((s) => s.setProviderSetting);

  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [cliInfo, setCliInfo] = useState<ProviderCliInfo | null>(null);
  const sectionId = useId();
  const cliPathId = `${sectionId}-cli-path`;
  const defaultModelId = `${sectionId}-default-model`;
  const newEnvKeyId = `${sectionId}-new-env-key`;
  const newEnvValueId = `${sectionId}-new-env-value`;

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      detectCli(cliPath)
        .then((info) => {
          if (!cancelled) {
            setCliInfo(info);
          }
        })
        .catch(() => {});
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [cliPath, detectCli]);

  const setCliPath = (path: string) => setProviderSetting(providerId, "cliPath", path);
  const setDefaultModel = (model: string) => setProviderSetting(providerId, "defaultModel", model);

  const setEnvVar = (key: string, value: string) => {
    const existing =
      (useSettingsStore.getState().providerSettings[providerId]?.envVars as Record<
        string,
        string
      >) ?? {};
    setProviderSetting(providerId, "envVars", { ...existing, [key]: value });
  };

  const removeEnvVar = (key: string) => {
    const existing = {
      ...((useSettingsStore.getState().providerSettings[providerId]?.envVars as Record<
        string,
        string
      >) ?? {}),
    };
    delete existing[key];
    setProviderSetting(providerId, "envVars", existing);
  };

  const statusText = cliInfo
    ? cliInfo.available
      ? cliInfo.version
        ? `${versionLabel}: ${cliInfo.version}`
        : `${versionLabel}: installed`
      : notFoundLabel
    : null;

  return (
    <>
      <header className="native-panel-header">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
          {statusText ? (
            <span
              className={cn(
                "native-badge-subtle mt-0.5 max-w-[14rem] truncate",
                !cliInfo?.available && "border-destructive/25 text-destructive",
              )}
            >
              {statusText}
            </span>
          ) : null}
        </div>
      </header>

      <div className="native-panel-content">
        <div className="native-preference-row-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <Label htmlFor={cliPathId} className="text-sm font-medium">
                {cliLabel}
              </Label>
              <p className="text-sm text-muted-foreground">Auto-detects from PATH when empty</p>
            </div>
          </div>
          <div className="native-preference-control mt-0.5">
            <Input
              id={cliPathId}
              placeholder={cliPlaceholder}
              value={cliPath}
              onChange={(event) => setCliPath(event.target.value)}
            />
          </div>
        </div>

        <div className="native-preference-row-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <Label htmlFor={defaultModelId} className="text-sm font-medium">
                Default model
              </Label>
              <p className="text-sm text-muted-foreground">Provider default when empty</p>
            </div>
          </div>
          <div className="native-preference-control mt-0.5">
            <Input
              id={defaultModelId}
              aria-label={`${title} default model`}
              placeholder={defaultModelPlaceholder}
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </div>
        </div>

        {(getProvider(providerId)?.launchOptions ?? []).map((option) => (
          <LaunchOptionRow key={option.key} providerId={providerId} option={option} />
        ))}

        <div className="native-preference-row-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <Label htmlFor={newEnvKeyId} className="text-sm font-medium">
                Environment variables
              </Label>
              <p className="text-sm text-muted-foreground">{envDescription}</p>
            </div>
          </div>
          <div className="native-preference-control space-y-1.5">
            {Object.entries(envVars).map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5"
              >
                <Input
                  aria-label={`${title} ${key} environment variable name`}
                  className="font-mono text-[12px]"
                  value={key}
                  readOnly
                />
                <Input
                  aria-label={`${title} ${key} environment variable value`}
                  className="font-mono text-[12px]"
                  value={value}
                  onBlur={(event) => setEnvVar(key, event.target.value)}
                  onChange={(event) => setEnvVar(key, event.target.value)}
                />
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 shrink-0"
                  label={`Remove ${title} ${key}`}
                  onClick={() => removeEnvVar(key)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5">
              <Input
                id={newEnvKeyId}
                aria-label={`${title} new environment variable name`}
                className="font-mono text-[12px]"
                placeholder="KEY"
                value={newEnvKey}
                onChange={(event) => setNewEnvKey(event.target.value)}
              />
              <Input
                id={newEnvValueId}
                aria-label={`${title} new environment variable value`}
                className="font-mono text-[12px]"
                placeholder="value"
                value={newEnvValue}
                onChange={(event) => setNewEnvValue(event.target.value)}
              />
              <IconButton
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0"
                label={`Add ${title} environment variable`}
                disabled={!newEnvKey.trim()}
                onClick={() => {
                  if (!newEnvKey.trim()) return;
                  setEnvVar(newEnvKey.trim(), newEnvValue);
                  setNewEnvKey("");
                  setNewEnvValue("");
                }}
              >
                <Plus className="size-3.5" />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
