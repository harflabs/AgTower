import { Terminal } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type ProviderIconId = "claude-code" | "codex";

const MONO_ICON_SRC: Record<ProviderIconId, string> = {
  "claude-code": "/providers/claude-code-icon.svg",
  codex: "/providers/codex-icon.svg",
};

const BRAND_ICON_SRC: Record<ProviderIconId, string> = {
  "claude-code": "/providers/claudecode.svg",
  codex: "/providers/codex.svg",
};

type ProviderMenuIconTone = "light" | "dark";

// Monochrome PNGs for native menu rows. Tauri's IconMenuItem accepts image
// bytes but does not expose AppKit's template-image flag, so we provide
// high-contrast light/dark assets instead of handing brand color to NSMenu.
const MENU_ICON_PNG: Record<ProviderMenuIconTone, Record<ProviderIconId, string>> = {
  light: {
    "claude-code": "/providers/claude-code-menu-light.png",
    codex: "/providers/codex-menu-light.png",
  },
  dark: {
    "claude-code": "/providers/claude-code-menu-dark.png",
    codex: "/providers/codex-menu-dark.png",
  },
};

/** Returns the PNG URL for a provider's monochrome native-menu icon. */
export function getProviderMenuPngUrl(
  provider: string | null | undefined,
  tone: ProviderMenuIconTone = getCurrentMenuIconTone(),
): string | null {
  const iconId = resolveProviderIconId(provider ?? "");
  return iconId ? MENU_ICON_PNG[tone][iconId] : null;
}

function getCurrentMenuIconTone(): ProviderMenuIconTone {
  if (typeof document !== "undefined") {
    const resolvedTheme = document.documentElement.dataset.resolvedTheme;
    if (resolvedTheme === "dark" || resolvedTheme === "light") return resolvedTheme;
    if (document.documentElement.classList.contains("dark")) return "dark";
    return "light";
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

const PROVIDER_ICON_ALIASES: Record<string, ProviderIconId> = {
  "claude-code": "claude-code",
  claudecode: "claude-code",
  codex: "codex",
};

function resolveProviderIconId(provider: string): ProviderIconId | null {
  return PROVIDER_ICON_ALIASES[provider] ?? null;
}

type ProviderIconVariant = "brand" | "mono";

interface ProviderIconProps {
  provider: string | undefined | null;
  /**
   * `mono` renders a CSS-masked shape that inherits `currentColor` — use in
   * UI chrome where the icon should match surrounding text. `brand` renders
   * the full-color logo via `<img>`; use when the provider's identity is
   * what the icon is communicating (sidebar rows, drag ghosts).
   */
  variant?: ProviderIconVariant;
  className?: string;
  /** Pixel size applied to width/height. Alternative to sizing via className. */
  size?: number;
  style?: CSSProperties;
}

export function ProviderIcon({
  provider,
  variant = "mono",
  className,
  size,
  style,
}: ProviderIconProps) {
  const iconId = resolveProviderIconId(provider ?? "");

  if (variant === "brand") {
    if (!iconId) {
      return (
        <Terminal
          aria-hidden="true"
          className={cn("shrink-0 text-muted-foreground/70", className)}
          style={{ width: size, height: size, ...style }}
        />
      );
    }
    return (
      <img
        src={BRAND_ICON_SRC[iconId]}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        draggable={false}
        className={cn("shrink-0 select-none", className)}
        style={style}
      />
    );
  }

  if (!iconId) return null;
  const iconStyle: CSSProperties = {
    WebkitMaskImage: `url("${MONO_ICON_SRC[iconId]}")`,
    maskImage: `url("${MONO_ICON_SRC[iconId]}")`,
    ...(size !== undefined ? { width: size, height: size } : {}),
    ...style,
  };
  return (
    <span aria-hidden="true" className={cn("provider-mask-icon", className)} style={iconStyle} />
  );
}
