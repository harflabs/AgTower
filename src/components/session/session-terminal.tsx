import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { FileDown } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import "@xterm/xterm/css/xterm.css";

import { openExternalUrl } from "@/lib/open-external";
import { shouldAutoFocusTerminal } from "@/lib/terminal-focus";
import {
  disposePoolEntry,
  getPoolEntry,
  type PooledTerminal,
  parkTerminal,
  setPoolEntry,
  unparkTerminal,
} from "@/lib/terminal-pool";
import {
  forceTerminalRender,
  scheduleTerminalRenderIntegrity as scheduleIntegrityRefresh,
} from "@/lib/xterm-render-integrity";
import { getProvider } from "@/providers/registry";
import { useSessionStore } from "@/stores/session-store";
import { clampTerminalFontSize, useSettingsStore } from "@/stores/settings-store";

import type { PtyOwnerLease, PtySessionState, SessionEvent } from "@/types/session";

export interface SessionTerminalHandle {
  terminal: Terminal | null;
  searchAddon: SearchAddon | null;
  focus: () => void;
}

export interface SessionTerminationInfo {
  code: number | null;
  signal: string | null;
  requestedByUser: boolean;
}

const THEME_DARK = {
  background: "#1f1f1f",
  foreground: "#e0e0e0",
  cursor: "#ffffff",
  cursorAccent: "#1f1f1f",
  selectionBackground: "#264f78",
  selectionInactiveBackground: "#3a3d41",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#a0a7b0",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const THEME_LIGHT = {
  background: "#ffffff",
  foreground: "#1e1e1e",
  cursor: "#1e1e1e",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff",
  selectionInactiveBackground: "#d6ebff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc7c",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function getTheme() {
  return document.documentElement.classList.contains("dark") ? THEME_DARK : THEME_LIGHT;
}

function shellEscape(path: string): string {
  if (/^[a-zA-Z0-9._/~:-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** Check if a Tauri physical position is within an element's bounds. */
function isOverElement(el: HTMLElement, pos: { x: number; y: number }): boolean {
  const rect = el.getBoundingClientRect();
  const s = window.devicePixelRatio;
  const x = pos.x / s;
  const y = pos.y / s;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

const B64_LOOKUP = new Uint8Array(128);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => {
  B64_LOOKUP[c.charCodeAt(0)] = i;
});

function decodeBase64(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === "=") len--;

  const outLen = (len * 3) >>> 2;
  const out = new Uint8Array(outLen);
  let j = 0;

  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)];
    const b = i + 1 < len ? B64_LOOKUP[b64.charCodeAt(i + 1)] : 0;
    const c = i + 2 < len ? B64_LOOKUP[b64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? B64_LOOKUP[b64.charCodeAt(i + 3)] : 0;

    out[j++] = (a << 2) | (b >> 4);
    if (j < outLen) out[j++] = ((b & 15) << 4) | (c >> 2);
    if (j < outLen) out[j++] = ((c & 3) << 6) | d;
  }

  return out;
}

function isStaleOwnerError(err: unknown): boolean {
  return String(err).includes("stale PTY owner");
}

// Use Menlo (always available on macOS) to avoid async font load issues.
const FONT = 'Menlo, "Geeza Pro", Monaco, "Courier New", monospace';
const WEBGL_RECOVERY_DELAY_MS = 100;
const BLOCKED_WEBGL_RENDERERS = [/swiftshader/i, /llvmpipe/i, /software/i];

type ManagedWebglAddon = WebglAddon & {
  clearTextureAtlas(): void;
};

let cachedWebglCompatibility: boolean | null = null;

function isWebglCompatibleForTerminal(): boolean {
  if (cachedWebglCompatibility !== null) {
    return cachedWebglCompatibility;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      cachedWebglCompatibility = false;
      return false;
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "")
      : "";
    const isBlocked = renderer
      ? BLOCKED_WEBGL_RENDERERS.some((pattern) => pattern.test(renderer))
      : false;

    gl.getExtension("WEBGL_lose_context")?.loseContext();

    cachedWebglCompatibility = !isBlocked;
    return cachedWebglCompatibility;
  } catch {
    cachedWebglCompatibility = true;
    return true;
  }
}

function refreshTerminal(term: Terminal, addon?: ManagedWebglAddon | null) {
  forceTerminalRender(term, {
    clearTextureAtlas: addon ? () => addon.clearTextureAtlas() : undefined,
  });
}

function batchIncludesViewportRewrite(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0x1b) continue;

    const next = data[i + 1];
    if (next === 0x63) {
      // ESC c — full terminal reset.
      return true;
    }

    if (next !== 0x5b) continue;

    let j = i + 2;
    let privateMode = false;
    if (data[j] === 0x3f) {
      privateMode = true;
      j++;
    }

    let value = 0;
    let hasDigits = false;
    while (j < data.length && data[j] >= 0x30 && data[j] <= 0x39) {
      hasDigits = true;
      value = value * 10 + (data[j] - 0x30);
      j++;
    }

    const final = data[j];
    if (final === undefined) continue;

    if (privateMode) {
      if (
        (value === 47 || value === 1047 || value === 1049) &&
        (final === 0x68 || final === 0x6c)
      ) {
        return true;
      }
      continue;
    }

    if (final === 0x4a && (!hasDigits || value === 2 || value === 3)) {
      // CSI J, CSI 2J, CSI 3J — viewport clear / scrollback clear.
      return true;
    }
  }

  return false;
}

function disposeWebgl(poolEntry: PooledTerminal, nextState: PooledTerminal["webglState"]) {
  if (poolEntry.webglRecoveryTimer !== null) {
    window.clearTimeout(poolEntry.webglRecoveryTimer);
    poolEntry.webglRecoveryTimer = null;
  }
  if (poolEntry.webglAddon) {
    try {
      poolEntry.webglAddon.dispose();
    } catch {
      // Addon may already be disposed by xterm on context loss.
    }
  }
  poolEntry.webglAddon = null;
  poolEntry.webglAttached = false;
  poolEntry.webglState = nextState;
}

/**
 * Attach the WebGL renderer to a pooled terminal with automatic recovery.
 *
 * On GPU context loss (too many contexts, memory pressure, macOS GPU
 * switching), the addon self-disposes and xterm falls back to Canvas2D.
 * We re-create a fresh WebGL addon after a short delay and force a full
 * redraw so the new canvas covers the fallback layer completely.
 */
function attachWebgl(term: Terminal, poolEntry: PooledTerminal): ManagedWebglAddon | null {
  if (poolEntry.webglFailed || poolEntry.webglState === "fallback") {
    return null;
  }

  if (!isWebglCompatibleForTerminal()) {
    poolEntry.webglAddon = null;
    poolEntry.webglAttached = false;
    poolEntry.webglFailed = true;
    poolEntry.webglState = "fallback";
    return null;
  }

  if (poolEntry.webglRecoveryTimer !== null) {
    window.clearTimeout(poolEntry.webglRecoveryTimer);
    poolEntry.webglRecoveryTimer = null;
  }
  poolEntry.webglState = "attaching";

  try {
    const webgl = new WebglAddon() as ManagedWebglAddon;
    let recoveredOnce = false;

    webgl.onContextLoss(() => {
      if (recoveredOnce) return;
      recoveredOnce = true;

      disposeWebgl(poolEntry, "recovering");
      poolEntry.webglRecoveryTimer = window.setTimeout(() => {
        poolEntry.webglRecoveryTimer = null;

        if (poolEntry.webglState !== "recovering") {
          return;
        }

        const recovered = attachWebgl(term, poolEntry);
        if (!recovered) {
          poolEntry.webglFailed = true;
          poolEntry.webglState = "fallback";
          refreshTerminal(term);
          return;
        }

        scheduleIntegrityRefresh(poolEntry);
      }, WEBGL_RECOVERY_DELAY_MS);

      refreshTerminal(term);
    });

    term.loadAddon(webgl);
    refreshTerminal(term, webgl);

    poolEntry.webglAddon = webgl;
    poolEntry.webglAttached = true;
    poolEntry.webglState = "attached";
    scheduleIntegrityRefresh(poolEntry);

    return webgl;
  } catch {
    poolEntry.webglAddon = null;
    poolEntry.webglAttached = false;
    poolEntry.webglFailed = true;
    poolEntry.webglState = "fallback";
    return null;
  }
}

const DEFAULT_SCROLLBACK = 5_000;
const EXIT_REQUEST_WINDOW_MS = 10_000;
const EXIT_COMMANDS = new Set(["exit", "/exit", "/quit", "/quite"]);
// biome-ignore lint/complexity/useRegexLiterals: string-built regex avoids ESC control-character lint
const ANSI_CSI_SEQUENCE = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g");
// biome-ignore lint/complexity/useRegexLiterals: string-built regex avoids ESC control-character lint
const ANSI_SS3_SEQUENCE = new RegExp(String.raw`\u001bO.`, "g");

function trackExitRequest(entry: PooledTerminal, data: string) {
  const sanitized = data.replace(ANSI_CSI_SEQUENCE, "").replace(ANSI_SS3_SEQUENCE, "");

  for (const char of sanitized) {
    switch (char) {
      case "\r": {
        const command = entry.pendingCommand.trim().toLowerCase();
        entry.exitRequestedAt = EXIT_COMMANDS.has(command) ? Date.now() : null;
        entry.pendingCommand = "";
        break;
      }
      case "\n":
        break;
      case "\b":
      case "\u007f":
        entry.exitRequestedAt = null;
        entry.pendingCommand = entry.pendingCommand.slice(0, -1);
        break;
      case "\u0015":
        entry.exitRequestedAt = null;
        entry.pendingCommand = "";
        break;
      default:
        if (char >= " " && char !== "\u007f") {
          entry.exitRequestedAt = null;
          entry.pendingCommand = `${entry.pendingCommand}${char}`.slice(-256);
        }
    }
  }
}

function wasExitRequestedByUser(entry: PooledTerminal | null): boolean {
  if (!entry?.exitRequestedAt) return false;
  return Date.now() - entry.exitRequestedAt <= EXIT_REQUEST_WINDOW_MS;
}

function resolveLaunchMode(sessionId: string) {
  const currentSession = useSessionStore.getState().sessions[sessionId];
  if (!currentSession) return "new" as const;
  if (["closed", "archived", "idle", "needsAttention"].includes(currentSession.status)) {
    return "resume" as const;
  }
  return "new" as const;
}

function buildLaunchSpec(sessionId: string) {
  const currentSession = useSessionStore.getState().sessions[sessionId];
  if (!currentSession) {
    return { kind: "loginShell" } as const;
  }

  return (
    getProvider(currentSession.provider)?.launcher.buildPtyLaunch(
      currentSession,
      resolveLaunchMode(sessionId),
    ) ?? { kind: "loginShell" as const }
  );
}

interface Props {
  sessionId: string;
  onFocus?: () => void;
  onTerminated?: (info: SessionTerminationInfo) => void;
  preferWebgl?: boolean;
  /** Scrollback buffer size. Lower values save memory in split/background views. */
  scrollback?: number;
}

export const SessionTerminal = forwardRef<SessionTerminalHandle, Props>(function SessionTerminal(
  {
    sessionId,
    onFocus: onTerminalFocus,
    onTerminated,
    preferWebgl = true,
    scrollback = DEFAULT_SCROLLBACK,
  },
  ref,
) {
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const onTerminatedRef = useRef<Props["onTerminated"]>(onTerminated);
  const ptyReadyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    get terminal() {
      return terminalRef.current;
    },
    get searchAddon() {
      return searchAddonRef.current;
    },
    focus() {
      terminalRef.current?.focus();
    },
  }));

  useEffect(() => {
    onTerminatedRef.current = onTerminated;
    const pooledEntry = getPoolEntry(sessionId);
    if (pooledEntry) {
      pooledEntry.onTerminated = onTerminated ?? null;
    }

    return () => {
      const currentEntry = getPoolEntry(sessionId);
      if (currentEntry?.onTerminated === (onTerminated ?? null)) {
        currentEntry.onTerminated = null;
      }
    };
  }, [sessionId, onTerminated]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const fitHost = host;

    let mountDisposed = false;
    let mountEntry: PooledTerminal | null = null;
    let focusTimer: number | null = null;
    let resizeRaf = 0;
    let focusRaf = 0;
    let resizeObserver: ResizeObserver | null = null;
    const ownerToken =
      globalThis.crypto?.randomUUID?.() ??
      `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let ownerLease: PtyOwnerLease | null = null;

    // Signal to the focus effect that the PTY is connected and ready to
    // receive focus CSI sequences.  Without this gate the focus effect can
    // fire `\x1b[I` while the shell is still initialising, and the PTY's
    // echoctl setting echoes "I" / "IOOI" as visible garbage.
    ptyReadyRef.current = false;

    function createEntry(): PooledTerminal {
      const container = document.createElement("div");
      container.style.cssText = "width:100%;height:100%;box-sizing:border-box";
      container.style.backgroundColor = getTheme().background;
      fitHost.appendChild(container);

      const term = new Terminal({
        fontFamily: FONT,
        // Clamp to guard against a corrupted persisted value (e.g. manual edit).
        fontSize: clampTerminalFontSize(useSettingsStore.getState().terminalFontSize),
        lineHeight: 1.0,
        scrollback,
        theme: getTheme(),
        cursorBlink: true,
        cursorStyle: "block",
        allowProposedApi: true,
        smoothScrollDuration: 0,
        minimumContrastRatio: 1,
        drawBoldTextInBrightColors: true,
        // OSC 8 hyperlinks (e.g. PR "#6" and URLs emitted by Claude Code / gh).
        // Without this, xterm falls back to `window.open`, which wry swallows
        // inside the Tauri webview, so clicks silently do nothing.
        linkHandler: {
          activate: (_event, uri) => openExternalUrl(uri),
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);

      // Detect and linkify plain-text URLs that aren't OSC 8 hyperlinks
      // (e.g. the "create a pull request" URL printed by `git push`).
      term.loadAddon(new WebLinksAddon((_event, uri) => openExternalUrl(uri)));

      term.open(container);
      fitAddon.fit();

      const entry: PooledTerminal = {
        terminal: term,
        fitAddon,
        searchAddon,
        container,
        initialized: false,
        onTerminated: onTerminatedRef.current ?? null,
        teardown: null,
        lastAccessedAt: Date.now(),
        webglAttached: false,
        webglAddon: null,
        webglFailed: false,
        webglState: "disabled",
        webglRecoveryTimer: null,
        renderIntegrityFrame: null,
        renderIntegrityTimer: null,
        pendingCommand: "",
        exitRequestedAt: null,
        parkedBroadcastUnlisten: null,
      };
      setPoolEntry(sessionId, entry);

      if (preferWebgl) {
        attachWebgl(term, entry);
      }

      let pendingInput: number[] = [];
      let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;

      function flushInput() {
        inputFlushTimer = null;
        if (pendingInput.length === 0) return;
        const data = pendingInput;
        pendingInput = [];
        invoke("write_terminal", { sessionId, data }).catch(() => {});
      }

      function queueInput(bytes: number[]) {
        pendingInput.push(...bytes);
        if (!inputFlushTimer) {
          inputFlushTimer = setTimeout(flushInput, 4);
        }
      }

      // NOTE: Shift+Enter handler is registered on every mount (not here)
      // because pooled terminals skip createEntry(). See the mount code
      // after `fitHost.appendChild(mountEntry.container)` below.

      const enc = new TextEncoder();
      const d1 = term.onData((data) => {
        trackExitRequest(entry, data);
        const arr = enc.encode(data);
        if (arr.length <= 6) {
          if (inputFlushTimer) {
            clearTimeout(inputFlushTimer);
            inputFlushTimer = null;
          }
          const combined = [...pendingInput, ...arr];
          pendingInput = [];
          invoke("write_terminal", { sessionId, data: combined }).catch(() => {});
          return;
        }
        queueInput(Array.from(arr));
      });

      const d2 = term.onBinary((data) => {
        queueInput(data.split("").map((c) => c.charCodeAt(0)));
      });

      const d3 = term.onResize(({ cols, rows }) => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          invoke("resize_terminal", { sessionId, cols, rows }).catch(() => {});
        }, 24);
      });

      const mo = new MutationObserver(() => {
        const theme = getTheme();
        term.options.theme = theme;
        container.style.backgroundColor = theme.background;
        scheduleIntegrityRefresh(entry);
      });
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      entry.teardown = () => {
        if (inputFlushTimer) clearTimeout(inputFlushTimer);
        if (resizeTimer) clearTimeout(resizeTimer);
        d1.dispose();
        d2.dispose();
        d3.dispose();
        mo.disconnect();
      };

      return entry;
    }

    let pooled = getPoolEntry(sessionId);
    if (pooled && !pooled.initialized) {
      disposePoolEntry(sessionId);
      pooled = undefined;
    }

    // Stop the off-screen broadcast listener (if parked) so the session
    // terminal's own channel becomes the sole writer — otherwise the
    // attach_pty_session replay snapshot would double-apply on top of
    // content the parked listener already flushed into the buffer.
    unparkTerminal(sessionId);

    mountEntry = pooled ?? createEntry();
    mountEntry.onTerminated = onTerminatedRef.current ?? null;
    mountEntry.lastAccessedAt = Date.now();
    fitHost.appendChild(mountEntry.container);

    // Re-register the Shift+Enter handler on every mount — pooled
    // terminals lose the handler when they're disposed/recreated, and
    // attachCustomKeyEventHandler replaces any previous callback.
    mountEntry.terminal.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      // Let the global keyboard handler own the session switcher (Ctrl+Tab /
      // Ctrl+Shift+Tab) even while the terminal is focused. Returning false
      // makes xterm ignore the key without consuming it, so the event bubbles
      // to the window keydown handler in use-keyboard-shortcuts.ts. Without
      // this, xterm swallows it and the switcher only works when a non-terminal
      // element (e.g. the sidebar) holds focus.
      if (ev.key === "Tab" && ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        return false;
      }
      if (ev.key === "Enter" && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        if (ev.type === "keydown") {
          const csiU = [0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75];
          invoke("write_terminal", { sessionId, data: csiU }).catch(() => {});
        }
        return false;
      }
      return true;
    });

    if (!preferWebgl) {
      if (
        mountEntry.webglAttached ||
        mountEntry.webglAddon ||
        mountEntry.webglState !== "disabled"
      ) {
        disposeWebgl(mountEntry, "disabled");
        scheduleIntegrityRefresh(mountEntry);
      }
    } else if (
      !mountEntry.webglAttached &&
      mountEntry.webglState !== "fallback" &&
      !mountEntry.webglFailed
    ) {
      attachWebgl(mountEntry.terminal, mountEntry);
    }

    mountEntry.fitAddon.fit();
    scheduleIntegrityRefresh(mountEntry);

    terminalRef.current = mountEntry.terminal;
    searchAddonRef.current = mountEntry.searchAddon;
    setError(null);

    function focusTerminalIfNeeded() {
      if (mountDisposed || !mountEntry) return;
      if (!shouldAutoFocusTerminal(document.activeElement)) return;
      mountEntry.terminal.focus();
    }

    focusRaf = requestAnimationFrame(() => {
      focusTerminalIfNeeded();
    });
    focusTimer = window.setTimeout(() => {
      focusTerminalIfNeeded();
    }, 96);

    let lastObservedWidth = 0;
    let lastObservedHeight = 0;

    resizeObserver = new ResizeObserver((entries) => {
      const nextRect = entries[0]?.contentRect;
      if (!nextRect) return;
      if (nextRect.width === lastObservedWidth && nextRect.height === lastObservedHeight) return;

      lastObservedWidth = nextRect.width;
      lastObservedHeight = nextRect.height;
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!mountDisposed && host.clientHeight > 0) {
          const colsBeforeFit = mountEntry?.terminal.cols ?? 0;
          const rowsBeforeFit = mountEntry?.terminal.rows ?? 0;

          mountEntry?.fitAddon.fit();
          if (mountEntry) {
            const geometryChanged =
              mountEntry.terminal.cols !== colsBeforeFit ||
              mountEntry.terminal.rows !== rowsBeforeFit;
            scheduleIntegrityRefresh(mountEntry, {
              clearTextureAtlas: geometryChanged,
              immediate: false,
            });
          }
        }
      });
    });
    resizeObserver.observe(fitHost);

    const WRITE_BATCH_SIZE = 32768;
    const HIGH_WATER_MARK = 128 * 1024;
    const LOW_WATER_MARK = 32 * 1024;

    // Throttle viewport-rewrite integrity refreshes to avoid hammering the
    // WebGL renderer for full-TUI apps (Codex) that redraw the screen on
    // every frame.  Without this, each write clears the glyph texture atlas
    // and synchronously repaints all rows — devastating for 30-60 fps TUIs.
    const VIEWPORT_REWRITE_REFRESH_INTERVAL_MS = 250;
    let lastViewportRewriteRefreshAt = 0;

    const writeQueue: Uint8Array[] = [];
    let isWriting = false;
    let writeQueueBytes = 0;
    let isPtyPaused = false;

    function resetWriteQueue() {
      writeQueue.length = 0;
      writeQueueBytes = 0;
      isWriting = false;
    }

    function maybeResumePty() {
      if (isPtyPaused && writeQueueBytes <= LOW_WATER_MARK) {
        isPtyPaused = false;
        invoke("resume_pty_reading", { sessionId }).catch(() => {});
      }
    }

    function drainWriteQueue() {
      if (mountDisposed) {
        resetWriteQueue();
        return;
      }

      if (writeQueue.length === 0) {
        isWriting = false;
        maybeResumePty();
        return;
      }

      isWriting = true;
      let total = 0;
      const batch: Uint8Array[] = [];
      while (writeQueue.length > 0 && total < WRITE_BATCH_SIZE) {
        const chunk = writeQueue.shift()!;
        batch.push(chunk);
        total += chunk.length;
      }
      writeQueueBytes -= total;
      maybeResumePty();

      const merged =
        batch.length === 1
          ? batch[0]
          : (() => {
              const combined = new Uint8Array(total);
              let offset = 0;
              for (const chunk of batch) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }
              return combined;
            })();

      const needsViewportRewriteRefresh = batchIncludesViewportRewrite(merged);
      mountEntry?.terminal.write(merged, () => {
        if (needsViewportRewriteRefresh && mountEntry) {
          // For full-TUI apps that redraw every frame, viewport rewrites
          // fire constantly.  Throttle the expensive atlas-clear + sync
          // refresh to at most once per VIEWPORT_REWRITE_REFRESH_INTERVAL_MS
          // so the write path stays fast.
          const now = performance.now();
          if (now - lastViewportRewriteRefreshAt >= VIEWPORT_REWRITE_REFRESH_INTERVAL_MS) {
            lastViewportRewriteRefreshAt = now;
            scheduleIntegrityRefresh(mountEntry, {
              clearTextureAtlas: mountEntry.webglAttached,
              immediate: false,
            });
          }
        }
        drainWriteQueue();
      });
    }

    function enqueueWrite(data: Uint8Array) {
      if (mountDisposed || data.length === 0) return;
      writeQueue.push(data);
      writeQueueBytes += data.length;
      if (!isPtyPaused && writeQueueBytes >= HIGH_WATER_MARK) {
        isPtyPaused = true;
        invoke("pause_pty_reading", { sessionId }).catch(() => {});
      }
      if (!isWriting) drainWriteQueue();
    }

    const ch = new Channel<SessionEvent>();
    ch.onmessage = (ev) => {
      if (mountDisposed) return;

      switch (ev.event) {
        case "PtyOutput": {
          enqueueWrite(decodeBase64(ev.data.data));
          break;
        }
        case "Terminated": {
          const code = ev.data.code;
          const signal = ev.data.signal;
          const currentSess = useSessionStore.getState().sessions[sessionId];
          const endedAt = currentSess?.endedAt ?? Date.now();
          const createdAt = currentSess?.createdAt ?? endedAt;
          const requestedByUser = wasExitRequestedByUser(mountEntry);

          useSessionStore.getState().updateSession(sessionId, {
            status: currentSess?.status === "archived" ? "archived" : "closed",
            exitCode: code,
            endedAt,
            durationMs: currentSess?.durationMs ?? Math.max(endedAt - createdAt, 0),
            ptyActive: false,
          });

          const poolEntry = getPoolEntry(sessionId);
          if (poolEntry) {
            poolEntry.pendingCommand = "";
            poolEntry.exitRequestedAt = null;
          }
          poolEntry?.onTerminated?.({
            code,
            signal,
            requestedByUser,
          });
          break;
        }
      }
    };

    async function connectPty() {
      const session = useSessionStore.getState().sessions[sessionId];
      if (!session || !mountEntry) return;

      const startedAt = performance.now();
      ownerLease = await invoke<PtyOwnerLease>("claim_pty_owner", {
        sessionId,
        ownerToken,
      });
      if (mountDisposed) {
        await invoke("park_pty_session", {
          sessionId,
          ownerToken,
          ownerGeneration: ownerLease.generation,
        }).catch(() => {});
        return;
      }

      const ptyState = await invoke<PtySessionState | null>("get_pty_state", { sessionId }).catch(
        () => null,
      );
      if (mountDisposed || !mountEntry) return;

      if (ptyState?.processState === "running") {
        const replaySnapshot = ptyState.attachmentState !== "attached";
        resetWriteQueue();
        if (replaySnapshot) {
          mountEntry.terminal.reset();
        }

        await invoke("attach_pty_session", {
          sessionId,
          cols: mountEntry.terminal.cols,
          rows: mountEntry.terminal.rows,
          onEvent: ch,
          ownerToken,
          ownerGeneration: ownerLease.generation,
          replaySnapshot,
        });
      } else {
        const currentSession = useSessionStore.getState().sessions[sessionId] ?? session;
        const launchInTmux = useSettingsStore.getState().launchInTmux;

        // Pre-flight: if we're resuming, make sure the provider still has the
        // backing conversation file. A deleted JSONL/rollout would crash the
        // CLI with "No conversation found to continue". Better to drop the
        // orphan row silently and send the user back to the dashboard.
        if (resolveLaunchMode(sessionId) === "resume") {
          let resumable = true;
          try {
            resumable = await invoke<boolean>("check_session_resumable", { id: sessionId });
          } catch {
            // Treat check failures as "assume resumable" so a transient Rust
            // error never deletes a user's session.
          }
          if (mountDisposed) return;
          if (!resumable) {
            toast.error(
              `The conversation for "${currentSession.title}" is no longer on disk. Removed from the sidebar.`,
            );
            useSessionStore.getState().removeSession(sessionId);
            onTerminatedRef.current?.({ code: null, signal: null, requestedByUser: true });
            return;
          }
        }

        try {
          await invoke("create_pty_session", {
            sessionId,
            repoPath: currentSession.repoPath,
            launch: buildLaunchSpec(sessionId),
            ownerToken,
            ownerGeneration: ownerLease.generation,
            cols: mountEntry.terminal.cols,
            rows: mountEntry.terminal.rows,
            onEvent: ch,
            launchInTmux,
          });
        } catch (error) {
          useSessionStore.getState().updateSession(sessionId, {
            status: "needsAttention",
            error: String(error),
            endedAt: null,
            pid: null,
            ptyActive: false,
            exitCode: null,
          });
          throw error;
        }

        // If the session was launched with an initial prompt, the agent is
        // already working (`claude -p <prompt>` / positional Codex prompt
        // start responding before any user Enter fires). Mark Running so the
        // sidebar reflects that. Otherwise the agent is sitting at its own
        // prompt waiting for input — that's Idle. Hooks in the provider
        // launchers (UserPromptSubmit / notify) push further transitions
        // through the control socket.
        const launchedWithPrompt = Boolean(currentSession.prompt?.trim());
        useSessionStore.getState().updateSession(sessionId, {
          status: launchedWithPrompt ? "running" : "idle",
          error: null,
          endedAt: null,
          exitCode: null,
          ptyActive: true,
        });
      }

      if (mountDisposed || !mountEntry) return;

      mountEntry.initialized = true;
      mountEntry.lastAccessedAt = Date.now();
      mountEntry.fitAddon.fit();
      scheduleIntegrityRefresh(mountEntry);
      ptyReadyRef.current = true;
      useSessionStore.getState().updateSession(sessionId, {
        ptyActive: true,
        liveProviderData: {
          ...useSessionStore.getState().sessions[sessionId]?.liveProviderData,
          terminalAttachLatencyMs: Math.round(performance.now() - startedAt),
        },
      });
    }

    connectPty().catch((err) => {
      if (isStaleOwnerError(err)) {
        return;
      }
      console.error("[terminal]", err);
      if (!mountDisposed) {
        setError(String(err));
      }
    });

    return () => {
      mountDisposed = true;
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
      }
      cancelAnimationFrame(focusRaf);
      cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      resetWriteQueue();
      if (mountEntry) {
        parkTerminal(sessionId);
        if (ownerLease) {
          invoke("park_pty_session", {
            sessionId,
            ownerToken,
            ownerGeneration: ownerLease.generation,
          }).catch(() => {});
        }
        mountEntry.onTerminated = null;
      }
      terminalRef.current = null;
      searchAddonRef.current = null;
    };
  }, [preferWebgl, sessionId, scrollback]);

  // Focus signalling. Serves two purposes:
  //   1. Codex: the TUI gates its BEL / OSC-9 notifications on whether it
  //      thinks the terminal is focused. Writing focus-in/out CSI sequences
  //      lets the backend synthesise those transitions.
  //   2. All providers: the backend's `set_session_focused` command
  //      auto-transitions NeedsAttention → Idle when the user opens a
  //      session, so the notification badge clears on view.
  //
  // NOTE: this effect must not touch the terminal's write pipeline — the
  // VIEWPORT_REWRITE_REFRESH_INTERVAL_MS throttle above keeps Codex's TUI
  // rendering performant and any extra sync work here would undo that.
  useEffect(() => {
    let disposed = false;
    let textarea: HTMLTextAreaElement | null = null;

    const pushFocus = (focused: boolean) => {
      invoke("set_session_focused", { sessionId, focused }).catch(() => {});
      if (focused) {
        onTerminalFocus?.();
      }
    };

    const handleTextAreaFocus = () => {
      if (!disposed && ptyReadyRef.current) pushFocus(true);
    };
    const handleTextAreaBlur = () => {
      if (!disposed && ptyReadyRef.current) pushFocus(false);
    };

    // Announce initial focus state once the PTY is ready. The main mount
    // effect's `connectPty()` is async, so we poll briefly rather than
    // firing `\x1b[I` into a shell that's still initialising (which causes
    // echoctl to echo "I" / "IOOI" as visible garbage).
    const entry = getPoolEntry(sessionId);
    textarea = entry?.terminal.textarea ?? null;

    let pollTimer = 0;
    let pollTimeout = 0;

    const announceInitialFocus = () => {
      if (disposed) return;
      const initiallyFocused =
        typeof document !== "undefined" &&
        document.hasFocus() &&
        (textarea ? document.activeElement === textarea : true);
      pushFocus(initiallyFocused);
    };

    if (ptyReadyRef.current) {
      announceInitialFocus();
    } else {
      // Poll until the PTY is connected (typically <500ms). The interval
      // is cheap — it just checks a boolean ref.
      pollTimer = window.setInterval(() => {
        if (disposed || ptyReadyRef.current) {
          window.clearInterval(pollTimer);
          window.clearTimeout(pollTimeout);
          if (!disposed) announceInitialFocus();
        }
      }, 50);
      // Safety net: stop polling after 5s to avoid leaks if connectPty fails.
      pollTimeout = window.setTimeout(() => window.clearInterval(pollTimer), 5000);
    }

    if (textarea) {
      textarea.addEventListener("focus", handleTextAreaFocus);
      textarea.addEventListener("blur", handleTextAreaBlur);
    }

    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(pollTimeout);
      if (textarea) {
        textarea.removeEventListener("focus", handleTextAreaFocus);
        textarea.removeEventListener("blur", handleTextAreaBlur);
      }
      // Tell the backend the session is no longer being observed. Fire and
      // forget — the backend tolerates stale session ids.
      invoke("set_session_focused", { sessionId, focused: false }).catch(() => {});
    };
  }, [onTerminalFocus, sessionId]);

  const [isDragOver, setIsDragOver] = useState(false);
  const isDragOverRef = useRef(false);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => e.preventDefault();
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);

    const unlistenDragDrop = getCurrentWebviewWindow().onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === "over") {
        const over = isOverElement(el, payload.position);
        if (over !== isDragOverRef.current) {
          isDragOverRef.current = over;
          setIsDragOver(over);
        }
      }

      if (payload.type === "drop") {
        isDragOverRef.current = false;
        setIsDragOver(false);
        if (isOverElement(el, payload.position) && payload.paths.length > 0) {
          const term = terminalRef.current;
          if (term) {
            const escaped = payload.paths.map(shellEscape).join(" ");
            const enc = new TextEncoder();
            invoke("write_terminal", {
              sessionId,
              data: Array.from(enc.encode(escaped)),
            }).catch(() => {});
          }
        }
      }

      if (payload.type === "leave") {
        isDragOverRef.current = false;
        setIsDragOver(false);
      }
    });

    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      unlistenDragDrop.then((fn) => fn()).catch(() => {});
    };
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div ref={shellRef} className="terminal-container relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/8 ring-1 ring-inset ring-primary/30">
          <div className="flex items-center gap-2 rounded-[4px] border border-border/65 bg-popover/92 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
            <FileDown className="size-4 text-muted-foreground" />
            <span>Drop to paste path</span>
          </div>
        </div>
      )}
    </div>
  );
});
