import { getVersion } from "@tauri-apps/api/app";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

export const APP_VERSION = __APP_VERSION__;

export async function readAppVersion(): Promise<string> {
  if (!HAS_TAURI_RUNTIME) return APP_VERSION;

  try {
    const version = await getVersion();
    return typeof version === "string" && version.length > 0 ? version : APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}
