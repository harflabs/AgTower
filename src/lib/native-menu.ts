import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  CheckMenuItem,
  IconMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent as ReactMouseEvent } from "react";

export type NativeMenuItemSpec =
  | {
      kind: "item";
      text: string;
      action: () => void;
      enabled?: boolean;
      accelerator?: string;
      /**
       * Optional URL of a PNG icon to render to the left of the menu text.
       * Must be PNG (NSMenu's IconMenuItem only decodes PNG/ICO with the
       * `image-png` Tauri feature). SVG won't work; keep provider menu art
       * monochrome and high-contrast so native menus stay aligned with
       * macOS menu conventions without washing out provider shapes.
       */
      iconUrl?: string;
    }
  | {
      kind: "check";
      text: string;
      checked: boolean;
      action: () => void;
      enabled?: boolean;
    }
  | { kind: "separator" };

type NativeMenuBuilder = () => NativeMenuItemSpec[] | Promise<NativeMenuItemSpec[]>;

/**
 * Cache of fetched PNG icon bytes keyed by URL. Menu open is on the hot
 * path of every chevron click — we only want to pay the network/disk cost
 * once per icon for the lifetime of the renderer.
 */
const iconBytesCache = new Map<string, Promise<ArrayBuffer | null>>();

async function loadIconBytes(url: string): Promise<ArrayBuffer | null> {
  let pending = iconBytesCache.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[native-menu] Icon fetch failed (${response.status}): ${url}`);
          return null;
        }
        return await response.arrayBuffer();
      } catch (err) {
        console.error(`[native-menu] Icon fetch errored: ${url}`, err);
        return null;
      }
    })();
    iconBytesCache.set(url, pending);
  }
  return pending;
}

async function buildMenuItem(spec: NativeMenuItemSpec) {
  switch (spec.kind) {
    case "separator":
      return PredefinedMenuItem.new({ item: "Separator" });
    case "check":
      return CheckMenuItem.new({
        text: spec.text,
        checked: spec.checked,
        enabled: spec.enabled ?? true,
        action: spec.action,
      });
    case "item": {
      if (spec.iconUrl) {
        const bytes = await loadIconBytes(spec.iconUrl);
        if (bytes) {
          return IconMenuItem.new({
            text: spec.text,
            enabled: spec.enabled ?? true,
            accelerator: spec.accelerator,
            action: spec.action,
            icon: new Uint8Array(bytes),
          });
        }
        // Fall through to a plain MenuItem on icon load failure — better
        // to show the menu without the icon than to drop the row entirely.
      }
      return MenuItem.new({
        text: spec.text,
        enabled: spec.enabled ?? true,
        accelerator: spec.accelerator,
        action: spec.action,
      });
    }
  }
}

export async function showNativeMenu(
  specs: NativeMenuItemSpec[],
  position?: { x: number; y: number },
): Promise<void> {
  try {
    const items = await Promise.all(specs.map(buildMenuItem));
    if (items.length === 0) return;
    const menu = await Menu.new({ items });
    if (position) {
      await menu.popup(new LogicalPosition(position.x, position.y), getCurrentWindow());
    } else {
      await menu.popup(undefined, getCurrentWindow());
    }
  } catch (err) {
    // Never crash a dropdown/context open — the user can still interact
    // with the rest of the UI. Errors here usually mean the Tauri runtime
    // isn't available (dev/test) or AppKit is in an unexpected state.
    console.error("[native-menu] Failed to show menu:", err);
  }
}

export function showNativeMenuForElement(
  element: HTMLElement,
  specs: NativeMenuItemSpec[],
): Promise<void> {
  const rect = element.getBoundingClientRect();
  return showNativeMenu(specs, { x: rect.left, y: rect.bottom + 2 });
}

/**
 * Returns an onContextMenu handler that builds and shows a native NSMenu.
 * The `build` function is invoked every time so items reflect current state.
 *
 * The returned handler is typed as `void`-returning (React event handler
 * contract). Any failure from the Tauri menu API is logged, not thrown —
 * right-clicking should never crash the UI.
 */
export function createContextMenuHandler(build: NativeMenuBuilder) {
  return (event: ReactMouseEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      try {
        const specs = await build();
        await showNativeMenu(specs);
      } catch (err) {
        console.error("[native-menu] Failed to open context menu:", err);
      }
    })();
  };
}
