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
  buffer = "";
  options: Record<string, unknown>;

  constructor(options: { cols?: number; rows?: number } = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.options = { ...options };
    MockTerminal.instances.push(this);
  }

  dispose = vi.fn();
  open = vi.fn();
  refresh = vi.fn();
  reset = vi.fn(() => {
    this.buffer = "";
  });
  resize = vi.fn((cols: number, rows: number) => {
    this.cols = cols;
    this.rows = rows;
  });
  write = vi.fn((data: string | Uint8Array, callback?: () => void) => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.buffer += text;
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

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
    expect(MockTerminal.instances[0]?.buffer).toBe("boot");

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
    expect(terminal.buffer).toBe("boot++");

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
    expect(terminal.buffer).toBe("resynced");

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
});
