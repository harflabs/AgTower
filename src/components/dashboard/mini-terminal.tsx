import { Terminal } from "@xterm/xterm";
import { memo, useEffect, useRef } from "react";
// xterm.css is bundled via src/index.css (see the @import there) so it ships in
// a single, deterministically-ordered stylesheet. Importing it here let the
// `vendor-terminal` build chunk split it into a separate <link> whose order
// flipped vs dev and garbled these previews in production.

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
// `cursor`/`cursorAccent` deliberately equal `background`: the DOM renderer
// draws the cursor as a styled cell (there is no separate cursor layer to
// hide), so an invisible-by-color cursor — plus cursorInactiveStyle: "none" —
// is what keeps previews cursor-free. Keep them equal when retheming.
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

// Shared theme-change notifier: ONE MutationObserver on <html> for all mini
// terminals, instead of each card registering its own observer that then fires
// for every class change on the document.
const themeListeners = new Set<() => void>();
let sharedThemeObserver: MutationObserver | null = null;
function subscribeThemeChange(cb: () => void): () => void {
  themeListeners.add(cb);
  if (!sharedThemeObserver && typeof document !== "undefined") {
    sharedThemeObserver = new MutationObserver(() => {
      for (const l of themeListeners) l();
    });
    sharedThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  return () => {
    themeListeners.delete(cb);
    if (themeListeners.size === 0 && sharedThemeObserver) {
      sharedThemeObserver.disconnect();
      sharedThemeObserver = null;
    }
  };
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
 * Match the PTY's full geometry — both columns AND rows — and fit the font to
 * the card WIDTH only.
 *
 * TUIs (Claude Code, Codex) use absolute cursor positioning (`CSI N;1H`)
 * that targets specific PTY rows. xterm's `_restrictCursor` clamps the
 * cursor Y to `[0, rows - 1]`, so if the mini renders fewer rows than the
 * PTY, every cursor move targeting a row beyond the mini's viewport is
 * collapsed onto the last row — producing piled-up overlapping text.
 *
 * The preview is therefore a WINDOWED minimap: the rendered grid is
 * intentionally taller (and often wider) than the card, and HEIGHT is
 * intentionally NOT fit. Fitting the font to height would push it below
 * MIN_FONT_SIZE for the typical 24–50 row TUI (re-clamping to the floor with no
 * effect), or would require reducing `term.rows`, which breaks the
 * row-matching invariant above. The card's `overflow:hidden` clips the
 * overflow, and `applyContentAnchor` (see the component) toggles the rendered
 * `.xterm` element between top- and bottom-anchored so the relevant rows stay
 * visible: bottom-anchored for full-grid alt-screen TUIs, top-anchored for
 * short normal-buffer content that would otherwise be clipped off the top.
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
 * the overflow and `applyContentAnchor` toggles the `.xterm` element between
 * bottom-anchored (alt-screen TUIs: most recent rows visible) and top-anchored
 * (short normal-buffer content that would otherwise be clipped off the top).
 * Empty snapshots show a DOM overlay placeholder instead of grid text, so the
 * placeholder can never be clipped by the oversized grid.
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
    // The rendered `.xterm` element, cached once the terminal is open. Its
    // top/bottom CSS anchor is toggled by applyContentAnchor.
    let xtermEl: HTMLElement | null = null;
    // A DOM overlay (NOT terminal cells) for the empty-state placeholder. It
    // sits in the visible card region OUTSIDE the bottom-pinned xterm, so it is
    // never clipped the way grid-rendered placeholder text was.
    let overlay: HTMLDivElement | null = null;
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

    function ensureOverlay(): HTMLDivElement {
      if (overlay) return overlay;
      const node = document.createElement("div");
      node.dataset.miniOverlay = "";
      node.setAttribute("aria-hidden", "true");
      node.inert = true;
      // Centered in the whole visible card region — OUTSIDE the bottom-pinned
      // xterm so it can't be clipped by the windowed-minimap layout.
      node.style.cssText =
        "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
        "padding:8px;font:11px/1.4 ui-monospace, Menlo, monospace;" +
        "color:var(--muted-foreground);pointer-events:none;text-align:center;" +
        "white-space:pre-line;";
      el.appendChild(node);
      overlay = node;
      return node;
    }

    // Plain-text placeholder for the DOM overlay (no terminal escapes). Drives
    // off the snapshot's process state exactly as the old grid placeholder did.
    function placeholderText(snapshot: PreviewSourceSnapshot): string {
      return snapshot.processState === "running"
        ? "Waiting for output…"
        : "External CLI session\nClick to open terminal view";
    }

    function showPlaceholder(snapshot: PreviewSourceSnapshot) {
      const node = ensureOverlay();
      node.textContent = placeholderText(snapshot);
      node.style.display = "flex";
      showingPlaceholder = true;
    }

    function hidePlaceholder() {
      if (overlay) overlay.style.display = "none";
      showingPlaceholder = false;
    }

    /**
     * Choose top- vs bottom-anchoring for the rendered (oversized) grid so the
     * relevant rows stay in the card's clipped viewport.
     *
     * - Alt buffer (Claude/Codex TUIs paint the full grid): pin to the bottom,
     *   so the most recent rows are visible and the intentionally-blank top
     *   padding is what gets clipped.
     * - Normal buffer (plain shell / pre-launch / a few lines): content lands at
     *   the TOP. If it fits the visible window, anchor top so those rows aren't
     *   clipped off; otherwise fall back to the bottom pin.
     */
    function applyContentAnchor() {
      if (disposed || !term || !xtermEl) return;
      if (el.clientWidth < 10 || el.clientHeight < 10) return;

      const buffer = term.buffer?.active;
      if (buffer?.type === "alternate") {
        xtermEl.style.top = "";
        xtermEl.style.bottom = "0";
        return;
      }

      // Normal buffer: find the last row that holds content.
      let lastContentRow = 0;
      if (buffer) {
        const scanEnd = (buffer.baseY ?? 0) + term.rows;
        for (let i = 0; i < scanEnd; i++) {
          const line = buffer.getLine(i);
          if (line && line.translateToString(true).trim().length > 0) {
            lastContentRow = i;
          }
        }
      }

      const fontSize = (term.options.fontSize as number | undefined) ?? MIN_FONT_SIZE;
      const visibleRows = Math.max(1, Math.floor(el.clientHeight / (fontSize * CELL_HEIGHT_RATIO)));

      if (lastContentRow + 1 <= visibleRows) {
        // Content fits the visible window — anchor to the top so the few rows
        // sit at the visible top-left and aren't clipped off the top.
        xtermEl.style.bottom = "";
        xtermEl.style.top = "0";
      } else {
        xtermEl.style.top = "";
        xtermEl.style.bottom = "0";
      }
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
      // right. applyContentAnchor later toggles top/bottom for short
      // normal-buffer content.
      xtermEl = term.element ?? (container.querySelector(".xterm") as HTMLElement | null);
      if (xtermEl) {
        xtermEl.style.position = "absolute";
        xtermEl.style.bottom = "0";
        xtermEl.style.left = "0";
      }
      applyDimensions(dims);
      scheduleRenderIntegrity({ immediate: true });

      // A terminal created out-of-band (e.g. by the resize/fallback paths)
      // before its subscription's applySnapshot ran must paint immediately
      // from the cached snapshot — otherwise it would sit blank. Guard against
      // re-applying a snapshot we've already rendered via the revision.
      if (isVisible && currentSnapshot && term && currentSnapshot.revision !== currentRevision) {
        applySnapshot(currentSnapshot);
      }
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
      // The placeholder is a DOM overlay now, not grid cells — just hide it
      // before the first real bytes land (no term.reset() dance needed).
      if (showingPlaceholder) {
        hidePlaceholder();
      }
      term.write(merged, () => {
        scheduleRenderIntegrity();
        applyContentAnchor();
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
      // Row-matching invariant guard: the mini must render at the
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
        // Geometry drifted between syncGeometryFromDims above and here (e.g. a
        // resize raced in). Force the terminal to the snapshot's grid so the TUI's
        // absolute-cursor sequences land on the right rows instead of piling onto
        // the bottom — correct it rather than just warning.
        term.resize(Math.max(snapshot.cols, 1), Math.max(snapshot.rows, 1));
      }
      term.reset();

      if (snapshot.data.length === 0) {
        // Empty snapshot: show the DOM overlay placeholder instead of writing
        // placeholder escapes into the grid (where the bottom-pin would clip
        // them). Leave the grid empty.
        showPlaceholder(snapshot);
        scheduleRenderIntegrity({ immediate: true });
        applyContentAnchor();
        return;
      }

      hidePlaceholder();
      isWriting = true;
      term.write(snapshot.data, () => {
        scheduleRenderIntegrity({ immediate: true });
        applyContentAnchor();
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
      if (disposed || subscriptionDispose || subscribing) return;
      subscribing = true;
      try {
        // Subscription is decoupled from term existence: try to create the
        // terminal (idempotent — no-op if it exists or the card is <10px). If
        // the card is still too small the term stays null; return WITHOUT
        // claiming a subscription so a later resize re-enters cleanly and we
        // never leak a claimed-but-inert subscription.
        initTerminal();
        if (!term) return;

        let subscription: Awaited<ReturnType<typeof subscribeToPreviewSource>>;
        try {
          subscription = await subscribeToPreviewSource(sessionId, {
            onDelta: handleDelta,
            onReset: (snapshot) => {
              if (!disposed && isVisible && term) {
                applySnapshot(snapshot);
              }
            },
          });
        } catch (error) {
          // A failed bootstrap leaves no listener behind (the pool cleans up on
          // throw). Swallow rather than reject: `subscribing` resets in the
          // finally below, so the next ensureVisibleActive entry point (resize
          // RAF, fallback timer, visibility flip) retries cleanly.
          console.warn("[mini-terminal] preview subscribe failed", sessionId, error);
          return;
        }
        if (disposed || !isVisible || subscriptionDispose || !term) {
          subscription.unsubscribe();
          return;
        }
        subscriptionDispose = subscription.unsubscribe;
        applySnapshot(subscription.snapshot);
      } finally {
        subscribing = false;
      }
    }

    /**
     * The single idempotent become-active path, safe to call from every
     * entry point (visibility flip, resize, fallback timer). It inits the
     * terminal if needed, syncs theme/geometry, schedules render integrity,
     * and subscribes if not yet subscribed. Each step is cheap and self-guarded
     * when already done, so repeated calls can never leave a terminal without a
     * paired subscription (the structural dead-end that left previews blank).
     */
    function ensureVisibleActive(): Promise<void> {
      if (disposed || !isVisible) return Promise.resolve();
      initTerminal();
      syncTheme();
      syncGeometry();
      scheduleRenderIntegrity();
      return subscribeVisible();
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

      await ensureVisibleActive();
    }

    let resizeRaf: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (disposed) return;
        syncTheme();
        syncGeometry();
        if (isVisible) {
          // Idempotent: inits if needed, subscribes if not yet subscribed,
          // cheap when both already done. Calling it on every trailing resize
          // RAF guarantees the subscribe step is never starved by a burst of
          // resizes (the old `if (!term)` branch could be skipped forever once
          // the term existed without a subscription).
          void ensureVisibleActive();
          applyContentAnchor();
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

    // Watch for light/dark theme changes on <html> via the shared observer.
    const unsubscribeTheme = subscribeThemeChange(() => syncTheme());

    // Fallback for the case where the IntersectionObserver never fired a
    // become-visible callback but the card is on screen. Route through the same
    // idempotent path so this ALSO subscribes (the old fallback only inited the
    // terminal, leaving it subscription-less and permanently blank). Re-entrancy
    // is guarded inside subscribeVisible, not by a `!term` check.
    const fallback = setTimeout(() => {
      if (!disposed && isVisible) void ensureVisibleActive();
    }, 200);

    return () => {
      disposed = true;
      clearTimeout(fallback);
      cancelAnimationFrame(resizeRaf);
      cancelRenderIntegrity();
      clearVisibleSubscription();
      ro.disconnect();
      io.disconnect();
      unsubscribeTheme();
      term?.dispose();
      container?.remove();
      overlay?.remove();
      overlay = null;
      xtermEl = null;
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
