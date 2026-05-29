import { Download, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { updaterActions } from "@/hooks/use-updater";
import { cn } from "@/lib/utils";
import { useUpdaterStore } from "@/stores/updater-store";

export function UpdatePill() {
  const status = useUpdaterStore((s) => s.status);
  const dismissed = useUpdaterStore((s) => s.dismissed);
  const availableVersion = useUpdaterStore((s) => s.availableVersion);
  const downloadPercent = useUpdaterStore((s) => s.downloadPercent);
  const errorContext = useUpdaterStore((s) => s.errorContext);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  // Only show when there's something actionable. "idle" / "checking" /
  // "up-to-date" stay quiet so we don't nag users on every startup.
  const actionable =
    status === "available" ||
    status === "downloading" ||
    status === "ready" ||
    (status === "error" && errorContext !== "check");

  if (!actionable) return null;
  if (status === "available" && dismissed) return null;

  const onDownload = () => {
    void updaterActions.download().catch((err) => {
      toast.error("Could not download update", { description: errorMessage(err) });
    });
  };

  const onInstall = () => {
    toast("Preparing update...");
    void updaterActions.install().catch((err) => {
      toast.error("Could not install update", { description: errorMessage(err) });
    });
  };

  if (status === "downloading") {
    return (
      <PillShell tone="info">
        <RotateCw className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">
          Downloading update {downloadPercent > 0 ? `${downloadPercent}%` : ""}
        </span>
      </PillShell>
    );
  }

  if (status === "ready") {
    return (
      <PillShell
        tone="success"
        onClick={onInstall}
        title={availableVersion ? `Install AgTower ${availableVersion}` : "Install update"}
      >
        <RotateCw className="size-3.5 shrink-0" />
        <span className="truncate">Restart to update</span>
      </PillShell>
    );
  }

  if (status === "error") {
    // Retry the action that actually failed — retrying a download for an
    // install failure just re-downloads the same archive the installer
    // has already staged.
    const retry = errorContext === "install" ? onInstall : onDownload;
    const label = errorContext === "install" ? "Install failed, retry" : "Update failed, retry";
    return (
      <PillShell tone="danger" onClick={retry} title="Retry">
        <RotateCw className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </PillShell>
    );
  }

  // status === "available"
  return (
    <PillShell tone="info">
      <button
        type="button"
        onClick={onDownload}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none focus-ring-default-inset"
      >
        <Download className="size-3.5 shrink-0" />
        <span className="truncate">
          Update {availableVersion ? `to ${availableVersion}` : "available"}
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        aria-label="Dismiss update notification"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/70 control-transition-native outline-none hover:bg-sidebar-interactive-hover hover:text-foreground focus-ring-default-inset"
      >
        <X className="size-3" />
      </button>
    </PillShell>
  );
}

type Tone = "info" | "success" | "danger";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

const toneClass = (tone: Tone) =>
  tone === "success"
    ? "border-sidebar-border/70 bg-background/60 text-foreground/85 hover:bg-sidebar-interactive-hover"
    : tone === "danger"
      ? "border-destructive/24 bg-destructive/10 text-destructive hover:bg-destructive/16"
      : "border-sidebar-border/70 bg-background/60 text-foreground/85 hover:bg-sidebar-interactive-hover";

const pillBase =
  "selection-chrome mb-1.5 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs control-transition-native";

function PillShell({
  tone,
  children,
  onClick,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(
          pillBase,
          toneClass(tone),
          "w-full cursor-pointer text-left outline-none focus-ring-default-inset",
        )}
      >
        {children}
      </button>
    );
  }
  return <div className={cn(pillBase, toneClass(tone))}>{children}</div>;
}
