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
  const synchronizedOutput = term.modes?.synchronizedOutputMode === true;

  options.clearTextureAtlas?.();
  renderService._pausedResizeTask?.flush?.();
  renderService._isPaused = false;
  renderService._needsFullRefresh = false;

  if (synchronizedOutput) {
    if (typeof renderService.refreshRows === "function") {
      renderService.refreshRows(0, lastRow, true);
      return;
    }

    if (typeof renderService._renderRows === "function") {
      renderService._isNextRenderRedrawOnly = true;
      renderService._renderRows(0, lastRow);
      return;
    }
  }

  const renderer = renderService._renderer?.value;
  if (typeof renderer?.renderRows === "function") {
    // xterm normally reaches the renderer through RenderService, which can be
    // gated by stale IntersectionObserver state. This integrity path is only
    // used after our own visible layout/write signals, so call the renderer
    // directly unless synchronized output needs xterm's buffering semantics.
    renderer.renderRows(0, lastRow);
    return;
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
