import { FileEdit, GitPullRequest, MoreHorizontal, Users, X } from "lucide-react";
import {
  type Dispatch,
  Fragment,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AppShellToolbarActionRail } from "@/components/app-shell-toolbar-content";
import { Breadcrumb } from "@/components/breadcrumb";
import { StopIcon } from "@/components/icons/stop-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  createContextMenuHandler,
  type NativeMenuItemSpec,
  showNativeMenuForElement,
} from "@/lib/native-menu";
import { formatDuration } from "@/lib/session-helpers";
import { StatusDot } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import { getProvider } from "@/providers/registry";
import { useSessionStore } from "@/stores/session-store";

interface SessionToolbarProps {
  sessionId: string;
  onDelete?: () => void;
  onArchive?: () => void;
  onStop?: () => void;
  onClose?: () => void;
}

type SessionToolbarDensity = "page" | "shell";

type SessionRecord = NonNullable<ReturnType<typeof useSessionStore.getState>["sessions"][string]>;

type SessionToolbarModel = {
  activeSubagentCount: number;
  contextText: string;
  editValue: string;
  editing: boolean;
  filesEdited: string[];
  finishEditing: () => void;
  handleCopyId: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isEnded: boolean;
  isRunning: boolean;
  prNumber?: number;
  prUrl?: string;
  session: SessionRecord;
  setEditValue: Dispatch<SetStateAction<string>>;
  setEditing: Dispatch<SetStateAction<boolean>>;
  startEditing: () => void;
  tokenText?: string;
};

type SessionToolbarBodyProps = SessionToolbarProps & {
  containerClassName: string;
  density: SessionToolbarDensity;
  model: SessionToolbarModel;
  rowClassName: string;
};

type ShellMetaItem = {
  key: string;
  node: ReactNode;
};

function useSessionToolbarModel({ sessionId }: SessionToolbarProps): SessionToolbarModel | null {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const renameSession = useSessionStore((s) => s.renameSession);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousSessionIdRef = useRef(sessionId);

  const startEditing = useCallback(() => {
    if (!session) return;
    setEditValue(session.title);
    setEditing(true);
  }, [session]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }

    previousSessionIdRef.current = sessionId;
    setEditing(false);
    setEditValue("");
  }, [sessionId]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === sessionId) {
        startEditing();
      }
    };
    window.addEventListener("rename-active-session", handler);
    return () => window.removeEventListener("rename-active-session", handler);
  }, [sessionId, startEditing]);

  const sessionStatus = session?.status;
  const sessionCreatedAt = session?.createdAt;
  useEffect(() => {
    if (!sessionStatus || sessionStatus !== "running" || !sessionCreatedAt) return;
    setElapsed(Date.now() - sessionCreatedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - sessionCreatedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStatus, sessionCreatedAt]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(sessionId);
    toast.success("Session ID copied");
  }, [sessionId]);

  if (!session) return null;

  const isRunning =
    session.status === "running" ||
    session.status === "needsAttention" ||
    session.status === "idle";
  const isEnded = ["closed", "archived"].includes(session.status);

  const activityText = getProvider(session.provider)?.getActivityText?.(session);
  let contextText = "";
  if (session.status === "running") {
    if (activityText) {
      contextText = activityText;
    } else {
      contextText = formatDuration(elapsed);
    }
  } else if (session.status === "idle") {
    contextText = activityText || "Idle";
  } else if (session.status === "needsAttention") {
    const waitingFor = (session.liveProviderData as Record<string, unknown>)?.waitingFor as
      | string
      | undefined;
    contextText = waitingFor ? `Waiting: ${waitingFor}` : "Needs attention";
  } else if (session.status === "closed" || session.status === "archived") {
    contextText = `Done in ${formatDuration(session.durationMs ?? 0)}`;
  }

  const filesEdited =
    ((session.liveProviderData as Record<string, unknown>)?.filesEdited as string[] | undefined) ??
    [];
  const activeSubagentCount =
    ((session.liveProviderData as Record<string, unknown>)?.activeSubagents as
      | number
      | undefined) ?? 0;
  const prUrl = session.providerData?.prUrl as string | undefined;
  const prNumber = session.providerData?.prNumber as number | undefined;
  const tokenText = getProvider(session.provider)?.formatTokenSummary?.(session) ?? undefined;

  function finishEditing() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      renameSession(sessionId, trimmed);
    }
    setEditing(false);
  }

  return {
    activeSubagentCount,
    contextText,
    editValue,
    editing,
    filesEdited,
    finishEditing,
    handleCopyId,
    inputRef,
    isEnded,
    isRunning,
    prNumber,
    prUrl,
    session,
    setEditValue,
    setEditing,
    startEditing,
    tokenText,
  };
}

function SessionToolbarBody({
  containerClassName,
  density,
  model,
  onArchive,
  onClose,
  onDelete,
  onStop,
  rowClassName,
}: SessionToolbarBodyProps) {
  const isShellDensity = density === "shell";
  const navigate = useNavigate();
  const shellMetaItems: ShellMetaItem[] = [];

  if (model.contextText) {
    shellMetaItems.push({
      key: "context",
      node: <span className="window-toolbar-meta max-w-[10rem]">{model.contextText}</span>,
    });
  }

  if (model.tokenText) {
    shellMetaItems.push({
      key: "tokens",
      node: <span className="window-toolbar-meta tabular-nums">{model.tokenText}</span>,
    });
  }

  if (model.prUrl && model.prNumber) {
    shellMetaItems.push({
      key: "pr",
      node: (
        <a
          href={model.prUrl}
          target="_blank"
          rel="noreferrer"
          className="window-toolbar-meta hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          #{model.prNumber}
        </a>
      ),
    });
  }

  const buildSessionMenuSpecs = useCallback((): NativeMenuItemSpec[] => {
    const specs: NativeMenuItemSpec[] = [
      {
        kind: "item",
        text: "Rename",
        accelerator: "F2",
        action: model.startEditing,
      },
    ];
    if (!model.isRunning && model.session.status !== "archived" && onArchive) {
      specs.push({ kind: "item", text: "Archive", action: onArchive });
    }
    specs.push(
      { kind: "separator" },
      { kind: "item", text: "Copy Session ID", action: model.handleCopyId },
    );
    if (onDelete) {
      specs.push({ kind: "separator" }, { kind: "item", text: "Delete", action: onDelete });
    }
    return specs;
  }, [model, onArchive, onDelete]);

  const handleRowContextMenu = createContextMenuHandler(() => buildSessionMenuSpecs());

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: native toolbar context menu
    <div className={containerClassName} onContextMenu={handleRowContextMenu}>
      <div className={cn("selection-chrome", rowClassName)}>
        <div
          className={cn("flex min-w-0 flex-1 items-center", isShellDensity ? "gap-2.5" : "gap-2")}
        >
          <StatusDot
            status={model.session.status}
            className={cn("size-2 shrink-0", model.isRunning && "animate-pulse-dot")}
          />

          <Breadcrumb
            parents={
              isShellDensity && model.session.repoName
                ? [
                    {
                      label: model.session.repoName,
                      onClick: () => navigate("/"),
                      ariaLabel: `Back to dashboard from ${model.session.repoName}`,
                    },
                  ]
                : []
            }
            current={
              model.editing ? (
                <Input
                  ref={model.inputRef}
                  value={model.editValue}
                  onChange={(e) => model.setEditValue(e.target.value)}
                  onBlur={model.finishEditing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") model.finishEditing();
                    if (e.key === "Escape") model.setEditing(false);
                  }}
                  className={cn(
                    "min-w-0 flex-1 px-2.5 font-medium",
                    isShellDensity ? "h-7 text-[13px] leading-none" : "h-7 text-sm",
                  )}
                />
              ) : (
                <button
                  type="button"
                  onClick={model.startEditing}
                  className={cn(
                    "truncate text-left",
                    isShellDensity
                      ? "window-toolbar-title-button -mx-1 rounded-md px-1 py-0 text-[13px] leading-none"
                      : "-mx-1.5 rounded-md px-1.5 py-0.5 text-sm",
                  )}
                  title="Click to rename"
                >
                  {model.session.title}
                </button>
              )
            }
          />

          {isShellDensity ? (
            shellMetaItems.length > 0 ? (
              <div className="hidden min-w-0 items-center gap-2 md:flex">
                {shellMetaItems.map((item, index) => (
                  <Fragment key={item.key}>
                    {index > 0 ? <span className="window-toolbar-meta-separator" /> : null}
                    {item.node}
                  </Fragment>
                ))}
              </div>
            ) : null
          ) : (
            <>
              {model.contextText && (
                <Badge
                  variant="outline"
                  className="max-w-[220px] shrink-0 truncate border-border/70 bg-background/65 px-2 text-[10px] font-normal text-muted-foreground"
                >
                  {model.contextText}
                </Badge>
              )}

              {model.filesEdited.length > 0 && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-border/70 bg-background/65 px-2 text-[10px] font-normal text-muted-foreground"
                  title={model.filesEdited.join(", ")}
                >
                  <FileEdit className="size-3" /> {model.filesEdited.length}
                </Badge>
              )}

              {model.activeSubagentCount > 0 && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-border/70 bg-background/65 px-2 text-[10px] font-normal text-muted-foreground"
                >
                  <Users className="size-3" /> {model.activeSubagentCount}
                </Badge>
              )}

              {model.prUrl && model.prNumber && (
                <a
                  href={model.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/65 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GitPullRequest className="size-3" /> #{model.prNumber}
                </a>
              )}

              {model.tokenText && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-border/70 bg-background/65 px-2 text-[10px] font-normal tabular-nums text-muted-foreground"
                >
                  {model.tokenText}
                </Badge>
              )}
            </>
          )}
        </div>

        <AppShellToolbarActionRail className={cn(isShellDensity ? "gap-1.5" : "gap-1")}>
          {model.isRunning && onStop && (
            <Button
              type="button"
              size={isShellDensity ? "toolbar" : "sm"}
              variant="destructive"
              className={cn(isShellDensity ? "shadow-none" : "h-7 gap-1.5 px-2.5 text-xs")}
              onClick={onStop}
              title="Stop agent"
            >
              <StopIcon className="size-3.5" />
              Stop
            </Button>
          )}
          {onClose && (
            <IconButton
              size={isShellDensity ? "toolbar-icon" : "icon-sm"}
              variant="outline"
              className={cn(isShellDensity ? "shadow-none" : "size-7")}
              onClick={onClose}
              label="Close session"
            >
              <X className="size-3.5" />
            </IconButton>
          )}

          <IconButton
            size={isShellDensity ? "toolbar-icon" : "icon-sm"}
            variant="outline"
            className={cn(isShellDensity ? "shadow-none" : "size-7")}
            label="More actions"
            onClick={(event) =>
              void showNativeMenuForElement(event.currentTarget, buildSessionMenuSpecs())
            }
          >
            <MoreHorizontal className="size-3.5" />
          </IconButton>
        </AppShellToolbarActionRail>
      </div>
    </div>
  );
}

export function SessionShellToolbar(props: SessionToolbarProps) {
  const model = useSessionToolbarModel(props);

  if (!model) return null;

  return (
    <SessionToolbarBody
      {...props}
      containerClassName="min-w-0 flex-1"
      density="shell"
      model={model}
      rowClassName="flex min-w-0 flex-1 items-center gap-2.5"
    />
  );
}
