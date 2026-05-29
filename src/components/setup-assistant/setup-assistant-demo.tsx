import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  DEMO_PALETTE_GROUP_ORDER,
  DEMO_SESSIONS,
  DEMO_TONE,
  type DemoCommand,
  type DemoKanbanStatus,
  type DemoSessionEntry,
  type DemoSessionId,
  type DemoView,
  getDemoSessionById,
  type SetupPaletteCommandId,
} from "./setup-assistant-model";

type DemoPaletteFocusZone = "input" | "list";

function isEditablePaletteKey(event: React.KeyboardEvent) {
  return !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1;
}

function DemoKanbanColumn({
  count,
  label,
  status,
  children,
}: {
  count: number;
  label: string;
  status: DemoKanbanStatus;
  children: ReactNode;
}) {
  const config: Record<DemoKanbanStatus, { colBg: string; dotClass: string }> = {
    running: {
      colBg: "bg-transparent",
      dotClass: "bg-info",
    },
    attention: {
      colBg: "bg-transparent",
      dotClass: "bg-warning",
    },
    idle: {
      colBg: "bg-transparent",
      dotClass: "bg-muted-foreground/50",
    },
  };

  return (
    <div
      className={cn(
        "native-inset-panel flex min-h-0 min-w-0 flex-1 flex-col text-sm",
        config[status].colBg,
      )}
    >
      <div className="flex min-h-9 items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", config[status].dotClass)} />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            {label}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">{children}</div>
    </div>
  );
}

function DemoKanbanCard({
  active = false,
  ageLabel,
  meta,
  onClick,
  provider,
  repo,
  status,
  title,
}: {
  active?: boolean;
  ageLabel: string;
  meta: string;
  onClick?: () => void;
  provider: "claude-code" | "codex";
  repo: string;
  status: DemoKanbanStatus;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      className={cn(
        "border-b border-border/45 bg-transparent py-0 text-left outline-none control-transition-native last:border-b-0 disabled:cursor-default",
        onClick && "hover:bg-background/60",
        onClick && "focus-ring-default",
        status === "running" && "border-info/12",
        status === "attention" && "border-warning/16",
        status === "idle" && "border-border/45",
        active && "bg-interactive-selected/80",
      )}
      onClick={onClick}
    >
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-1.5">
          {status === "running" ? (
            <span className="size-2 shrink-0 rounded-full bg-info animate-pulse-dot" />
          ) : status === "attention" ? (
            <span className="size-2 shrink-0 rounded-full bg-warning" />
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/55" />
          )}
          <span className="min-w-0 flex-1 truncate text-primary-info">{title}</span>
          <span className="text-secondary-info tabular-nums">{ageLabel}</span>
        </div>

        <div className="space-y-1 text-[12px] leading-5">
          <div className="flex items-center gap-1.5">
            <ProviderIcon
              provider={provider}
              aria-hidden={true}
              className="size-3.5 text-secondary-info"
            />
            <p className="truncate text-secondary-info">{repo}</p>
          </div>
          <p className="truncate text-tertiary-info">{meta}</p>
        </div>
      </div>
    </button>
  );
}

export function DemoPalette({
  commands,
  query,
  selectedIndex,
  inputRef,
  onDismiss,
  onSearchChange,
  onCommandHover,
  onCommandSelect,
}: {
  commands: DemoCommand[];
  query: string;
  selectedIndex: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDismiss: () => void;
  onSearchChange: (value: string) => void;
  onCommandHover: (index: number) => void;
  onCommandSelect: (id: SetupPaletteCommandId) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const [focusZone, setFocusZone] = useState<DemoPaletteFocusZone>("input");
  const groupedCommands = DEMO_PALETTE_GROUP_ORDER.map((group) => ({
    group,
    items: commands
      .map((command, index) => ({ command, index }))
      .filter((entry) => entry.command.group === group),
  })).filter((entry) => entry.items.length > 0);

  const focusElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }, []);

  const registerItemRef = useCallback(
    (index: number) => (node: HTMLDivElement | null) => {
      if (node) {
        itemRefs.current.set(index, node);
      } else {
        itemRefs.current.delete(index);
      }
    },
    [],
  );

  const scrollSelectedIntoView = useCallback((element: HTMLElement) => {
    const list = listRef.current;
    if (!list) return;

    const listRect = list.getBoundingClientRect();
    const selectedRect = element.getBoundingClientRect();
    const topInset = 16;
    const bottomInset = 16;

    if (selectedRect.top < listRect.top + topInset) {
      list.scrollTop -= listRect.top + topInset - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom - bottomInset) {
      list.scrollTop += selectedRect.bottom - (listRect.bottom - bottomInset);
    }
  }, []);

  const focusInput = useCallback(
    (caretPosition?: number) => {
      setFocusZone("input");
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;

        focusElement(input);
        const nextCaret = caretPosition ?? input.value.length;
        try {
          input.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // Ignore input types that do not support selection.
        }
      });
    },
    [focusElement, inputRef],
  );

  const selectItemByIndex = useCallback(
    (index: number) => {
      if (commands.length === 0) return;

      const clampedIndex = Math.max(0, Math.min(commands.length - 1, index));
      onCommandHover(clampedIndex);
      setFocusZone("list");
    },
    [commands.length, onCommandHover],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (commands.length === 0) return;

      const nextIndex =
        selectedIndex < 0
          ? delta >= 0
            ? 0
            : commands.length - 1
          : Math.max(0, Math.min(commands.length - 1, selectedIndex + delta));

      selectItemByIndex(nextIndex);
    },
    [commands.length, selectItemByIndex, selectedIndex],
  );

  const handleSearchInputChange = useCallback(
    (value: string) => {
      setFocusZone("input");
      onSearchChange(value);
    },
    [onSearchChange],
  );

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    return () => {
      if (!previousFocusRef.current) return;

      const element = previousFocusRef.current;
      previousFocusRef.current = null;
      requestAnimationFrame(() => focusElement(element));
    };
  }, [focusElement]);

  useEffect(() => {
    if (commands.length === 0) return;

    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;

      const firstVisibleIndex = 0;
      if (selectedIndex <= firstVisibleIndex) {
        list.scrollTop = 0;
      }

      if (focusZone !== "list" || selectedIndex < 0) return;

      const selectedItem = itemRefs.current.get(selectedIndex);
      if (!selectedItem) return;

      focusElement(selectedItem);
      if (selectedIndex !== firstVisibleIndex) {
        scrollSelectedIntoView(selectedItem);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [commands.length, focusElement, focusZone, scrollSelectedIntoView, selectedIndex]);

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      };

      const target = event.target as HTMLElement;
      const targetIsInput = target === inputRef.current;

      if (event.key === "Escape") {
        claim();
        onDismiss();
        return;
      }

      if (targetIsInput) {
        if (event.key === "ArrowDown") {
          claim();
          moveSelection(1);
          return;
        }

        if (event.key === "ArrowUp") {
          claim();
          moveSelection(-1);
          return;
        }

        if (event.key === "PageDown") {
          claim();
          moveSelection(5);
          return;
        }

        if (event.key === "PageUp") {
          claim();
          moveSelection(-5);
          return;
        }

        if (event.key === "Enter") {
          claim();
          const selectedCommand = commands[selectedIndex];
          if (selectedCommand) {
            onCommandSelect(selectedCommand.id);
          }
        }
        return;
      }

      if (isEditablePaletteKey(event)) {
        claim();
        const nextQuery = `${query}${event.key}`;
        handleSearchInputChange(nextQuery);
        focusInput(nextQuery.length);
        return;
      }

      if (event.key === "Backspace") {
        claim();
        const nextQuery = query.slice(0, -1);
        handleSearchInputChange(nextQuery);
        focusInput(nextQuery.length);
        return;
      }

      if (event.key === "ArrowDown") {
        claim();
        moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        claim();
        moveSelection(-1);
        return;
      }

      if (event.key === "Home") {
        claim();
        selectItemByIndex(0);
        return;
      }

      if (event.key === "End") {
        claim();
        selectItemByIndex(commands.length - 1);
        return;
      }

      if (event.key === "PageDown") {
        claim();
        moveSelection(5);
        return;
      }

      if (event.key === "PageUp") {
        claim();
        moveSelection(-5);
        return;
      }

      if (event.key === "Enter") {
        claim();
        const selectedCommand = commands[selectedIndex];
        if (selectedCommand) {
          onCommandSelect(selectedCommand.id);
        }
      }
    },
    [
      commands,
      focusInput,
      handleSearchInputChange,
      inputRef,
      moveSelection,
      onCommandSelect,
      onDismiss,
      query,
      selectItemByIndex,
      selectedIndex,
    ],
  );

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      commandProps={{ className: "selection-chrome" }}
      title="Onboarding Command Palette"
      description="Search demo commands for the setup assistant."
    >
      <div className="command-palette-frame" onKeyDownCapture={handleKeyDownCapture}>
        <div className="command-palette-header">
          <CommandInput
            ref={inputRef}
            value={query}
            placeholder="Type a command or search sessions"
            onValueChange={handleSearchInputChange}
            onFocus={() => setFocusZone("input")}
          />
        </div>

        <div className="command-palette-body">
          <div className="command-palette-panel">
            <CommandList ref={listRef} className="min-h-0 flex-1">
              {commands.length === 0 ? (
                <CommandEmpty className="flex h-full items-center justify-center px-4 py-10">
                  <div className="space-y-1 text-center">
                    <p className="text-sm font-medium text-foreground">No matching results</p>
                    <p className="text-xs text-muted-foreground">
                      Try next, previous, theme, or step actions.
                    </p>
                  </div>
                </CommandEmpty>
              ) : (
                groupedCommands.map((entry) => (
                  <CommandGroup key={entry.group} heading={entry.group}>
                    {entry.items.map(({ command, index }) => {
                      const Icon = command.icon;

                      return (
                        <CommandItem
                          key={command.id}
                          ref={registerItemRef(index)}
                          data-command-index={index}
                          selected={index === selectedIndex}
                          onMouseMove={() => onCommandHover(index)}
                          onFocus={() => {
                            onCommandHover(index);
                            setFocusZone("list");
                          }}
                          onSelect={() => onCommandSelect(command.id)}
                          className="items-start gap-3"
                        >
                          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-selected/command-item:text-interactive-selected-foreground">
                            <Icon className="size-4" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-foreground">
                                {command.title}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-secondary-info">{command.detail}</p>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))
              )}
            </CommandList>
          </div>
        </div>
      </div>
    </CommandDialog>
  );
}

function DemoDashboardView({
  activeSessionId,
  onOpenSession,
  sessionClosed,
}: {
  activeSessionId: DemoSessionId;
  onOpenSession: (sessionId: DemoSessionId) => void;
  sessionClosed: boolean;
}) {
  const runningSessions = DEMO_SESSIONS.filter((session) => session.status === "running");
  const attentionSessions = DEMO_SESSIONS.filter((session) => session.status === "attention");
  const idleSessions = DEMO_SESSIONS.filter((session) => session.status === "idle");

  return (
    <div className="native-panel flex min-h-[21rem] w-full flex-1 flex-col p-2">
      <div className="flex min-h-0 flex-1 gap-2.5 overflow-hidden">
        <DemoKanbanColumn count={runningSessions.length} label="Running" status="running">
          {runningSessions.map((session) => (
            <DemoKanbanCard
              key={session.id}
              active={!sessionClosed && activeSessionId === session.id}
              ageLabel={session.ageLabel}
              meta={session.cardMeta}
              onClick={() => onOpenSession(session.id)}
              provider={session.provider}
              repo={session.repo}
              status={session.status}
              title={session.title}
            />
          ))}
        </DemoKanbanColumn>

        <DemoKanbanColumn count={attentionSessions.length} label="Attention" status="attention">
          {attentionSessions.map((session) => (
            <DemoKanbanCard
              key={session.id}
              active={!sessionClosed && activeSessionId === session.id}
              ageLabel={session.ageLabel}
              meta={session.cardMeta}
              onClick={() => onOpenSession(session.id)}
              provider={session.provider}
              repo={session.repo}
              status={session.status}
              title={session.title}
            />
          ))}
        </DemoKanbanColumn>

        <DemoKanbanColumn count={idleSessions.length} label="Idle" status="idle">
          {idleSessions.map((session) => (
            <DemoKanbanCard
              key={session.id}
              active={!sessionClosed && activeSessionId === session.id}
              ageLabel={session.ageLabel}
              meta={session.cardMeta}
              onClick={() => onOpenSession(session.id)}
              provider={session.provider}
              repo={session.repo}
              status={session.status}
              title={session.title}
            />
          ))}
        </DemoKanbanColumn>
      </div>
    </div>
  );
}

function DemoSessionView({
  entries,
  inputRef,
  inputValue,
  onBack,
  onInputChange,
  onInputSubmit,
  sessionId,
}: {
  entries: DemoSessionEntry[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  onBack: () => void;
  onInputChange: (value: string) => void;
  onInputSubmit: () => void;
  sessionId: DemoSessionId;
}) {
  const tone = DEMO_TONE;
  const logRef = useRef<HTMLDivElement>(null);
  const lastEntryId = entries[entries.length - 1]?.id ?? "";
  const session = getDemoSessionById(sessionId);

  useEffect(() => {
    // Re-run when `lastEntryId` changes so newly appended entries scroll
    // the log to the bottom.
    void lastEntryId;
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [lastEntryId]);

  return (
    <div
      className={cn(
        "native-inset-panel flex min-h-[21rem] w-full flex-1 flex-col selection-chrome",
        tone.terminalSurface,
      )}
    >
      <div className={cn("flex items-center gap-3 border-b px-4 py-3", tone.toolbar)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-2 px-2", tone.muted)}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          Dashboard
        </Button>

        <p className={cn("min-w-0 truncate text-sm font-medium", tone.title)}>
          {session.title}
          <span className={cn("ml-2 text-xs font-normal", tone.muted)}>
            {session.repo} · {session.providerLabel}
          </span>
        </p>
      </div>

      <div
        ref={logRef}
        className={cn(
          "min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 py-4 font-mono text-[12px] leading-6 overscroll-contain",
          tone.terminalBg,
          tone.terminalText,
        )}
      >
        {session.lines.map((line) =>
          line.kind === "command" ? (
            <div key={line.text}>
              <span className={tone.terminalPrompt}>$</span> {line.text}
            </div>
          ) : line.kind === "muted" ? (
            <div key={line.text} className={tone.terminalMuted}>
              {line.text}
            </div>
          ) : (
            <div key={line.text}>{line.text}</div>
          ),
        )}

        {entries.map((entry) => (
          <div key={entry.id}>
            <span className={tone.terminalPrompt}>&gt;</span> {entry.text}
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onInputSubmit();
        }}
        className={cn("border-t px-4 py-3", tone.toolbar)}
      >
        <div className="flex items-center gap-2 font-mono text-[12px]">
          <span className={tone.terminalPrompt}>&gt;</span>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="Type and press Enter"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/70",
              tone.title,
            )}
          />
        </div>
      </form>
    </div>
  );
}

export function DemoBoard({
  activeSessionId,
  sessionEntries,
  sessionInputRef,
  sessionInputValue,
  onOpenSession,
  onOpenDashboard,
  onSessionInputChange,
  onSessionInputSubmit,
  paletteOpen,
  sessionClosed,
  view,
}: {
  activeSessionId: DemoSessionId;
  sessionEntries: DemoSessionEntry[];
  sessionInputRef: React.RefObject<HTMLInputElement | null>;
  sessionInputValue: string;
  onOpenSession: (sessionId: DemoSessionId) => void;
  onOpenDashboard: () => void;
  onSessionInputChange: (value: string) => void;
  onSessionInputSubmit: () => void;
  paletteOpen: boolean;
  sessionClosed: boolean;
  view: DemoView;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center transition-opacity",
        paletteOpen && "opacity-35",
      )}
    >
      {view === "dashboard" ? (
        <DemoDashboardView
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          sessionClosed={sessionClosed}
        />
      ) : (
        <DemoSessionView
          entries={sessionEntries}
          inputRef={sessionInputRef}
          inputValue={sessionInputValue}
          onBack={onOpenDashboard}
          onInputChange={onSessionInputChange}
          onInputSubmit={onSessionInputSubmit}
          sessionId={activeSessionId}
        />
      )}
    </div>
  );
}
