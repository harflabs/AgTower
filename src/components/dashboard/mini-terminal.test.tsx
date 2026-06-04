// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PreviewSourceSnapshot {
  data: Uint8Array;
  cols: number;
  rows: number;
  revision: number;
  processState: "running" | "terminated";
  attachmentState: "attached" | "detached" | "parked";
}

interface PreviewSourceDelta {
  revision: number;
  data: Uint8Array;
}

interface PreviewSourceListener {
  onDelta?: (event: PreviewSourceDelta) => void;
  onReset?: (snapshot: PreviewSourceSnapshot) => void;
}

const reactActEnv = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

class MockTerminal {
  static instances: MockTerminal[] = [];

  cols: number;
  rows: number;
  // Accumulated text written into the terminal (assertion target).
  written = "";
  options: Record<string, unknown>;
  // Which screen buffer is active — applyContentAnchor branches on this.
  bufferType: "normal" | "alternate" = "normal";
  // The rendered .xterm element the component caches and anchors.
  element: HTMLElement;

  constructor(options: { cols?: number; rows?: number } = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.options = { ...options };
    this.element = document.createElement("div");
    this.element.className = "xterm";
    MockTerminal.instances.push(this);
  }

  // How many leading buffer rows report text — drives applyContentAnchor's
  // content-tail scan. 0 = empty grid (the placeholder path).
  contentRows = 0;

  // Minimal xterm `buffer.active` shape so applyContentAnchor can scan rows.
  get buffer() {
    return {
      active: {
        type: this.bufferType,
        baseY: 0,
        cursorY: 0,
        length: this.rows,
        getLine: (i: number) => ({
          translateToString: () => (i < this.contentRows ? "content" : ""),
        }),
      },
    };
  }

  dispose = vi.fn();
  open = vi.fn((container: HTMLElement) => {
    container.appendChild(this.element);
  });
  refresh = vi.fn();
  reset = vi.fn(() => {
    this.written = "";
  });
  resize = vi.fn((cols: number, rows: number) => {
    this.cols = cols;
    this.rows = rows;
  });
  write = vi.fn((data: string | Uint8Array, callback?: () => void) => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.written += text;
    callback?.();
  });
}

const subscribeMock =
  vi.fn<
    (
      sessionId: string,
      listener: PreviewSourceListener,
    ) => Promise<{
      snapshot: PreviewSourceSnapshot;
      unsubscribe: () => void;
    }>
  >();

vi.mock("@/lib/terminal-pool", () => ({
  subscribeToPreviewSource: (sessionId: string, listener: PreviewSourceListener) =>
    subscribeMock(sessionId, listener),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}));

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  constructor(
    public callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void,
  ) {
    MockResizeObserver.instances.push(this);
  }

  disconnect = vi.fn();
  observe = vi.fn();
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  constructor(
    public callback: (
      entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>,
    ) => void,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  disconnect = vi.fn();
  observe = vi.fn();
}

let latestListener: PreviewSourceListener | null = null;
let nextSnapshot: PreviewSourceSnapshot;
let unsubscribeSpy: ReturnType<typeof vi.fn<() => void>>;

function snapshot(text: string, revision: number, cols = 80, rows = 24): PreviewSourceSnapshot {
  return {
    data: new TextEncoder().encode(text),
    cols,
    rows,
    revision,
    processState: "running",
    attachmentState: "detached",
  };
}

function emptySnapshot(
  processState: "running" | "terminated",
  revision: number,
): PreviewSourceSnapshot {
  return {
    data: new Uint8Array(0),
    cols: 80,
    rows: 24,
    revision,
    processState,
    attachmentState: "detached",
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Resolve after the next animation frame so a ResizeObserver-scheduled
// requestAnimationFrame callback has a chance to run (real timers).
function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderMini() {
  const { MiniTerminal } = await import("@/components/dashboard/mini-terminal");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(<MiniTerminal sessionId="session-1" />);
  });

  const mini = host.querySelector(".mini-terminal") as HTMLDivElement;
  Object.defineProperty(mini, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(mini, "clientHeight", { configurable: true, value: 160 });

  return { host, mini, root };
}

async function makeVisible() {
  await act(async () => {
    for (const observer of MockResizeObserver.instances) {
      observer.callback([{ contentRect: { width: 320, height: 160 } }]);
    }
    for (const observer of MockIntersectionObserver.instances) {
      observer.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    }
    await flushAsync();
  });
}

describe("MiniTerminal", () => {
  beforeEach(() => {
    vi.resetModules();
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
    MockTerminal.instances = [];
    MockResizeObserver.instances = [];
    MockIntersectionObserver.instances = [];
    unsubscribeSpy = vi.fn<() => void>();
    latestListener = null;
    nextSnapshot = snapshot("boot", 1);
    subscribeMock.mockReset();
    subscribeMock.mockImplementation(async (_sessionId, listener) => {
      latestListener = listener;
      return {
        snapshot: nextSnapshot,
        unsubscribe: unsubscribeSpy,
      };
    });
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  it("hydrates once on mount", async () => {
    const view = await renderMini();
    await makeVisible();

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(MockTerminal.instances).toHaveLength(1);
    expect(MockTerminal.instances[0]?.reset).toHaveBeenCalledTimes(1);
    expect(MockTerminal.instances[0]?.written).toBe("boot");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("appends incremental output without resetting on normal updates", async () => {
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    await act(async () => {
      latestListener?.onDelta?.({
        revision: 1,
        data: new TextEncoder().encode("++"),
      });
      await flushAsync();
    });

    expect(terminal.reset).toHaveBeenCalledTimes(1);
    expect(terminal.written).toBe("boot++");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("resnapshots exactly once on reset events", async () => {
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    await act(async () => {
      latestListener?.onReset?.(snapshot("resynced", 2, 100, 30));
      await flushAsync();
    });

    expect(terminal.reset).toHaveBeenCalledTimes(2);
    expect(terminal.written).toBe("resynced");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("matches the PTY's full geometry so cursor positioning isn't clamped", async () => {
    // The mini must render at the PTY's real row count. If it renders fewer
    // rows, xterm's _restrictCursor clamps any cursor move targeting rows
    // beyond the mini's viewport onto the last row, piling content from
    // every TUI redraw onto a single line. Card overflow:hidden plus the
    // bottom-pinned .xterm element handles the visual clipping instead.
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    await act(async () => {
      latestListener?.onReset?.(snapshot("resized", 2, 120, 40));
      await flushAsync();
    });

    expect(terminal.resize).toHaveBeenLastCalledWith(120, 40);

    await act(async () => {
      view.root.unmount();
    });
  });

  it("shows the DOM overlay placeholder for an empty snapshot instead of writing the grid", async () => {
    nextSnapshot = emptySnapshot("running", 1);
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    const overlay = view.mini.querySelector("[data-mini-overlay]") as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay?.style.display).not.toBe("none");
    expect(overlay?.textContent).toContain("Waiting for output");
    // The placeholder is NOT written into the terminal grid.
    expect(terminal.written).toBe("");
    expect(terminal.write).not.toHaveBeenCalled();

    await act(async () => {
      view.root.unmount();
    });
  });

  it("shows the external-CLI placeholder for a terminated empty snapshot", async () => {
    nextSnapshot = emptySnapshot("terminated", 1);
    const view = await renderMini();
    await makeVisible();

    const overlay = view.mini.querySelector("[data-mini-overlay]") as HTMLElement | null;
    expect(overlay?.style.display).not.toBe("none");
    expect(overlay?.textContent).toContain("External CLI session");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("hides the overlay and writes the grid for a non-empty snapshot", async () => {
    nextSnapshot = snapshot("hello", 1);
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    const overlay = view.mini.querySelector("[data-mini-overlay]") as HTMLElement | null;
    // Overlay is either never created or hidden; the grid holds the real data.
    expect(overlay?.style.display ?? "none").toBe("none");
    expect(terminal.written).toBe("hello");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("anchors the visible band to the content's tail for mid-grid content", async () => {
    // The blind spot this guards: a 71-row grid whose content ends at row 28.
    // A binary top/bottom anchor hides it under BOTH choices (top band shows
    // rows 0..19, bottom band rows 51..70) and the card renders blank even
    // though a non-empty snapshot was applied. The element must instead shift
    // up just enough that the last content row is the band's last row.
    nextSnapshot = snapshot("resume output", 1, 80, 71);
    const view = await renderMini();
    await makeVisible();
    const terminal = MockTerminal.instances[0]!;

    // Content occupies rows 0..28 of the 71-row grid.
    terminal.contentRows = 29;
    await act(async () => {
      for (const observer of MockResizeObserver.instances) {
        observer.callback([{ contentRect: { width: 320, height: 160 } }]);
      }
      await waitForFrame();
      await flushAsync();
    });

    // fitPreview(320, 80, 71) clamps to the 8px floor; the mock has no real
    // render dims, so cellH falls back to fontSize * CELL_HEIGHT_RATIO = 8.
    // visibleRows = floor(160 / 8) = 20; offset = (28 + 1) - 20 = 9 rows.
    expect(terminal.element.style.top).toBe("-72px");
    expect(terminal.element.style.bottom).toBe("");

    // Short content still top-anchors (offset clamps to 0).
    terminal.contentRows = 5;
    await act(async () => {
      for (const observer of MockResizeObserver.instances) {
        observer.callback([{ contentRect: { width: 320, height: 160 } }]);
      }
      await waitForFrame();
      await flushAsync();
    });
    expect(terminal.element.style.top).toBe("0px");

    // Content reaching the grid's end behaves like the old bottom anchor:
    // offset clamps to term.rows - visibleRows = 51 rows.
    terminal.contentRows = 71;
    await act(async () => {
      for (const observer of MockResizeObserver.instances) {
        observer.callback([{ contentRect: { width: 320, height: 160 } }]);
      }
      await waitForFrame();
      await flushAsync();
    });
    expect(terminal.element.style.top).toBe("-408px");

    await act(async () => {
      view.root.unmount();
    });
  });

  it("subscribes after a deferred sub-10px card grows, never dead-ending blank", async () => {
    // Prod sequence that previously dead-ended: the IntersectionObserver fires
    // visible while the card is still 0x0, so initTerminal bails and the term is
    // null. The old subscribeVisible bailed on `!term`, and the fallback only
    // re-inited (never subscribed) — leaving a term with no subscription, blank
    // forever. The consolidated path must subscribe once the card grows.
    nextSnapshot = snapshot("late", 1);
    const { MiniTerminal } = await import("@/components/dashboard/mini-terminal");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<MiniTerminal sessionId="session-1" />);
    });

    const mini = host.querySelector(".mini-terminal") as HTMLDivElement;
    // Card starts at 0x0 — too small for initTerminal.
    Object.defineProperty(mini, "clientWidth", { configurable: true, value: 0 });
    Object.defineProperty(mini, "clientHeight", { configurable: true, value: 0 });

    // Become visible while sub-10px: must NOT leak a subscription or render.
    await act(async () => {
      for (const observer of MockIntersectionObserver.instances) {
        observer.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
      }
      await flushAsync();
    });
    expect(MockTerminal.instances).toHaveLength(0);
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Card grows; the ResizeObserver RAF re-enters the consolidated path. The
    // RO callback schedules a requestAnimationFrame, so wait for it to fire.
    Object.defineProperty(mini, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(mini, "clientHeight", { configurable: true, value: 160 });
    await act(async () => {
      for (const observer of MockResizeObserver.instances) {
        observer.callback([{ contentRect: { width: 320, height: 160 } }]);
      }
      await waitForFrame();
      await flushAsync();
      await flushAsync();
    });

    // Exactly one terminal now exists, the subscription was established, and the
    // snapshot was applied (real data written) — never the permanent-blank
    // dead-end (term exists, buffer empty, overlay hidden).
    expect(MockTerminal.instances).toHaveLength(1);
    expect(subscribeMock).toHaveBeenCalled();
    expect(MockTerminal.instances[0]?.written).toBe("late");

    await act(async () => {
      root.unmount();
    });
  });
});
