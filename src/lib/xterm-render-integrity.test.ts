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

function createMockTerminal({
  rows = 24,
  synchronizedOutput = false,
  visible = true,
  hasRenderer = true,
} = {}) {
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
    _renderer: hasRenderer ? { value: { renderRows: vi.fn() } } : { value: undefined },
    _renderRows: vi.fn(),
    refreshRows: vi.fn(),
  };
  const coreService = { decPrivateModes: { synchronizedOutput } };
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
      coreService,
    },
  } as unknown as Terminal;

  return { coreService, refresh, renderService, terminal };
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

  it("paints the current grid directly even under synchronized output", () => {
    // A stranded `?2026h` (frame opened, `?2026l` not yet delivered) leaves
    // RenderService buffering. The old integrity path called refreshRows, which
    // only buffers and never paints — so a visible mini could sit permanently
    // blank if the stream went quiet before the close arrived. The integrity
    // pass only runs after our own visible signals, so it must put the current
    // grid on screen; the next real frame repaints it correctly.
    const { refresh, renderService, terminal } = createMockTerminal({
      synchronizedOutput: true,
    });
    const clearTextureAtlas = vi.fn();

    forceTerminalRender(terminal, { clearTextureAtlas });

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(renderService._pausedResizeTask.flush).toHaveBeenCalledTimes(1);
    expect(renderService._isPaused).toBe(false);
    expect(renderService._needsFullRefresh).toBe(false);
    expect(renderService._renderer?.value?.renderRows).toHaveBeenCalledWith(0, 23);
    expect(renderService.refreshRows).not.toHaveBeenCalled();
    expect(renderService._renderRows).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears a stranded synchronized-output mode on the fallback render path", () => {
    // When the private renderer handle is unavailable we fall back to
    // _renderRows / refreshRows, both of which buffer under synchronized
    // output. Clear the stranded mode first so the fallback actually paints;
    // the next live delta's own `?2026h` re-enters sync cleanly.
    const { coreService, renderService, terminal } = createMockTerminal({
      synchronizedOutput: true,
      hasRenderer: false,
    });

    forceTerminalRender(terminal);

    expect(coreService.decPrivateModes.synchronizedOutput).toBe(false);
    expect(renderService._renderRows).toHaveBeenCalledWith(0, 23);
    expect(renderService._isNextRenderRedrawOnly).toBe(true);
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
