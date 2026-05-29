import { invoke } from "@tauri-apps/api/core";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";

/**
 * Maps 1:1 to NSHapticFeedbackPattern:
 * - `generic`     — all-purpose (e.g. archive-and-advance, menu open)
 * - `alignment`   — snap/align confirmation (e.g. drop onto target)
 * - `level-change` — stepwise boundary cross (e.g. pin ↔ unpin section)
 */
type HapticPattern = "generic" | "alignment" | "level-change";

// Rapid-fire calls (e.g. j/k navigation) would machine-gun the Force Touch
// trackpad, which is physically unpleasant. 80ms matches the NSHapticFeedback
// minimum debounce recommended by AppKit guides.
const MIN_INTERVAL_MS = 80;
let lastFiredAt = 0;

/**
 * Fire a subtle haptic bump. No-op on non-macOS and non-Tauri environments.
 * Respects the user's "Haptic Feedback" toggle in System Settings → Trackpad
 * (AppKit honors that automatically — we don't need to check it ourselves).
 */
export function performHaptic(pattern: HapticPattern): void {
  if (!IS_MACOS || !HAS_TAURI_RUNTIME) return;

  const now = performance.now();
  if (now - lastFiredAt < MIN_INTERVAL_MS) return;
  lastFiredAt = now;

  invoke("perform_haptic_feedback", { pattern }).catch(() => {
    // Silent — the Rust side logs failures via eprintln.
  });
}
