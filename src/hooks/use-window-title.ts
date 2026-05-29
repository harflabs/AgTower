import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";

export function useWindowTitle(title: string) {
  useEffect(() => {
    document.title = title;

    if (!HAS_TAURI_RUNTIME || IS_MACOS) {
      return;
    }

    getCurrentWebviewWindow().setTitle(title).catch(console.error);
  }, [title]);
}
