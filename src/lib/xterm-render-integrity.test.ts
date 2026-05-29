// @vitest-environment jsdom

import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forceTerminalRender, scheduleTerminalRenderIntegrity } from "@/lib/xterm-render-integrity";

interface MockRenderService {
  _isPaused?: boolean;
  _isNextRenderRedrawOnly?: boolean;
  _needsFullRefresh?: boolean;
  _pausedResizeTask: { flush: ReturnType<typeof vi.fn> };
  _renderer?: { value?: { renderRows: ReturnType<typeof vi.fn> } };
  _renderRows: ReturnType<typeof vi.fn>;
  refreshRows: ReturnType<typeof vi.fn>;
}

function createMockTerminal({ rows = 24, synchronizedOutput = false, visible = true } = {}) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: visible ? 160 : 0,
      height: visible ? 160 : 0,
      left: 0,
      right: visible ? 320 : 0,
      top: 0,
      width: visible ? 320 : 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  const renderService: MockRenderService = {
    _isPaused: true,
    _isNextRenderRedrawOnly: false,
    _needsFullRefresh: true,
    _pausedResizeTask: { flush: vi.fn() },
    _renderer: { value: { renderRows: vi.fn() } },
    _renderRows: vi.fn(),
    refreshRows: vi.fn(),
  };
  const refresh = vi.fn();
  const terminal = {
    element,
    modes: {
      synchronizedOutputMode: synchronizedOutput,
    },
    refresh,
    rows,
    _core: {
      _renderService: renderService,
    },
  } as unknown as Terminal;

  return { refresh, renderService, terminal };
}

describe("xterm render integrity", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("bypasses a stale xterm pause flag when the terminal is visibly laid out", () => {
    const { refresh, renderService, terminal } = createMockTerminal();
    const clearTextureAtlas = vi.fn();

    forceTerminalRender(terminal, { clearTextureAtlas });

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(renderService._pausedResizeTask.flush).toHaveBeenCalledTimes(1);
    expect(renderService._isPaused).toBe(false);
    expect(renderService._needsFullRefresh).toBe(false);
    expect(renderService._isNextRenderRedrawOnly).toBe(false);
    expect(renderService._renderer?.value?.renderRows).toHaveBeenCalledWith(0, 23);
    expect(renderService._renderRows).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("preserves xterm synchronized-output buffering", () => {
    const { refresh, renderService, terminal } = createMockTerminal({
      synchronizedOutput: true,
    });
    const clearTextureAtlas = vi.fn();

    forceTerminalRender(terminal, { clearTextureAtlas });

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(renderService._pausedResizeTask.flush).toHaveBeenCalledTimes(1);
    expect(renderService._isPaused).toBe(false);
    expect(renderService._needsFullRefresh).toBe(false);
    expect(renderService.refreshRows).toHaveBeenCalledWith(0, 23, true);
    expect(renderService._renderer?.value?.renderRows).not.toHaveBeenCalled();
    expect(renderService._renderRows).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not unpause or render terminals that are still hidden", () => {
    const { renderService, terminal } = createMockTerminal({ visible: false });

    forceTerminalRender(terminal);

    expect(renderService._isPaused).toBe(true);
    expect(renderService._needsFullRefresh).toBe(true);
    expect(renderService._renderer?.value?.renderRows).not.toHaveBeenCalled();
    expect(renderService._renderRows).not.toHaveBeenCalled();
  });

  it("schedules immediate, next-frame, and settled repaint passes", () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(0), 0);
      return 1;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const { renderService, terminal } = createMockTerminal();
    const entry = {
      terminal,
      renderIntegrityFrame: null,
      renderIntegrityTimer: null,
      webglAddon: { clearTextureAtlas: vi.fn() },
    };

    scheduleTerminalRenderIntegrity(entry);

    expect(renderService._renderer?.value?.renderRows).toHaveBeenCalledTimes(1);
    expect(entry.renderIntegrityFrame).toBe(1);
    expect(entry.renderIntegrityTimer).not.toBeNull();

    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(48);

    expect(renderService._renderer?.value?.renderRows).toHaveBeenCalledTimes(3);
    expect(entry.webglAddon.clearTextureAtlas).toHaveBeenCalledTimes(3);
  });
});
