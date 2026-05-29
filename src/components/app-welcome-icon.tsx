import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { WELCOME_APP_ICON_INTRINSIC_SIZE_PX, WELCOME_APP_ICON_SRC } from "@/lib/welcome-icon";

export function AppWelcomeIcon({
  alt,
  ariaHidden = false,
  className,
  imageClassName,
  style,
}: {
  alt: string;
  ariaHidden?: boolean;
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
}) {
  const imageStyle: CSSProperties = {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
  };

  return (
    <div
      className={cn("setup-welcome-app-icon-shell", className)}
      style={{ width: "100%", height: "100%", ...style }}
    >
      <img
        src={WELCOME_APP_ICON_SRC}
        alt={ariaHidden ? "" : alt}
        aria-hidden={ariaHidden || undefined}
        width={WELCOME_APP_ICON_INTRINSIC_SIZE_PX}
        height={WELCOME_APP_ICON_INTRINSIC_SIZE_PX}
        loading="eager"
        fetchPriority="high"
        decoding="sync"
        draggable={false}
        className={cn("setup-welcome-app-icon-image", imageClassName)}
        style={imageStyle}
      />
    </div>
  );
}
