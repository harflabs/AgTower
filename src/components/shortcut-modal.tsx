import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getShortcutHelpSections } from "@/lib/keyboard/help";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useModalStore } from "@/stores/modal-store";

export function ShortcutModal() {
  const open = useModalStore((s) => s.shortcutModalOpen);
  const setOpen = useModalStore((s) => s.setShortcutModalOpen);

  if (!open) return null;

  return <MountedShortcutModal setOpen={setOpen} />;
}

function MountedShortcutModal({ setOpen }: { setOpen: (open: boolean) => void }) {
  const sections = getShortcutHelpSections();
  const [selectedSectionId, setSelectedSectionId] = useState(sections[0]?.id ?? "");
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedSection =
    sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const menuHelpShortcut = IS_MACOS ? "\u2318/" : "Ctrl+/";
  const selectedIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === selectedSection?.id),
  );

  const focusSection = useCallback((sectionId: string) => {
    requestAnimationFrame(() => tabRefs.current.get(sectionId)?.focus());
  }, []);

  const selectSectionAtIndex = useCallback(
    (index: number) => {
      if (sections.length === 0) return;
      const clamped = Math.max(0, Math.min(sections.length - 1, index));
      const next = sections[clamped];
      if (!next) return;
      setSelectedSectionId(next.id);
      focusSection(next.id);
    },
    [focusSection, sections],
  );

  const registerTabRef = useCallback(
    (sectionId: string) => (node: HTMLButtonElement | null) => {
      if (node) tabRefs.current.set(sectionId, node);
      else tabRefs.current.delete(sectionId);
    },
    [],
  );

  const handleSectionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          selectSectionAtIndex(selectedIndex + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          selectSectionAtIndex(selectedIndex - 1);
          return;
        case "Home":
          event.preventDefault();
          selectSectionAtIndex(0);
          return;
        case "End":
          event.preventDefault();
          selectSectionAtIndex(sections.length - 1);
          return;
      }
    },
    [sections.length, selectSectionAtIndex, selectedIndex],
  );

  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent
        unstyled
        className="grid h-[min(44rem,calc(100vh-4rem))] w-[min(56rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border/60 bg-popover text-popover-foreground [border-radius:var(--native-panel-radius)] [box-shadow:var(--native-popover-shadow)]"
      >
        <DialogHeader className="border-b border-border/60 px-5 py-3.5 pr-12">
          <DialogTitle className="text-[15px] leading-tight">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-[12px] leading-tight">
            Use {menuHelpShortcut} or ? to open this window.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[11rem_minmax(0,1fr)]">
          <div
            aria-label="Shortcut categories"
            className="flex min-h-0 flex-col gap-0.5 border-r border-border/55 bg-inset/38 p-2"
            role="tablist"
          >
            {sections.map((section) => {
              const selected = selectedSection?.id === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  id={`shortcut-tab-${section.id}`}
                  ref={registerTabRef(section.id)}
                  role="tab"
                  aria-controls={`shortcut-panel-${section.id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    "flex h-7 w-full items-center justify-between rounded-[4px] border border-transparent px-2 text-left text-[13px] font-medium control-transition-native focus-ring-default-inset",
                    selected
                      ? "bg-interactive-selected text-interactive-selected-foreground"
                      : "text-muted-foreground hover:bg-interactive-hover hover:text-foreground",
                  )}
                  onClick={() => setSelectedSectionId(section.id)}
                  onKeyDown={handleSectionKeyDown}
                >
                  <span className="truncate">{section.title}</span>
                  <span className="ml-2 text-[11px] tabular-nums opacity-60">
                    {section.entries.length}
                  </span>
                </button>
              );
            })}
          </div>

          <main className="min-h-0 overflow-y-auto p-3">
            {selectedSection && (
              <section
                id={`shortcut-panel-${selectedSection.id}`}
                role="tabpanel"
                aria-labelledby={`shortcut-tab-${selectedSection.id}`}
                className="native-panel"
              >
                <header className="flex min-h-9 items-center justify-between gap-3 border-b border-border/55 px-3">
                  <h2 className="truncate text-[13px] font-semibold text-foreground">
                    {selectedSection.title}
                  </h2>
                  <span className="window-toolbar-meta shrink-0">{selectedSection.context}</span>
                </header>

                <div className="divide-y divide-border/52">
                  {selectedSection.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {entry.label}
                        </p>
                        {entry.note ? (
                          <p className="mt-0.5 truncate text-tertiary-info">{entry.note}</p>
                        ) : null}
                      </div>

                      <ShortcutLabels entryId={entry.id} shortcuts={entry.shortcuts} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutLabels({ entryId, shortcuts }: { entryId: string; shortcuts: string[] }) {
  return (
    <div className="flex max-w-72 flex-wrap justify-end gap-x-2 gap-y-0.5 text-right">
      {shortcuts.map((shortcut) => (
        <span
          key={`${entryId}-${shortcut}`}
          className="min-h-5 text-[12px] leading-5 font-medium text-muted-foreground tabular-nums"
        >
          {shortcut}
        </span>
      ))}
    </div>
  );
}
