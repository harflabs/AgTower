export interface AttentionSignalsInput {
  /** Total sessions currently in needsAttention, regardless of focus/UI state. */
  rawCount: number;
  /** rawCount from the previous evaluation, for increase edge detection. */
  previousRawCount: number;
  /** Whether the actively-viewed session is itself in needsAttention. */
  activeIsAttention: boolean;
  /** Whether the app window currently has focus. */
  windowFocused: boolean;
}

export interface AttentionSignals {
  /** Dock badge / tray count. */
  badgeCount: number;
  /** Whether to request user attention (bounce the macOS dock icon). */
  requestAttention: boolean;
}

/**
 * Derive the dock/tray signals from the blocked-agent counts. The badge and
 * the dock bounce intentionally read DIFFERENT counts:
 *
 * - The badge hides the session the user is actively viewing while the window
 *   is focused — its toast is already suppressed (notifications.ts), so the
 *   badge should agree. When the window is backgrounded, it counts again so a
 *   blocked agent still shows on the dock.
 *
 * - The bounce fires only when the RAW count increases — a genuinely new
 *   blocked agent. On every increase, not just the 0→positive edge, so a
 *   newly-blocked second/third agent still alerts instead of only bumping the
 *   badge number silently. It must NOT derive from the badge count: the badge's
 *   focus adjustment re-inflates it (0→1) when the user merely switches to
 *   another app while still viewing a blocked session, and bouncing on that
 *   edge made the dock jump on every app switch with zero new information.
 *   (macOS ignores requestUserAttention while the app is frontmost, so raw
 *   increases that land while the user is already in the app stay silent.)
 */
export function deriveAttentionSignals(input: AttentionSignalsInput): AttentionSignals {
  const { rawCount, previousRawCount, activeIsAttention, windowFocused } = input;
  return {
    badgeCount: windowFocused && activeIsAttention ? Math.max(0, rawCount - 1) : rawCount,
    requestAttention: rawCount > previousRawCount,
  };
}
