// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriListeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();

class MockTerminal {
  static instances: MockTerminal[] = [];

  buffer = "";
  cols: number;
  rows: number;
  options: Record<string, unknown>;

  constructor(options: { cols?: number; rows?: number } = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.options = { ...options };
    MockTerminal.instances.push(this);
  }

  dispose = vi.fn();

  loadAddon = vi.fn();

  open = vi.fn();

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

const sessionStoreMock = {
  getState: vi.fn(() => ({ sessions: {} })),
  subscribe: vi.fn(() => () => {}),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
    let callbacks = tauriListeners.get(eventName);
    if (!callbacks) {
      callbacks = new Set();
      tauriListeners.set(eventName, callbacks);
    }
    callbacks.add(callback);
    return Promise.resolve(() => {
      const current = tauriListeners.get(eventName);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) {
        tauriListeners.delete(eventName);
      }
    });
  }),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: sessionStoreMock,
}));

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function emitTauriEvent(eventName: string, payload: unknown): void {
  const callbacks = tauriListeners.get(eventName);
  if (!callbacks) return;
  for (const callback of callbacks) {
    callback({ payload });
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function decodeSnapshot(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function createPooledEntry(serialized: string, cols = 80, rows = 24) {
  const terminal = new MockTerminal({ cols, rows });
  terminal.buffer = serialized;
  const container = document.createElement("div");
  document.body.appendChild(container);
  return {
    terminal,
    fitAddon: {} as never,
    searchAddon: {} as never,
    container,
    initialized: true,
    onTerminated: null,
    teardown: null,
    lastAccessedAt: Date.now(),
    webglAttached: false,
    webglAddon: null,
    webglFailed: false,
    webglState: "disabled" as const,
    webglRecoveryTimer: null,
    renderIntegrityFrame: null,
    renderIntegrityTimer: null,
    pendingCommand: "",
    exitRequestedAt: null,
    parkedBroadcastUnlisten: null,
  };
}

describe("terminal preview sources", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    tauriListeners.clear();
    invokeMock.mockReset();
    MockTerminal.instances = [];
  });

  afterEach(async () => {
    const mod = await import("@/lib/terminal-pool");
    mod.__resetTerminalPoolForTests();
    vi.useRealTimers();
  });

  it("bootstraps from a parked pooled terminal when one is available", async () => {
    invokeMock.mockResolvedValue({
      processState: "running",
      attachmentState: "parked",
      cols: 96,
      rows: 30,
      snapshot: encode("backend bootstrap"),
      outputOffset: "backend bootstrap".length,
    });

    const mod = await import("@/lib/terminal-pool");
    const entry = createPooledEntry("pooled viewport", 96, 30);
    const initialInstanceCount = MockTerminal.instances.length;

    mod.setPoolEntry("session-1", entry as never);
    mod.parkTerminal("session-1");

    const subscription = await mod.subscribeToPreviewSource("session-1", {});

    expect(decodeSnapshot(subscription.snapshot.data)).toBe("backend bootstrap");
    expect(subscription.snapshot.cols).toBe(96);
    expect(subscription.snapshot.rows).toBe(30);
    expect(MockTerminal.instances).toHaveLength(initialInstanceCount);

    subscription.unsubscribe();
  });

  it("bootstraps from backend preview data when no pooled source exists", async () => {
    invokeMock.mockResolvedValue({
      processState: "running",
      attachmentState: "detached",
      cols: 120,
      rows: 40,
      snapshot: encode("headless bootstrap"),
      outputOffset: "headless bootstrap".length,
    });

    const mod = await import("@/lib/terminal-pool");
    const subscription = await mod.subscribeToPreviewSource("session-2", {});

    expect(decodeSnapshot(subscription.snapshot.data)).toBe("headless bootstrap");
    expect(subscription.snapshot.cols).toBe(120);
    expect(subscription.snapshot.rows).toBe(40);
    expect(MockTerminal.instances).toHaveLength(1);

    subscription.unsubscribe();
  });

  it("coalesces deltas without using an interval-driven refresh loop", async () => {
    invokeMock.mockResolvedValue({
      processState: "running",
      attachmentState: "detached",
      cols: 80,
      rows: 24,
      snapshot: encode("seed"),
      outputOffset: "seed".length,
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const deltas: string[] = [];

    const mod = await import("@/lib/terminal-pool");
    const subscription = await mod.subscribeToPreviewSource("session-3", {
      onDelta: (event) => {
        deltas.push(new TextDecoder().decode(event.data));
      },
    });

    emitTauriEvent("pty-output-broadcast:session-3", {
      data: encode("A"),
      endOffset: 5,
    });
    emitTauriEvent("pty-output-broadcast:session-3", {
      data: encode("B"),
      endOffset: 6,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(deltas).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(deltas).toEqual(["AB"]);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    subscription.unsubscribe();
  });

  it("emits a single reset when the source hands off from headless to pooled", async () => {
    invokeMock
      .mockResolvedValueOnce({
        processState: "running",
        attachmentState: "detached",
        cols: 90,
        rows: 25,
        snapshot: encode("headless source"),
        outputOffset: "headless source".length,
      })
      .mockResolvedValueOnce({
        processState: "running",
        attachmentState: "parked",
        cols: 90,
        rows: 25,
        snapshot: encode("pooled handoff"),
        outputOffset: "pooled handoff".length,
      });
    const resets: string[] = [];

    const mod = await import("@/lib/terminal-pool");
    const subscription = await mod.subscribeToPreviewSource("session-4", {
      onReset: (snapshot) => {
        resets.push(decodeSnapshot(snapshot.data));
      },
    });

    const pooledEntry = createPooledEntry("pooled handoff", 90, 25);
    mod.setPoolEntry("session-4", pooledEntry as never);
    mod.parkTerminal("session-4");
    await vi.waitFor(() => {
      expect(resets).toEqual(["pooled handoff"]);
    });

    subscription.unsubscribe();
  });

  it("keeps headless output that arrives during bootstrap after the snapshot offset", async () => {
    let resolveBootstrap: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = resolve;
        }),
    );
    const deltas: string[] = [];

    const mod = await import("@/lib/terminal-pool");
    const subscriptionPromise = mod.subscribeToPreviewSource("session-6", {
      onDelta: (event) => {
        deltas.push(new TextDecoder().decode(event.data));
      },
    });

    await flushAsync();
    emitTauriEvent("pty-output-broadcast:session-6", {
      data: encode("tail"),
      endOffset: 8,
    });
    const bootstrapResolver = resolveBootstrap;
    if (!bootstrapResolver) {
      throw new Error("expected bootstrap resolver");
    }
    bootstrapResolver({
      processState: "running",
      attachmentState: "detached",
      cols: 80,
      rows: 24,
      snapshot: encode("seed"),
      outputOffset: 4,
    });

    const subscription = await subscriptionPromise;
    expect(decodeSnapshot(subscription.snapshot.data)).toBe("seed");

    await vi.advanceTimersByTimeAsync(100);
    expect(deltas).toEqual(["tail"]);

    subscription.unsubscribe();
  });

  it("returns a fresh snapshot for later subscribers on an active source", async () => {
    invokeMock.mockResolvedValue({
      processState: "running",
      attachmentState: "detached",
      cols: 80,
      rows: 24,
      snapshot: encode("seed"),
      outputOffset: 4,
    });

    const mod = await import("@/lib/terminal-pool");
    const first = await mod.subscribeToPreviewSource("session-7", {});

    emitTauriEvent("pty-output-broadcast:session-7", {
      data: encode("++"),
      endOffset: 6,
    });
    await vi.advanceTimersByTimeAsync(100);

    const second = await mod.subscribeToPreviewSource("session-7", {});

    expect(decodeSnapshot(second.snapshot.data)).toBe("seed++");

    first.unsubscribe();
    second.unsubscribe();
  });

  it("does not mutate a pooled terminal after it leaves the parked pool", async () => {
    const bootstrapResolvers: Array<(value: unknown) => void> = [];
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          bootstrapResolvers.push(resolve);
        }),
    );

    const mod = await import("@/lib/terminal-pool");
    const entry = createPooledEntry("pooled viewport", 90, 25);
    mod.setPoolEntry("session-8", entry as never);
    mod.parkTerminal("session-8");

    const subscriptionPromise = mod.subscribeToPreviewSource("session-8", {});
    await flushAsync();

    document.body.appendChild(entry.container);
    mod.unparkTerminal("session-8");

    const firstBootstrap = bootstrapResolvers.shift();
    if (!firstBootstrap) {
      throw new Error("expected initial pooled bootstrap");
    }
    firstBootstrap({
      processState: "running",
      attachmentState: "attached",
      cols: 120,
      rows: 40,
      snapshot: encode("live"),
      outputOffset: 4,
    });
    await flushAsync();

    await vi.waitFor(() => {
      expect(bootstrapResolvers.length).toBeGreaterThan(0);
    });
    bootstrapResolvers.shift()?.({
      processState: "running",
      attachmentState: "attached",
      cols: 120,
      rows: 40,
      snapshot: encode("live"),
      outputOffset: 4,
    });

    const subscription = await subscriptionPromise;

    expect(entry.terminal.resize).not.toHaveBeenCalledWith(120, 40);
    expect(entry.terminal.cols).toBe(90);
    expect(entry.terminal.rows).toBe(25);
    expect(decodeSnapshot(subscription.snapshot.data)).toBe("live");

    subscription.unsubscribe();
  });

  it("applyTerminalFontSize is a no-op (returns null) when no pool entry exists", async () => {
    const mod = await import("@/lib/terminal-pool");
    expect(mod.applyTerminalFontSize("missing-session", 18)).toBeNull();
    expect(mod.getTerminalFontSize("missing-session")).toBeNull();
  });

  it("applyTerminalFontSize writes the new size to the terminal options and clears the WebGL atlas", async () => {
    const mod = await import("@/lib/terminal-pool");
    const entry = createPooledEntry("viewport");
    const clearTextureAtlas = vi.fn();
    const fit = vi.fn();
    entry.webglAddon = {
      dispose: vi.fn(),
      clearTextureAtlas,
    } as unknown as typeof entry.webglAddon;
    (entry as { fitAddon: { fit: () => void } }).fitAddon = { fit };
    mod.setPoolEntry("session-font", entry as never);

    expect(mod.applyTerminalFontSize("session-font", 18)).toBe(18);
    expect(entry.terminal.options.fontSize).toBe(18);
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledTimes(1);

    expect(mod.getTerminalFontSize("session-font")).toBe(18);
  });

  it("applyTerminalFontSize skips fit() while a pool entry is parked", async () => {
    const mod = await import("@/lib/terminal-pool");
    const entry = createPooledEntry("viewport");
    const fit = vi.fn();
    (entry as { fitAddon: { fit: () => void } }).fitAddon = { fit };
    mod.setPoolEntry("session-parked", entry as never);
    mod.parkTerminal("session-parked");

    expect(mod.applyTerminalFontSize("session-parked", 20)).toBe(20);
    expect(entry.terminal.options.fontSize).toBe(20);
    expect(fit).not.toHaveBeenCalled();
  });

  it("applyTerminalFontSize clamps out-of-range and non-finite inputs", async () => {
    const mod = await import("@/lib/terminal-pool");
    const entry = createPooledEntry("viewport");
    (entry as { fitAddon: { fit: () => void } }).fitAddon = { fit: vi.fn() };
    mod.setPoolEntry("session-clamp", entry as never);

    expect(mod.applyTerminalFontSize("session-clamp", 999)).toBe(32);
    expect(entry.terminal.options.fontSize).toBe(32);

    expect(mod.applyTerminalFontSize("session-clamp", 1)).toBe(8);
    expect(entry.terminal.options.fontSize).toBe(8);

    expect(mod.applyTerminalFontSize("session-clamp", Number.NaN)).toBe(13);
    expect(entry.terminal.options.fontSize).toBe(13);
  });

  it("unsubscribes and tears down preview listeners when the last subscriber leaves", async () => {
    invokeMock.mockResolvedValue({
      processState: "running",
      attachmentState: "detached",
      cols: 80,
      rows: 24,
      snapshot: encode("seed"),
      outputOffset: "seed".length,
    });
    const deltas: string[] = [];

    const mod = await import("@/lib/terminal-pool");
    const subscription = await mod.subscribeToPreviewSource("session-5", {
      onDelta: (event) => {
        deltas.push(new TextDecoder().decode(event.data));
      },
    });

    expect(tauriListeners.get("pty-output-broadcast:session-5")?.size).toBe(1);
    expect(tauriListeners.get("pty-state-broadcast:session-5")?.size).toBe(1);

    subscription.unsubscribe();
    await flushAsync();

    expect(tauriListeners.get("pty-output-broadcast:session-5")).toBeUndefined();
    expect(tauriListeners.get("pty-state-broadcast:session-5")).toBeUndefined();

    emitTauriEvent("pty-output-broadcast:session-5", {
      data: encode("ignored"),
      endOffset: 11,
    });
    await vi.runAllTimersAsync();
    expect(deltas).toEqual([]);
  });
});
