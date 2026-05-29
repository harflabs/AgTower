import { createLucideIcon } from "lucide-react";

/**
 * Filled square stop icon — the universal media "stop" symbol.
 * Built with createLucideIcon so it inherits all Lucide props (size, color,
 * strokeWidth, className, absoluteStrokeWidth, etc.) and behaves identically
 * to any other icon from the lucide-react package.
 */
export const StopIcon = createLucideIcon("StopIcon", [
  [
    "rect",
    { x: "4", y: "4", width: "16", height: "16", rx: "3", fill: "currentColor", stroke: "none" },
  ],
]);
