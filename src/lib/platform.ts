function detectMacOS() {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/.test(`${platform} ${agent}`);
}

export const IS_MACOS = detectMacOS();

export const HAS_TAURI_RUNTIME = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const USES_NATIVE_MACOS_MENU = IS_MACOS && HAS_TAURI_RUNTIME;
