import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";

const NON_DRAGGABLE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='combobox']",
  "[data-no-window-drag]",
].join(", ");

type ClosestCapableTarget = EventTarget & {
  closest: (selector: string) => Element | null;
};

function canResolveClosest(target: EventTarget | null): target is ClosestCapableTarget {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

export function blocksNativeWindowDrag(target: EventTarget | null): boolean {
  return canResolveClosest(target) && target.closest(NON_DRAGGABLE_SELECTOR) !== null;
}

export function useNativeWindowDrag(enabled = true) {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || !IS_MACOS || !HAS_TAURI_RUNTIME) return;
      if (event.button !== 0 || event.defaultPrevented) return;
      if (event.detail > 1) return;
      if (blocksNativeWindowDrag(event.target)) return;

      event.preventDefault();
      void getCurrentWindow()
        .startDragging()
        .catch((error) => {
          console.error("[window-drag] Failed to start native window drag:", error);
        });
    },
    [enabled],
  );
}

export function useNativeWindowTitlebarDoubleClick(enabled = true) {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || !IS_MACOS || !HAS_TAURI_RUNTIME) return;
      if (event.defaultPrevented) return;
      if (blocksNativeWindowDrag(event.target)) return;

      event.preventDefault();
      void invoke("perform_native_title_bar_double_click").catch((error) => {
        console.error("[window-drag] Failed to handle native title bar double click:", error);
      });
    },
    [enabled],
  );
}
