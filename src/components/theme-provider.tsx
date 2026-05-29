import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";
import { useSettingsStore } from "@/stores/settings-store";

const WINDOW_BACKGROUND = {
  dark: "#262a30",
  light: "#f5f6f8",
} as const;

function resolveTheme(theme: "system" | "dark" | "light") {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return isDark ? "dark" : "light";
}

function applyTheme(theme: "system" | "dark" | "light") {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.resolvedTheme = resolvedTheme;
  return resolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const resolvedTheme = applyTheme(theme);

    if (HAS_TAURI_RUNTIME) {
      const currentWindow = getCurrentWindow();
      currentWindow.setTheme(resolvedTheme).catch(console.error);
      currentWindow.setBackgroundColor(WINDOW_BACKGROUND[resolvedTheme]).catch(console.error);
    }

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const nextTheme = applyTheme("system");
      if (HAS_TAURI_RUNTIME) {
        const currentWindow = getCurrentWindow();
        currentWindow.setTheme(nextTheme).catch(console.error);
        currentWindow.setBackgroundColor(WINDOW_BACKGROUND[nextTheme]).catch(console.error);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return <>{children}</>;
}
