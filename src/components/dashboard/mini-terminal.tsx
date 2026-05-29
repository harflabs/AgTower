import { Terminal } from "@xterm/xterm";
import { memo, useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

import {
  type PreviewSourceDelta,
  type PreviewSourceSnapshot,
  subscribeToPreviewSource,
} from "@/lib/terminal-pool";
import {
  forceTerminalRender,
  TERMINAL_RENDER_INTEGRITY_SETTLE_DELAY_MS,
} from "@/lib/xterm-render-integrity";

// ── Themes — tuned for compact dashboard previews ─────────────────
const THEME_DARK = {
  background: "#1f1f1f",
  foreground: "#e0e0e0",
  cursor: "#1f1f1f",
  cursorAccent: "#1f1f1f",
  selectionBackground: "transparent",
  selectionInactiveBackground: "transparent",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#bac2cc",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const THEME_LIGHT = {
  background: "#f6f6f7",
  foreground: "#1e1e1e",
  cursor: "#f6f6f7",
  cursorAccent: "#f6f6f7",
  selectionBackground: "transparent",
  selectionInactiveBackground: "transparent",
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

function getMiniTheme() {
  return document.documentElement.classList.contains("dark") ? THEME_DARK : THEME_LIGHT;
}

// ── Constants ──────────────────────────────────────────────────────
const FONT = 'Menlo, "Geeza Pro", Monaco, "Courier New", monospace';
const SCROLLBACK = 200;
const VISIBILITY_THRESHOLD = 0.2;
const WRITE_BATCH_SIZE = 32768;

// Menlo character width / font-size ratio (monospace: consistent across sizes)
const CHAR_WIDTH_RATIO = 0.602;
// xterm cell height / font-size ratio (includes internal cell padding)
const CELL_HEIGHT_RATIO = 1.0;

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 14;

// Fallback dimensions used only when the backend can't report the real PTY
// size (e.g., session terminated) and the pool also has no entry.
const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

interface PreviewDimensions {
  cols: number;
  rows: number;
  fontSize: number;
}

/**
 * Match the PTY's full geometry — both columns AND rows.
 *
 * TUIs (Claude Code, Codex) use absolute cursor positioning (`CSI N;1H`)
 * that targets specific PTY rows. xterm's `_restrictCursor` clamps the
 * cursor Y to `[0, rows - 1]`, so if the mini renders fewer rows than the
 * PTY, every cursor move targeting a row beyond the mini's viewport is
 * collapsed onto the last row — producing piled-up overlapping text.
 *
 * We instead size the mini to the full PTY grid and let the card clip the
 * overflow. The `.xterm` element is pinned to the card's bottom-left
 * (see `initTerminal`) so the most recent rows stay visible.
 */
function fitPreview(cardW: number, cols: number, rows: number): PreviewDimensions {
  const ideal = cardW / (cols * CHAR_WIDTH_RATIO);
  const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, ideal));
  // 1-decimal precision — xterm renders to sub-pixel anyway.
  const fontSize = Math.floor(clamped * 10) / 10;
  return { cols, rows, fontSize };
}

// ── Component ──────────────────────────────────────────────────────

interface MiniTerminalProps {
  sessionId: string;
}

/**
 * Minimap-style terminal preview for dashboard session cards.
 *
 * Renders at the PTY's full geometry (cols and rows) so TUI cursor-position
 * sequences land on the right line — see `fitPreview` for why. The card clips
 * the overflow and the `.xterm` element is pinned bottom-left so the most
 * recent rows are visible.
 *
 * Refresh strategy: bootstrap once from the session-scoped preview source,
 * then append coalesced deltas. The mini only resets when the source emits
 * an explicit resnapshot event (resize, source handoff, bootstrap resync).
 */
export const MiniTerminal = memo(function MiniTerminal({ sessionId }: MiniTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    // Set initial background to match xterm theme (prevents flash/fringe)
    el.style.backgroundColor = getMiniTheme().background;

    let disposed = false;
    let term: Terminal | null = null;
    let container: HTMLDivElement | null = null;
    let isVisible = false;
    let subscriptionDispose: (() => void) | null = null;
    let currentSnapshot: PreviewSourceSnapshot | null = null;
    let currentRevision = 0;
    let writeQueue: PreviewSourceDelta[] = [];
    let isWriting = false;
    let showingPlaceholder = false;
    let renderIntegrityFrame: number | null = null;
    let renderIntegrityTimer: number | null = null;

    function resetWriteQueue() {
      writeQueue = [];
      isWriting = false;
    }

    function cancelRenderIntegrity() {
      if (renderIntegrityFrame !== null) {
        window.cancelAnimationFrame(renderIntegrityFrame);
        renderIntegrityFrame = null;
      }
      if (renderIntegrityTimer !== null) {
        window.clearTimeout(renderIntegrityTimer);
        renderIntegrityTimer = null;
      }
    }

    function forceRenderIntegrity() {
      if (!term || disposed) return;
      forceTerminalRender(term);
    }

    function scheduleRenderIntegrity(options: { immediate?: boolean } = {}) {
      if (!term || disposed) return;
      cancelRenderIntegrity();

      if (options.immediate) {
        forceRenderIntegrity();
      }

      renderIntegrityFrame = window.requestAnimationFrame(() => {
        renderIntegrityFrame = null;
        forceRenderIntegrity();
      });

      renderIntegrityTimer = window.setTimeout(() => {
        renderIntegrityTimer = null;
        forceRenderIntegrity();
      }, TERMINAL_RENDER_INTEGRITY_SETTLE_DELAY_MS);
    }

    function applyDimensions(dims: PreviewDimensions) {
      if (!term) return;
      const { cols, rows, fontSize } = dims;
      term.options.fontSize = fontSize;
      if (term.cols !== cols || term.rows !== rows) {
        term.resize(cols, rows);
      }
    }

    function syncGeometryFromDims(cols: number, rows: number) {
      if (!term) return;
      const cardW = el.clientWidth;
      const cardH = el.clientHeight;
      if (cardW < 10 || cardH < 10) return;
      applyDimensions(fitPreview(cardW, cols, rows));
    }

    function syncGeometry() {
      syncGeometryFromDims(
        currentSnapshot?.cols ?? FALLBACK_COLS,
        currentSnapshot?.rows ?? FALLBACK_ROWS,
      );
    }

    function syncTheme() {
      const theme = getMiniTheme();
      // Match the container bg to the xterm canvas so cell-boundary gaps are invisible
      el.style.backgroundColor = theme.background;
      if (!term) return;
      term.options.theme = theme;
    }

    // ── Initialize terminal ──
    function initTerminal() {
      if (disposed || term) return;
      const cardW = el.clientWidth;
      const cardH = el.clientHeight;
      if (cardW < 10 || cardH < 10) return;

      const initCols = currentSnapshot?.cols ?? FALLBACK_COLS;
      const initRows = currentSnapshot?.rows ?? FALLBACK_ROWS;
      const dims = fitPreview(cardW, initCols, initRows);

      container = document.createElement("div");
      container.style.cssText = "width:100%;height:100%;position:relative;overflow:hidden";
      container.setAttribute("aria-hidden", "true");
      container.inert = true;
      el.appendChild(container);

      term = new Terminal({
        fontFamily: FONT,
        fontSize: dims.fontSize,
        lineHeight: CELL_HEIGHT_RATIO,
        scrollback: SCROLLBACK,
        cols: dims.cols,
        rows: dims.rows,
        theme: getMiniTheme(),
        cursorBlink: false,
        cursorStyle: "bar",
        cursorWidth: 1,
        cursorInactiveStyle: "none",
        disableStdin: true,
        allowProposedApi: true,
        smoothScrollDuration: 0,
        minimumContrastRatio: 1,
        drawBoldTextInBrightColors: true,
        convertEol: false,
      });

      term.open(container);
      // The terminal renders at full PTY geometry — see fitPreview() — which
      // is usually taller and wider than the card. Pin the rendered .xterm
      // element to the card's bottom-left so the most recent rows are at the
      // visible bottom; the container's overflow:hidden clips the top and
      // right.
      const xtermEl = term.element ?? (container.querySelector(".xterm") as HTMLElement | null);
      if (xtermEl) {
        xtermEl.style.position = "absolute";
        xtermEl.style.bottom = "0";
        xtermEl.style.left = "0";
      }
      applyDimensions(dims);
      scheduleRenderIntegrity({ immediate: true });
    }

    function getPlaceholder(snapshot: PreviewSourceSnapshot): string {
      return snapshot.processState === "running"
        ? "\x1b[90m\r\n  Waiting for output...\x1b[0m"
        : "\x1b[90m\r\n  External CLI session\r\n\r\n  Click to open terminal view\x1b[0m";
    }

    function drainWriteQueue() {
      if (disposed || !term || isWriting) return;

      while (writeQueue.length > 0 && writeQueue[0]?.revision !== currentRevision) {
        writeQueue.shift();
      }

      if (writeQueue.length === 0) {
        return;
      }

      const batch: Uint8Array[] = [];
      let total = 0;
      while (
        writeQueue.length > 0 &&
        writeQueue[0]?.revision === currentRevision &&
        total < WRITE_BATCH_SIZE
      ) {
        const next = writeQueue.shift()!;
        batch.push(next.data);
        total += next.data.length;
      }
      if (batch.length === 0) return;

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

      isWriting = true;
      if (showingPlaceholder) {
        term.reset();
        showingPlaceholder = false;
      }
      term.write(merged, () => {
        scheduleRenderIntegrity();
        isWriting = false;
        if (!disposed) {
          drainWriteQueue();
        }
      });
    }

    function applySnapshot(snapshot: PreviewSourceSnapshot) {
      if (!term) return;
      currentSnapshot = snapshot;
      currentRevision = snapshot.revision;
      resetWriteQueue();
      syncGeometryFromDims(snapshot.cols, snapshot.rows);
      // Row-matching invariant guard (issue #10): the mini must render at the
      // same row count the snapshot bytes targeted, or TUI absolute cursor
      // moves clamp onto the bottom rows and pile up. syncGeometryFromDims
      // should have just made these equal; if they diverge the snapshot will
      // render garbled, so surface it loudly instead of failing silently. (A
      // sub-10px card legitimately skips the resize — don't warn then.)
      if (
        term.rows !== snapshot.rows &&
        el.clientWidth >= 10 &&
        el.clientHeight >= 10 &&
        snapshot.data.length > 0
      ) {
        console.warn(
          `[mini-terminal] row mismatch for ${sessionId}: term has ${term.rows} rows but snapshot targets ${snapshot.rows} — preview may render garbled`,
        );
      }
      term.reset();

      const payload = snapshot.data.length > 0 ? snapshot.data : getPlaceholder(snapshot);
      showingPlaceholder = snapshot.data.length === 0;
      isWriting = true;
      term.write(payload, () => {
        scheduleRenderIntegrity({ immediate: true });
        isWriting = false;
        if (!disposed) {
          drainWriteQueue();
        }
      });
    }

    function handleDelta(event: PreviewSourceDelta) {
      if (!term || !isVisible || event.data.length === 0 || event.revision !== currentRevision)
        return;
      writeQueue.push(event);
      drainWriteQueue();
    }

    // Synchronous in-flight guard: subscriptionDispose is only assigned after the
    // await below, so without this two overlapping callers (e.g. a visibility flip
    // plus a resize on the same frame) could both pass the guard and leak a
    // preview-source subscription into terminal-pool's shared listener set.
    let subscribing = false;
    async function subscribeVisible() {
      if (disposed || !term || subscriptionDispose || subscribing) return;
      subscribing = true;
      try {
        const subscription = await subscribeToPreviewSource(sessionId, {
          onDelta: handleDelta,
          onReset: (snapshot) => {
            if (!disposed && isVisible && term) {
              applySnapshot(snapshot);
            }
          },
        });
        if (disposed || !isVisible || subscriptionDispose) {
          subscription.unsubscribe();
          return;
        }
        subscriptionDispose = subscription.unsubscribe;
        applySnapshot(subscription.snapshot);
      } finally {
        subscribing = false;
      }
    }

    function clearVisibleSubscription() {
      subscriptionDispose?.();
      subscriptionDispose = null;
      resetWriteQueue();
    }

    async function handleVisibility(nextVisible: boolean) {
      if (disposed || nextVisible === isVisible) return;
      isVisible = nextVisible;

      if (!isVisible) {
        clearVisibleSubscription();
        cancelRenderIntegrity();
        return;
      }

      initTerminal();
      syncTheme();
      syncGeometry();
      scheduleRenderIntegrity();
      await subscribeVisible();
    }

    let resizeRaf: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (disposed) return;
        if (isVisible && !term) {
          initTerminal();
          syncTheme();
          void subscribeVisible();
        }
        syncTheme();
        syncGeometry();
        if (isVisible) {
          scheduleRenderIntegrity();
        }
      });
    });
    ro.observe(el);

    const io = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        void handleVisibility(
          (entry?.isIntersecting ?? false) && entry.intersectionRatio >= VISIBILITY_THRESHOLD,
        );
      },
      { threshold: [0, VISIBILITY_THRESHOLD] },
    );
    io.observe(el);

    // Watch for light/dark theme changes on <html>
    const themeObserver = new MutationObserver(() => syncTheme());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const fallback = setTimeout(() => {
      if (!disposed && isVisible && !term) {
        initTerminal();
        syncTheme();
        syncGeometry();
        scheduleRenderIntegrity();
      }
    }, 200);

    return () => {
      disposed = true;
      clearTimeout(fallback);
      cancelAnimationFrame(resizeRaf);
      cancelRenderIntegrity();
      clearVisibleSubscription();
      ro.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      term?.dispose();
      container?.remove();
    };
  }, [sessionId]);

  return (
    <div
      aria-hidden="true"
      inert
      ref={containerRef}
      className="mini-terminal h-full w-full overflow-hidden"
      style={{
        position: "relative",
      }}
    />
  );
});
