import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";
import { formatDuration } from "@/lib/session-helpers";
import type { Session } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { type NotificationSettings, useSettingsStore } from "@/stores/settings-store";

export async function requestNotificationPermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

/**
 * True when the user is actively looking at this session — i.e., it's the
 * focused session AND the AgTower window is in the foreground. Suppresses
 * notifications for sessions the user is already viewing.
 */
function isSessionCurrentlyVisible(sessionId: string): boolean {
  const activeSessionId = useSessionStore.getState().activeSessionId;
  if (activeSessionId !== sessionId) return false;
  if (typeof document === "undefined") return false;
  return document.hasFocus() && document.visibilityState === "visible";
}

/**
 * Per-session notification cooldown. A multi-turn agent fires `Stop` on every
 * turn boundary, so without throttling the user gets a ding per turn per agent.
 * Suppress repeat notifications for the same session within the window. Shared
 * across attention + completion so the two don't double-ding.
 */
const NOTIFY_COOLDOWN_MS = 8000;
const lastNotifiedAt = new Map<string, number>();
function withinNotifyCooldown(sessionId: string): boolean {
  const now = Date.now();
  const last = lastNotifiedAt.get(sessionId);
  if (last !== undefined && now - last < NOTIFY_COOLDOWN_MS) return true;
  lastNotifiedAt.set(sessionId, now);
  return false;
}

export function notifyNeedsAttention(session: Session) {
  // Only notify if session status is needsAttention
  if (session.status !== "needsAttention") return;

  // Don't pester the user about a session they're already looking at.
  if (isSessionCurrentlyVisible(session.id)) return;

  // Throttle per-turn spam across non-focused agents.
  if (withinNotifyCooldown(session.id)) return;

  if (useSettingsStore.getState().notifications.doNotDisturb) return;

  // Increment unseen counter for dashboard badge
  useSessionStore.getState().incrementUnseen();

  // Coalesce bursts: many agents going blocked within a short window collapse
  // into a single toast + sound instead of N separate dings.
  enqueueAttention(session);
}

const ATTENTION_COALESCE_MS = 600;
let attentionBatch: Session[] = [];
let attentionTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueAttention(session: Session) {
  attentionBatch.push(session);
  if (attentionTimer) return;
  attentionTimer = setTimeout(flushAttention, ATTENTION_COALESCE_MS);
}

function flushAttention() {
  attentionTimer = null;
  const batch = attentionBatch;
  attentionBatch = [];
  if (batch.length === 0) return;

  const settings = useSettingsStore.getState().notifications;
  if (settings.doNotDisturb) return;

  if (batch.length === 1) {
    deliverAttention(batch[0], settings);
    return;
  }

  // Coalesced burst: one notification + one sound for the whole group.
  const isError = batch.some((s) => s.stopReason === "error");
  const title = `${batch.length} agents need attention`;
  const names = batch
    .map((s) => s.title)
    .slice(0, 4)
    .join(", ");
  const body = batch.length > 4 ? `${names}, +${batch.length - 4} more` : names;

  if (settings.desktop) {
    isPermissionGranted().then((granted) => {
      if (granted) {
        try {
          sendNotification({ title, body });
        } catch (err) {
          console.error("[notifications] Failed to send notification:", err);
        }
      }
    });
  }
  if (settings.inApp) {
    (isError ? toast.error : toast.success)(title, { description: body, duration: 5000 });
  }
  if (settings.sound) {
    playNotificationSound(isError);
  }
}

function deliverAttention(session: Session, settings: NotificationSettings) {
  const isError = session.stopReason === "error";
  const title = isError ? "Agent needs attention" : "Agent waiting for input";

  // Rich body with stats
  const parts = [session.title];
  if (session.durationMs) parts.push(formatDuration(session.durationMs));
  if (session.numTurns) parts.push(`${session.numTurns} turns`);
  const body = `${session.repoName} — ${parts.join(" · ")}`;

  if (settings.desktop) {
    isPermissionGranted().then((granted) => {
      if (granted) {
        try {
          sendNotification({ title, body });
        } catch (err) {
          console.error("[notifications] Failed to send notification:", err);
        }
      }
    });
  }

  if (settings.inApp) {
    const toastFn = isError ? toast.error : toast.success;
    toastFn(title, {
      description: body,
      duration: 5000,
      action: {
        label: "View",
        onClick: () => {
          // Navigate to session — dispatch custom event picked up by router
          window.dispatchEvent(new CustomEvent("navigate-to-session", { detail: session.id }));
        },
      },
    });
  }

  if (settings.sound) {
    playNotificationSound(isError);
  }
}

/**
 * Show a brief toast when a session completes (vanishes from dashboard).
 */
export function notifySessionCompleted(session: Session) {
  // Match the attention path: don't ding for a session the user just watched
  // finish, and throttle per-session.
  if (isSessionCurrentlyVisible(session.id)) return;
  if (withinNotifyCooldown(session.id)) return;

  const settings = useSettingsStore.getState().notifications;
  if (settings.doNotDisturb) return;
  const title = session.title || "Session completed";
  const body = `${session.repoName} — Done`;

  if (settings.desktop) {
    isPermissionGranted().then((granted) => {
      if (granted) {
        try {
          sendNotification({ title, body });
        } catch (err) {
          console.error("[notifications] Failed to send notification:", err);
        }
      }
    });
  }

  if (settings.inApp) {
    toast.success(title, {
      description: body,
      duration: 3000,
      action: {
        label: "View",
        onClick: () => {
          window.dispatchEvent(new CustomEvent("navigate-to-session", { detail: session.id }));
        },
      },
    });
  }

  if (settings.sound) {
    playNotificationSound(false);
  }
}

/**
 * On macOS, play one of the 14 named system sounds via NSSound. Users recognize
 * these (Glass, Funk, Ping, …) from Mail and Messages; a synthesized tone is one
 * of the clearest "this is a web app" tells. System sounds also honor system-wide
 * effect muting and Do Not Disturb — synthesized tones bypass both.
 *
 * Non-macOS falls back to the Web Audio synth so Windows/Linux users still get
 * *something* — swapping those for platform-appropriate sounds is future work.
 */
function playNotificationSound(isError: boolean) {
  if (IS_MACOS && HAS_TAURI_RUNTIME) {
    // Glass is the standard "gentle chime" used by Mail/Messages; Funk is more
    // attention-getting — appropriate for a blocked/errored agent.
    const name = isError ? "Funk" : "Glass";
    invoke("play_system_sound", { name }).catch(() => {
      // Silent — the Rust side logs failures via eprintln.
    });
    return;
  }

  playWebAudioFallback(isError);
}

/** Lazily-created AudioContext — reused across all fallback sounds. */
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers suspend until user gesture)
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// Fallback notification sounds fire from background engine events, not user gestures, so
// a browser/webview would leave the AudioContext suspended and silently drop them. On
// non-macOS, unlock the context once on the first real user gesture so later sounds play.
// (macOS uses NSSound and never hits this path.)
if (!IS_MACOS && typeof window !== "undefined") {
  const unlockAudio = () => {
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
    try {
      getAudioContext();
    } catch {
      // AudioContext unavailable (e.g. test env) — ignore.
    }
  };
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);
}

function playWebAudioFallback(isError: boolean) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";

    if (isError) {
      // Two-tone descending for errors
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.setValueAtTime(380, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      // Two-tone ascending for success
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.setValueAtTime(900, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Audio not available
  }
}
