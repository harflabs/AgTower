import type { Terminal } from "@xterm/xterm";

export const TERMINAL_RENDER_INTEGRITY_SETTLE_DELAY_MS = 48;

type InternalRenderer = {
  renderRows?: (start: number, end: number) => void;
};

type InternalRenderService = {
  _isPaused?: boolean;
  _isNextRenderRedrawOnly?: boolean;
  _needsFullRefresh?: boolean;
  _pausedResizeTask?: { flush?: () => void };
  _renderer?: { value?: InternalRenderer | null };
  _renderRows?: (start: number, end: number) => void;
  refreshRows?: (start: number, end: number, isRedrawOnly?: boolean) => void;
};

type InternalTerminal = Terminal & {
  _core?: {
    _renderService?: InternalRenderService;
    screenElement?: HTMLElement;
    // Set true by the parser on `CSI ?2026h` and cleared on `?2026l` (or the
    // 1s safety timeout). While true, RenderService buffers frames instead of
    // painting them, so a stranded `?2026h` keeps the grid blank.
    coreService?: { decPrivateModes?: { synchronizedOutput?: boolean } };
  };
};

interface TerminalRenderIntegrityEntry {
  terminal: Terminal;
  renderIntegrityFrame: number | null;
  renderIntegrityTimer: number | null;
  webglAddon?: { clearTextureAtlas?: () => void } | null;
}

interface ForceRenderOptions {
  clearTextureAtlas?: () => void;
}

interface ScheduleRenderOptions {
  clearTextureAtlas?: boolean;
  immediate?: boolean;
}

function getTerminalElement(term: Terminal): HTMLElement | null {
  return term.element ?? (term as InternalTerminal)._core?.screenElement ?? null;
}

function isTerminalLaidOut(term: Terminal): boolean {
  const element = getTerminalElement(term);
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function forceTerminalRender(term: Terminal, options: ForceRenderOptions = {}): void {
  const lastRow = Math.max(term.rows - 1, 0);
  const renderService = (term as InternalTerminal)._core?._renderService;

  if (!renderService) {
    term.refresh(0, lastRow);
    return;
  }

  const laidOut = isTerminalLaidOut(term);
  if (renderService._isPaused && !laidOut) {
    renderService._needsFullRefresh = true;
    return;
  }

  options.clearTextureAtlas?.();
  renderService._pausedResizeTask?.flush?.();
  renderService._isPaused = false;
  renderService._needsFullRefresh = false;

  // Paint the current buffer straight to the DOM renderer. xterm normally
  // reaches the renderer through RenderService, which can be gated by stale
  // IntersectionObserver pause state OR by synchronized-output buffering. This
  // integrity path only runs after our own visible layout/write signals, so a
  // direct renderRows is the safest way to guarantee the grid is on screen.
  //
  // Why this also handles synchronized output (DEC 2026): a partial frame can
  // strand the terminal mid-`?2026h` (e.g. a coalesced delta batch ends right
  // after the open and the closing `?2026l` lands in a later batch, or never if
  // the session goes quiet). While the mode is set, RenderService.refreshRows
  // only buffers — it never paints — and if `_isPaused` flips true before the 1s
  // safety timeout fires, the buffered frame is deferred to `_needsFullRefresh`
  // and only flushes on the next IntersectionObserver callback, which a
  // statically-visible card never gets. The result is a permanently blank mini
  // even though a non-empty snapshot was written. Painting the current grid
  // directly avoids that dead-end; the next real frame repaints it correctly.
  const renderer = renderService._renderer?.value;
  if (typeof renderer?.renderRows === "function") {
    renderer.renderRows(0, lastRow);
    return;
  }

  // Fallbacks for builds where the private renderer handle is unavailable.
  // refreshRows still buffers under synchronized output, so clear the mode
  // first when it's set — the next live delta's own `?2026h` re-enters sync,
  // and a redraw-only flush of the current grid never tears a static preview.
  const core = (term as InternalTerminal)._core;
  if (core?.coreService?.decPrivateModes?.synchronizedOutput === true) {
    core.coreService.decPrivateModes.synchronizedOutput = false;
  }

  if (typeof renderService._renderRows === "function") {
    renderService._isNextRenderRedrawOnly = true;
    renderService._renderRows(0, lastRow);
    return;
  }

  if (typeof renderService.refreshRows === "function") {
    renderService.refreshRows(0, lastRow, true);
    return;
  }

  term.refresh(0, lastRow);
}

function cancelTerminalRenderIntegrity(entry: TerminalRenderIntegrityEntry): void {
  if (entry.renderIntegrityFrame !== null) {
    window.cancelAnimationFrame(entry.renderIntegrityFrame);
    entry.renderIntegrityFrame = null;
  }
  if (entry.renderIntegrityTimer !== null) {
    window.clearTimeout(entry.renderIntegrityTimer);
    entry.renderIntegrityTimer = null;
  }
}

export function scheduleTerminalRenderIntegrity(
  entry: TerminalRenderIntegrityEntry,
  options: ScheduleRenderOptions = {},
): void {
  const clearTextureAtlas = options.clearTextureAtlas ?? true;
  const immediate = options.immediate ?? true;
  const force = () =>
    forceTerminalRender(entry.terminal, {
      clearTextureAtlas: clearTextureAtlas
        ? () => entry.webglAddon?.clearTextureAtlas?.()
        : undefined,
    });

  cancelTerminalRenderIntegrity(entry);

  if (immediate) {
    force();
  }

  entry.renderIntegrityFrame = window.requestAnimationFrame(() => {
    entry.renderIntegrityFrame = null;
    force();
  });

  entry.renderIntegrityTimer = window.setTimeout(() => {
    entry.renderIntegrityTimer = null;
    force();
  }, TERMINAL_RENDER_INTEGRITY_SETTLE_DELAY_MS);
}
