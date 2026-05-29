import type { MouseEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { showNativeMenu } from "@/lib/native-menu";
import type { SessionTerminalHandle } from "./session-terminal";

interface Props {
  terminalRef: RefObject<SessionTerminalHandle | null>;
  children: ReactNode;
}

export function TerminalContextMenu({ terminalRef, children }: Props) {
  const handleCopy = useCallback(async () => {
    const term = terminalRef.current?.terminal;
    if (!term) return;
    const selection = term.getSelection();
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection);
    } catch (err) {
      console.error("[terminal] Failed to copy selection:", err);
      toast.error("Couldn't copy to clipboard");
    }
  }, [terminalRef]);

  const handlePaste = useCallback(async () => {
    const term = terminalRef.current?.terminal;
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        term.paste(text);
      }
    } catch (err) {
      console.error("[terminal] Failed to paste from clipboard:", err);
      toast.error("Couldn't paste from clipboard");
    }
  }, [terminalRef]);

  const handleSelectAll = useCallback(() => {
    terminalRef.current?.terminal?.selectAll();
  }, [terminalRef]);

  const handleClear = useCallback(() => {
    terminalRef.current?.terminal?.clear();
  }, [terminalRef]);

  useEffect(() => {
    const handleTerminalSelectAll = () => {
      handleSelectAll();
    };

    window.addEventListener("terminal-select-all", handleTerminalSelectAll);
    return () => window.removeEventListener("terminal-select-all", handleTerminalSelectAll);
  }, [handleSelectAll]);

  async function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    await showNativeMenu([
      {
        kind: "item",
        text: "Copy",
        enabled: !!terminalRef.current?.terminal?.getSelection(),
        action: () => {
          void handleCopy();
        },
      },
      {
        kind: "item",
        text: "Paste",
        action: () => {
          void handlePaste();
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        text: "Select All",
        action: handleSelectAll,
      },
      { kind: "separator" },
      {
        kind: "item",
        text: "Clear Terminal",
        action: handleClear,
      },
    ]);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the terminal surface needs a native context menu.
    <div className="h-full w-full" onContextMenu={handleContextMenu}>
      {children}
    </div>
  );
}
