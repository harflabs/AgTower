import { confirm } from "@tauri-apps/plugin-dialog";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

interface DestructiveConfirmOptions {
  cancelLabel?: string;
  message: string;
  okLabel: string;
  title: string;
}

export async function confirmDestructiveAction({
  cancelLabel = "Cancel",
  message,
  okLabel,
  title,
}: DestructiveConfirmOptions): Promise<boolean> {
  if (HAS_TAURI_RUNTIME) {
    try {
      return await confirm(message, {
        title,
        kind: "warning",
        okLabel,
        cancelLabel,
      });
    } catch (error) {
      console.error("[native-dialog] Failed to show native confirmation:", error);
    }
  }

  if (typeof window === "undefined") return false;
  return window.confirm(`${title}\n\n${message}`);
}
