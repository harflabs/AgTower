/**
 * Terminal Pool — keeps xterm.js instances alive across React mount/unmount cycles.
 *
 * Three tiers:
 * - Active: currently visible, full resources (xterm + WebGL + 5000-line scrollback)
 * - Warm: parked off-screen, lightweight (xterm alive, WebGL detached)
 * - Cold: archived/closed sessions, evicted when pool exceeds MAX_POOL_SIZE
 *
 * Auto-cleanup:
 * - Sessions removed from the store → pool entry destroyed and PTY terminated
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import { useSessionStore } from "@/stores/session-store";
import { clampTerminalFontSize } from "@/stores/settings-store";
import type { PtyOutputBroadcast, PtyPreviewBootstrap, PtySessionState } from "@/types/session";

const MAX_POOL_SIZE = 20;
const DONE_STATUSES = new Set(["archived", "closed"]);
const PREVIEW_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

type RendererMode = "disabled" | "attaching" | "attached" | "recovering" | "fallback";
type PreviewMode = "headless" | "pooled";

const PREVIEW_FONT = 'Menlo, "Geeza Pro", Monaco, "Courier New", monospace';
const PREVIEW_SCROLLBACK = 200;

// ── base64 decoder (mirrors the one in mini-terminal) ──────────────
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

// ── xterm buffer serialization for self-contained preview snapshots ─
//
// A raw PTY ring-buffer tail is NOT a safe preview snapshot: for any session
// past RING_BUFFER_CAPACITY (2 MB) the tail begins mid-stream, so the TUI's
// one-time setup (alt-screen enter `?1049h`, DECSTBM scroll region, cursor
// origin) has already been evicted. Replaying that tail into a fresh xterm
// leaves the scroll region/origin at xterm defaults, so the TUI's
// bottom-anchored absolute cursor moves (`CSI N;1H`) target the wrong rows
// and xterm's `_restrictCursor` clamps them onto the bottom — the piled-up,
// "garbled" bottom region.
//
// `SerializeAddon.serialize()` instead emits the source terminal's already
// reconstructed grid row-by-row using ONLY relative cursor moves (never
// absolute `CSI N;1H`), plus an `?1049h`/`?1049l` preamble for the alt
// buffer. The result is self-contained: writing it into a same-size fresh
// xterm reproduces the grid exactly, with no out-of-range cursor moves to
// clamp. Live raw-byte deltas then continue to apply on top, because the
// serialized stream leaves the parser in the correct cursor/screen state.
const serializeAddons = new WeakMap<Terminal, SerializeAddon>();

function ensureSerializeAddon(terminal: Terminal): SerializeAddon {
  let addon = serializeAddons.get(terminal);
  if (!addon) {
    addon = new SerializeAddon();
    terminal.loadAddon(addon);
    serializeAddons.set(terminal, addon);
  }
  return addon;
}

/**
 * Serialize a source terminal's buffer into a self-contained escape stream
 * the mini-terminal can replay without inheriting the raw-tail pile-up.
 *
 * `scrollback: PREVIEW_SCROLLBACK` bounds the cost (the preview only shows the
 * viewport plus a little context) and matches the mini's own scrollback. Alt
 * buffer and terminal modes are included (defaults) so Claude/Codex TUIs that
 * render on the alternate screen round-trip correctly.
 */
function serializeTerminalSnapshot(terminal: Terminal): Uint8Array {
  const addon = ensureSerializeAddon(terminal);
  const serialized = addon.serialize({ scrollback: PREVIEW_SCROLLBACK });
  return new TextEncoder().encode(serialized);
}

export interface PooledTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  container: HTMLDivElement;
  initialized: boolean;
  onTerminated:
    | ((info: { code: number | null; signal: string | null; requestedByUser: boolean }) => void)
    | null;
  teardown: (() => void) | null;
  lastAccessedAt: number;
  /** Whether a WebGL addon is currently attached. Detached on park to free GPU context. */
  webglAttached: boolean;
  /** Reference to the active WebGL addon, for explicit disposal on park. */
  webglAddon: { dispose(): void; clearTextureAtlas?: () => void } | null;
  /** True if WebGL failed to initialize — prevents repeated retry on every remount. */
  webglFailed: boolean;
  /** Current renderer mode, used to coordinate recovery/fallback across remounts. */
  webglState: RendererMode;
  /** Cancelable WebGL recovery timer. */
  webglRecoveryTimer: number | null;
  /** Pending render-integrity RAF used to heal stale canvas rows after resize/reparent. */
  renderIntegrityFrame: number | null;
  /** Follow-up integrity pass for layout changes that settle after the first frame. */
  renderIntegrityTimer: number | null;
  /** Best-effort tracking of the current typed command line for exit detection. */
  pendingCommand: string;
  /** Timestamp of the last explicit exit command typed by the user. */
  exitRequestedAt: number | null;
  /**
   * While parked, this stores the unlisten function for a broadcast subscription
   * that keeps the off-screen xterm buffer current with the live PTY stream.
   * Cleared on un-park (reparent into a live view) so the session-terminal's
   * own channel becomes the sole writer.
   */
  parkedBroadcastUnlisten: (() => void) | null;
}

export interface PreviewSourceSnapshot {
  data: Uint8Array;
  cols: number;
  rows: number;
  revision: number;
  processState: PtySessionState["processState"];
  attachmentState: PtySessionState["attachmentState"];
}

export interface PreviewSourceDelta {
  revision: number;
  data: Uint8Array;
}

interface PreviewSourceListener {
  onDelta?: (event: PreviewSourceDelta) => void;
  onReset?: (snapshot: PreviewSourceSnapshot) => void;
}

interface HeadlessPreviewTerminal {
  terminal: Terminal;
  container: HTMLDivElement;
}

interface PreviewSourceState {
  currentSnapshot: PreviewSourceSnapshot | null;
  disposed: boolean;
  headless: HeadlessPreviewTerminal | null;
  headlessBroadcastReady: Promise<void> | null;
  headlessBroadcastUnlisten: (() => void) | null;
  headlessFlushTimer: ReturnType<typeof setTimeout> | null;
  headlessIsWriting: boolean;
  headlessPaused: boolean;
  listeners: Set<PreviewSourceListener>;
  metaUnlisten: (() => void) | null;
  mode: PreviewMode | null;
  pendingNotify: boolean;
  pendingStateHint: PtySessionState | null;
  pendingWriteBytes: number;
  pendingWriteChunks: PreviewWriteChunk[];
  pooledDeltaUnsubscribe: (() => void) | null;
  resyncPromise: Promise<PreviewSourceSnapshot> | null;
  revision: number;
  sessionId: string;
}

interface PreviewWriteChunk {
  data: Uint8Array;
  endOffset: number | null;
}

const pool = new Map<string, PooledTerminal>();
const parkedBroadcastObservers = new Map<string, Set<(data: Uint8Array) => void>>();
const previewSources = new Map<string, PreviewSourceState>();

let offscreen: HTMLDivElement | null = null;
function ensureOffscreen(): HTMLDivElement {
  if (!offscreen) {
    offscreen = document.createElement("div");
    offscreen.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden";
    document.body.appendChild(offscreen);
  }
  return offscreen;
}

export function getPoolEntry(sessionId: string): PooledTerminal | undefined {
  return pool.get(sessionId);
}

/**
 * Apply a new font size to a live pool entry and reflow. Returns the applied
 * size (clamped), or null if the session has no live terminal.
 *
 * Mirrors the theme-change integrity pattern: the WebGL atlas caches glyph
 * textures at the old cell size, so we must invalidate it before the next
 * frame. `fitAddon.fit()` then recomputes cols/rows, and the xterm `onResize`
 * handler in session-terminal.tsx forwards the new geometry to the PTY.
 */
export function applyTerminalFontSize(sessionId: string, size: number): number | null {
  const entry = pool.get(sessionId);
  if (!entry) return null;
  const clamped = clampTerminalFontSize(size);
  entry.terminal.options.fontSize = clamped;
  entry.webglAddon?.clearTextureAtlas?.();
  // Parked containers are 1x1; fit() would compute bogus geometry. The
  // session-terminal resize observer re-fits on un-park.
  const parked = entry.container.parentNode === ensureOffscreen();
  if (!parked) {
    try {
      entry.fitAddon.fit();
    } catch {
      // Transient zero dimensions (e.g. mid-remount). Resize observer re-fits.
    }
  }
  return clamped;
}

export function getTerminalFontSize(sessionId: string): number | null {
  const entry = pool.get(sessionId);
  const size = entry?.terminal.options.fontSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

export function setPoolEntry(sessionId: string, entry: PooledTerminal): void {
  entry.lastAccessedAt = Date.now();
  pool.set(sessionId, entry);

  if (isPoolEntryParked(entry)) {
    notifyPreviewSourceLifecycleChange(sessionId);
  }

  if (pool.size > MAX_POOL_SIZE) {
    evictCold();
  }
}

function isPoolEntryParked(entry: PooledTerminal | undefined): entry is PooledTerminal {
  return !!entry && entry.container.parentNode === ensureOffscreen();
}

function getParkedPoolEntry(sessionId: string): PooledTerminal | undefined {
  const entry = pool.get(sessionId);
  return isPoolEntryParked(entry) ? entry : undefined;
}

function defaultPreviewState(mode: PreviewMode | null): PtySessionState {
  return {
    processState: "terminated",
    attachmentState: mode === "pooled" ? "parked" : "detached",
    cols: 80,
    rows: 24,
  };
}

function stateFromBootstrap(
  bootstrap: PtyPreviewBootstrap | null | undefined,
  fallback: PtySessionState,
): PtySessionState {
  if (!bootstrap) return fallback;
  return {
    processState: bootstrap.processState,
    attachmentState: bootstrap.attachmentState,
    cols: bootstrap.cols,
    rows: bootstrap.rows,
  };
}

function samePreviewState(a: PtySessionState | null, b: PtySessionState | null): boolean {
  return (
    !!a &&
    !!b &&
    a.processState === b.processState &&
    a.attachmentState === b.attachmentState &&
    a.cols === b.cols &&
    a.rows === b.rows
  );
}

function buildPreviewSnapshot(
  state: PtySessionState,
  data: Uint8Array,
  revision: number,
): PreviewSourceSnapshot {
  return {
    data,
    cols: state.cols,
    rows: state.rows,
    revision,
    processState: state.processState,
    attachmentState: state.attachmentState,
  };
}

function capSnapshotData(data: Uint8Array): Uint8Array {
  if (data.length <= PREVIEW_SNAPSHOT_MAX_BYTES) return data;
  return data.slice(data.length - PREVIEW_SNAPSHOT_MAX_BYTES);
}

function appendSnapshotData(current: Uint8Array, next: Uint8Array): Uint8Array {
  if (next.length === 0) return current;
  if (current.length === 0) return capSnapshotData(next);

  if (next.length >= PREVIEW_SNAPSHOT_MAX_BYTES) {
    return next.slice(next.length - PREVIEW_SNAPSHOT_MAX_BYTES);
  }

  const keepCurrent = Math.max(0, PREVIEW_SNAPSHOT_MAX_BYTES - next.length);
  const currentTail =
    current.length > keepCurrent ? current.slice(current.length - keepCurrent) : current;
  const merged = new Uint8Array(currentTail.length + next.length);
  merged.set(currentTail, 0);
  merged.set(next, currentTail.length);
  return merged;
}

function parseOutputBroadcast(payload: string | PtyOutputBroadcast): PreviewWriteChunk {
  if (typeof payload === "string") {
    return {
      data: decodeBase64(payload),
      endOffset: null,
    };
  }
  return {
    data: decodeBase64(payload.data),
    endOffset: payload.endOffset,
  };
}

function mergeChunks(chunks: PreviewWriteChunk[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!.data;
  let totalLen = 0;
  for (const chunk of chunks) totalLen += chunk.data.length;
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  return merged;
}

function subscribeToParkedBroadcast(
  sessionId: string,
  listener: (data: Uint8Array) => void,
): () => void {
  let observers = parkedBroadcastObservers.get(sessionId);
  if (!observers) {
    observers = new Set();
    parkedBroadcastObservers.set(sessionId, observers);
  }
  observers.add(listener);
  return () => {
    const current = parkedBroadcastObservers.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      parkedBroadcastObservers.delete(sessionId);
    }
  };
}

function notifyParkedBroadcastObservers(sessionId: string, data: Uint8Array): void {
  const observers = parkedBroadcastObservers.get(sessionId);
  if (!observers || observers.size === 0) return;
  for (const observer of observers) {
    observer(data);
  }
}

function emitPreviewDelta(source: PreviewSourceState, data: Uint8Array): void {
  if (source.disposed || data.length === 0) return;
  if (source.currentSnapshot) {
    source.currentSnapshot = {
      ...source.currentSnapshot,
      data: appendSnapshotData(source.currentSnapshot.data, data),
    };
  }
  const event: PreviewSourceDelta = {
    revision: source.revision,
    data,
  };
  for (const listener of source.listeners) {
    listener.onDelta?.(event);
  }
}

function emitPreviewReset(source: PreviewSourceState, snapshot: PreviewSourceSnapshot): void {
  if (source.disposed) return;
  for (const listener of source.listeners) {
    listener.onReset?.(snapshot);
  }
}

function ensureHeadlessPreviewTerminal(
  source: PreviewSourceState,
  cols: number,
  rows: number,
): HeadlessPreviewTerminal {
  if (source.headless) {
    if (source.headless.container.parentNode !== ensureOffscreen()) {
      ensureOffscreen().appendChild(source.headless.container);
    }
    if (source.headless.terminal.cols !== cols || source.headless.terminal.rows !== rows) {
      source.headless.terminal.resize(cols, rows);
    }
    return source.headless;
  }

  const container = document.createElement("div");
  container.style.cssText =
    "width:1px;height:1px;overflow:hidden;position:absolute;left:0;top:0;pointer-events:none";
  ensureOffscreen().appendChild(container);

  const terminal = new Terminal({
    fontFamily: PREVIEW_FONT,
    fontSize: 13,
    lineHeight: 1.0,
    scrollback: PREVIEW_SCROLLBACK,
    cols,
    rows,
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
  terminal.open(container);
  if (terminal.cols !== cols || terminal.rows !== rows) {
    terminal.resize(cols, rows);
  }

  source.headless = { terminal, container };
  return source.headless;
}

function clearHeadlessFlushTimer(source: PreviewSourceState): void {
  if (source.headlessFlushTimer !== null) {
    clearTimeout(source.headlessFlushTimer);
    source.headlessFlushTimer = null;
  }
}

function clearHeadlessWriteQueue(source: PreviewSourceState): void {
  source.pendingWriteChunks = [];
  source.pendingWriteBytes = 0;
  clearHeadlessFlushTimer(source);
}

function dropQueuedChunksThroughOffset(
  source: PreviewSourceState,
  outputOffset: number | null,
): void {
  if (outputOffset == null) return;
  while (source.pendingWriteChunks.length > 0) {
    const next = source.pendingWriteChunks[0];
    if (!next || next.endOffset == null || next.endOffset > outputOffset) {
      break;
    }
    source.pendingWriteBytes -= next.data.length;
    source.pendingWriteChunks.shift();
  }
}

function scheduleHeadlessFlush(source: PreviewSourceState, delay = PARKED_FLUSH_INTERVAL_MS): void {
  if (source.headlessFlushTimer !== null) return;
  source.headlessFlushTimer = setTimeout(() => {
    source.headlessFlushTimer = null;
    flushHeadlessWrites(source);
  }, delay);
}

function flushHeadlessWrites(source: PreviewSourceState): void {
  if (
    source.mode !== "headless" ||
    source.headlessPaused ||
    source.headlessIsWriting ||
    source.pendingWriteChunks.length === 0 ||
    !source.headless
  ) {
    return;
  }

  const merged = mergeChunks(source.pendingWriteChunks);
  source.pendingWriteChunks = [];
  source.pendingWriteBytes = 0;
  source.headlessIsWriting = true;
  source.headless.terminal.write(merged, () => {
    source.headlessIsWriting = false;
    if (source.mode !== "headless") return;
    emitPreviewDelta(source, merged);
    if (source.pendingWriteChunks.length > 0) {
      scheduleHeadlessFlush(source, 0);
    }
  });
}

function enqueueHeadlessWrite(source: PreviewSourceState, chunk: PreviewWriteChunk): void {
  if (chunk.data.length === 0) return;
  source.pendingWriteChunks.push(chunk);
  source.pendingWriteBytes += chunk.data.length;
  while (
    source.pendingWriteBytes > PARKED_MAX_PENDING_BYTES &&
    source.pendingWriteChunks.length > 1
  ) {
    source.pendingWriteBytes -= source.pendingWriteChunks.shift()!.data.length;
  }
  if (!source.headlessPaused) {
    scheduleHeadlessFlush(source);
  }
}

function teardownHeadlessMode(source: PreviewSourceState): void {
  source.headlessBroadcastUnlisten?.();
  source.headlessBroadcastReady = null;
  source.headlessBroadcastUnlisten = null;
  clearHeadlessWriteQueue(source);
  source.headlessIsWriting = false;
  source.headlessPaused = false;
  source.headless?.terminal.dispose();
  source.headless?.container.remove();
  source.headless = null;
}

function startHeadlessBroadcast(source: PreviewSourceState): Promise<void> {
  if (source.headlessBroadcastUnlisten) {
    return source.headlessBroadcastReady ?? Promise.resolve();
  }

  let removeListener: (() => void) | null = null;
  let cancelled = false;
  let resolveReady: (() => void) | null = null;
  source.headlessBroadcastReady = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  listen<string | PtyOutputBroadcast>(`pty-output-broadcast:${source.sessionId}`, (event) => {
    if (cancelled || source.disposed || source.mode !== "headless") return;
    const chunk = parseOutputBroadcast(event.payload);
    if (chunk.data.length === 0) return;
    enqueueHeadlessWrite(source, chunk);
  })
    .then((unlisten) => {
      if (cancelled) {
        unlisten();
        resolveReady?.();
        return;
      }
      removeListener = unlisten;
      resolveReady?.();
    })
    .catch(() => {
      resolveReady?.();
    });

  source.headlessBroadcastUnlisten = () => {
    cancelled = true;
    if (removeListener) {
      removeListener();
      removeListener = null;
    }
  };
  return source.headlessBroadcastReady;
}

function cleanupSourceMode(source: PreviewSourceState): void {
  if (source.mode === "pooled") {
    source.pooledDeltaUnsubscribe?.();
    source.pooledDeltaUnsubscribe = null;
  } else if (source.mode === "headless") {
    teardownHeadlessMode(source);
  }
  source.mode = null;
}

function switchPreviewMode(source: PreviewSourceState, nextMode: PreviewMode): void {
  if (source.mode === nextMode) return;
  cleanupSourceMode(source);

  if (nextMode === "pooled") {
    const entry = getParkedPoolEntry(source.sessionId);
    if (!entry) {
      source.mode = "headless";
      void startHeadlessBroadcast(source);
      return;
    }
    startParkedBroadcast(source.sessionId, entry);
    source.pooledDeltaUnsubscribe = subscribeToParkedBroadcast(source.sessionId, (data) => {
      if (source.mode !== "pooled") return;
      emitPreviewDelta(source, data);
    });
    source.mode = "pooled";
    return;
  }

  source.mode = "headless";
  void startHeadlessBroadcast(source);
}

function getPreviewSourceState(
  source: PreviewSourceState,
  stateHint: PtySessionState | null,
  bootstrap: PtyPreviewBootstrap | null,
): PtySessionState {
  const currentState = source.currentSnapshot
    ? {
        processState: source.currentSnapshot.processState,
        attachmentState: source.currentSnapshot.attachmentState,
        cols: source.currentSnapshot.cols,
        rows: source.currentSnapshot.rows,
      }
    : defaultPreviewState(source.mode);
  return stateHint ?? stateFromBootstrap(bootstrap, currentState);
}

function captureLiveSnapshot(source: PreviewSourceState): PreviewSourceSnapshot | null {
  return source.currentSnapshot;
}

async function writeTerminalBytes(term: Terminal, bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) return;
  await new Promise<void>((resolve) => {
    term.write(bytes, () => resolve());
  });
}

async function buildHeadlessSnapshot(
  source: PreviewSourceState,
  stateHint: PtySessionState | null,
): Promise<PreviewSourceSnapshot> {
  if (source.disposed) {
    return (
      source.currentSnapshot ??
      buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision)
    );
  }
  await startHeadlessBroadcast(source);
  if (source.disposed) {
    return (
      source.currentSnapshot ??
      buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision)
    );
  }
  const bootstrap = await invoke<PtyPreviewBootstrap | null>("get_pty_preview_bootstrap", {
    sessionId: source.sessionId,
  }).catch(() => null);
  if (source.disposed) {
    return (
      source.currentSnapshot ??
      buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision)
    );
  }
  const state = getPreviewSourceState(source, stateHint, bootstrap);
  const snapshotData = decodeBase64(bootstrap?.snapshot ?? "");
  const headless = ensureHeadlessPreviewTerminal(source, state.cols, state.rows);

  source.headlessPaused = true;
  clearHeadlessFlushTimer(source);
  headless.terminal.reset();
  if (headless.terminal.cols !== state.cols || headless.terminal.rows !== state.rows) {
    headless.terminal.resize(state.cols, state.rows);
  }
  await writeTerminalBytes(headless.terminal, snapshotData);
  dropQueuedChunksThroughOffset(source, bootstrap?.outputOffset ?? null);
  source.headlessPaused = false;
  if (source.pendingWriteChunks.length > 0) {
    scheduleHeadlessFlush(source, 0);
  }

  // Serialize the headless terminal's reconstructed grid rather than handing
  // the mini the raw ring-buffer tail. Even though the headless
  // terminal only parsed the same tail, its serialized output uses relative
  // cursor moves only (no absolute `CSI N;1H`), so re-applying it can't trip
  // xterm's out-of-range cursor clamp and pile onto the bottom rows. Dims come
  // from the source terminal to keep the snapshot's geometry self-consistent.
  const serialized = serializeTerminalSnapshot(headless.terminal);
  source.revision += 1;
  return buildPreviewSnapshot(
    { ...state, cols: headless.terminal.cols, rows: headless.terminal.rows },
    serialized,
    source.revision,
  );
}

async function buildPooledSnapshot(
  source: PreviewSourceState,
  stateHint: PtySessionState | null,
): Promise<PreviewSourceSnapshot> {
  if (source.disposed) {
    return (
      source.currentSnapshot ??
      buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision)
    );
  }
  const bootstrap = await invoke<PtyPreviewBootstrap | null>("get_pty_preview_bootstrap", {
    sessionId: source.sessionId,
  }).catch(() => null);
  if (source.disposed) {
    return (
      source.currentSnapshot ??
      buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision)
    );
  }
  const state = getPreviewSourceState(source, stateHint, bootstrap);
  const entry = getParkedPoolEntry(source.sessionId);
  if (!entry) {
    switchPreviewMode(source, "headless");
    return buildHeadlessSnapshot(source, state);
  }

  // Serialize the parked terminal's reconstructed buffer instead of replaying
  // the raw ring-buffer tail. The parked terminal saw the full
  // stream — startParkedBroadcast keeps it current — so its grid is correct.
  // Take cols/rows from the source terminal so the snapshot dims match the
  // bytes' actual geometry (enforces the row-matching invariant the mini
  // relies on; bootstrap dims can drift if the PTY was resized mid-session).
  const snapshotData = serializeTerminalSnapshot(entry.terminal);
  source.revision += 1;
  return buildPreviewSnapshot(
    { ...state, cols: entry.terminal.cols, rows: entry.terminal.rows },
    snapshotData,
    source.revision,
  );
}

async function performPreviewResync(
  source: PreviewSourceState,
  stateHint: PtySessionState | null,
): Promise<PreviewSourceSnapshot> {
  const nextMode: PreviewMode = getParkedPoolEntry(source.sessionId) ? "pooled" : "headless";
  switchPreviewMode(source, nextMode);
  if (source.mode === "pooled") {
    return buildPooledSnapshot(source, stateHint);
  }
  return buildHeadlessSnapshot(source, stateHint);
}

function queuePreviewResync(
  source: PreviewSourceState,
  notifyListeners: boolean,
  stateHint: PtySessionState | null = null,
): Promise<PreviewSourceSnapshot> {
  if (source.disposed) {
    return Promise.resolve(
      source.currentSnapshot ??
        buildPreviewSnapshot(defaultPreviewState(source.mode), new Uint8Array(0), source.revision),
    );
  }
  source.pendingNotify = source.pendingNotify || notifyListeners;
  source.pendingStateHint = stateHint ?? source.pendingStateHint;

  if (!source.resyncPromise) {
    const pendingStateHint = source.pendingStateHint;
    const shouldNotify = source.pendingNotify;
    source.pendingStateHint = null;
    source.pendingNotify = false;
    source.resyncPromise = performPreviewResync(source, pendingStateHint)
      .then((snapshot) => {
        source.currentSnapshot = snapshot;
        if (shouldNotify) {
          emitPreviewReset(source, snapshot);
        }
        return snapshot;
      })
      .finally(() => {
        source.resyncPromise = null;
        if (source.pendingNotify || source.pendingStateHint) {
          void queuePreviewResync(source, source.pendingNotify, source.pendingStateHint);
        }
      });
  }

  return source.resyncPromise;
}

function ensurePreviewMetaListener(source: PreviewSourceState): void {
  if (source.metaUnlisten) return;

  let removeListener: (() => void) | null = null;
  let cancelled = false;

  listen<PtySessionState>(`pty-state-broadcast:${source.sessionId}`, (event) => {
    if (cancelled || source.disposed || source.listeners.size === 0) return;
    const nextState = event.payload;
    const currentState = source.currentSnapshot
      ? {
          processState: source.currentSnapshot.processState,
          attachmentState: source.currentSnapshot.attachmentState,
          cols: source.currentSnapshot.cols,
          rows: source.currentSnapshot.rows,
        }
      : null;
    if (samePreviewState(currentState, nextState)) return;
    void queuePreviewResync(source, true, nextState);
  })
    .then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      removeListener = unlisten;
    })
    .catch(() => {});

  source.metaUnlisten = () => {
    cancelled = true;
    if (removeListener) {
      removeListener();
      removeListener = null;
    }
  };
}

function createPreviewSource(sessionId: string): PreviewSourceState {
  return {
    currentSnapshot: null,
    disposed: false,
    headless: null,
    headlessBroadcastReady: null,
    headlessBroadcastUnlisten: null,
    headlessFlushTimer: null,
    headlessIsWriting: false,
    headlessPaused: false,
    listeners: new Set(),
    metaUnlisten: null,
    mode: null,
    pendingNotify: false,
    pendingStateHint: null,
    pendingWriteBytes: 0,
    pendingWriteChunks: [],
    pooledDeltaUnsubscribe: null,
    resyncPromise: null,
    revision: 0,
    sessionId,
  };
}

function destroyPreviewSource(sessionId: string): void {
  const source = previewSources.get(sessionId);
  if (!source) return;
  source.disposed = true;
  source.metaUnlisten?.();
  source.metaUnlisten = null;
  cleanupSourceMode(source);
  previewSources.delete(sessionId);
}

function notifyPreviewSourceLifecycleChange(sessionId: string): void {
  const source = previewSources.get(sessionId);
  if (!source || source.disposed || source.listeners.size === 0) return;
  void queuePreviewResync(source, true);
}

export async function subscribeToPreviewSource(
  sessionId: string,
  listener: PreviewSourceListener,
): Promise<{ snapshot: PreviewSourceSnapshot; unsubscribe: () => void }> {
  let source = previewSources.get(sessionId);
  if (!source) {
    source = createPreviewSource(sessionId);
    previewSources.set(sessionId, source);
  }

  source.listeners.add(listener);
  ensurePreviewMetaListener(source);
  const snapshot = source.resyncPromise
    ? await source.resyncPromise
    : (captureLiveSnapshot(source) ??
      source.currentSnapshot ??
      (await queuePreviewResync(source, false)));
  source.currentSnapshot = snapshot;

  return {
    snapshot,
    unsubscribe: () => {
      const current = previewSources.get(sessionId);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        destroyPreviewSource(sessionId);
      }
    },
  };
}

export function __resetTerminalPoolForTests(): void {
  for (const sessionId of Array.from(previewSources.keys())) {
    destroyPreviewSource(sessionId);
  }
  parkedBroadcastObservers.clear();
  for (const sessionId of Array.from(pool.keys())) {
    disposePoolEntry(sessionId);
  }
  if (offscreen) {
    offscreen.remove();
    offscreen = null;
  }
}

/**
 * Subscribe the parked xterm instance to PTY broadcasts so its buffer stays
 * current while the user isn't looking at the session view. Without this,
 * the parked terminal is a frozen snapshot from the moment the user left,
 * which makes any dashboard mini-terminal reading from the parked buffer
 * miss output produced after parking.
 *
 * Writes are coalesced at `PARKED_FLUSH_INTERVAL_MS` to amortise xterm's
 * parser overhead. A single 30 KB `terminal.write()` is dramatically cheaper
 * than 30 × 1 KB writes for rapid-redraw TUIs (Codex in particular, which
 * can emit ~1 MB/s of alt-screen redraws during token streaming). The
 * dashboard preview only needs ~100 ms freshness, so batching this far
 * costs nothing perceptually.
 *
 * Mutually exclusive with the session-terminal's own channel writer; the
 * listener is removed by `unparkTerminal()` before the active channel
 * re-attaches on remount, so a single byte never reaches the terminal twice.
 */
const PARKED_FLUSH_INTERVAL_MS = 100;
/** Safety cap — if writes outpace the flush timer we drop oldest chunks.
 *  This should never trigger in practice: a 1 MB/s stream produces ~100 KB
 *  per flush window, well under the cap. */
const PARKED_MAX_PENDING_BYTES = 4 * 1024 * 1024;

function startParkedBroadcast(sessionId: string, entry: PooledTerminal): void {
  if (entry.parkedBroadcastUnlisten) return;

  let removeListener: (() => void) | null = null;
  let cancelled = false;
  let pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    flushTimer = null;
    if (cancelled || pendingChunks.length === 0) return;
    const chunks = pendingChunks;
    pendingChunks = [];
    pendingBytes = 0;

    let merged: Uint8Array;
    if (chunks.length === 1) {
      merged = chunks[0];
    } else {
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
    }

    try {
      entry.terminal.write(merged, () => {
        notifyParkedBroadcastObservers(sessionId, merged);
      });
    } catch {
      // Terminal may have been disposed between listener fire and here.
    }
  }

  listen<string | PtyOutputBroadcast>(`pty-output-broadcast:${sessionId}`, (event) => {
    if (cancelled) return;
    const chunk = parseOutputBroadcast(event.payload);
    if (chunk.data.length === 0) return;
    pendingChunks.push(chunk.data);
    pendingBytes += chunk.data.length;
    // Overflow guard: if somehow bytes outpace the flush cadence, drop the
    // oldest chunks. We keep at least the most recent chunk so the terminal
    // can still self-correct on the next full Codex redraw.
    while (pendingBytes > PARKED_MAX_PENDING_BYTES && pendingChunks.length > 1) {
      pendingBytes -= pendingChunks.shift()!.length;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flush, PARKED_FLUSH_INTERVAL_MS);
    }
  })
    .then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      removeListener = unlisten;
    })
    .catch(() => {
      // listen() can reject during app shutdown — nothing to clean up.
    });

  entry.parkedBroadcastUnlisten = () => {
    cancelled = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // Drop any buffered bytes — on un-park the session-terminal resets the
    // xterm and replays the full ring buffer via its own channel, so a final
    // flush would just be duplicate work.
    pendingChunks = [];
    pendingBytes = 0;
    if (removeListener) {
      removeListener();
      removeListener = null;
    }
  };
}

function stopParkedBroadcast(entry: PooledTerminal): void {
  if (entry.parkedBroadcastUnlisten) {
    entry.parkedBroadcastUnlisten();
    entry.parkedBroadcastUnlisten = null;
  }
}

/** Move a terminal to the off-screen parking area and release heavy resources. */
export function parkTerminal(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry?.container.parentNode) return;
  ensureOffscreen().appendChild(entry.container);
  entry.lastAccessedAt = Date.now();

  if (entry.webglRecoveryTimer !== null) {
    window.clearTimeout(entry.webglRecoveryTimer);
    entry.webglRecoveryTimer = null;
  }
  if (entry.renderIntegrityFrame !== null) {
    window.cancelAnimationFrame(entry.renderIntegrityFrame);
    entry.renderIntegrityFrame = null;
  }
  if (entry.renderIntegrityTimer !== null) {
    window.clearTimeout(entry.renderIntegrityTimer);
    entry.renderIntegrityTimer = null;
  }

  // Explicitly dispose WebGL addon to free GPU context (browsers limit to ~16).
  // xterm falls back to Canvas2D while parked — invisible since it's off-screen.
  // WebGL is reattached on reparent in session-terminal.tsx fast path.
  if (entry.webglAttached && entry.webglAddon) {
    try {
      entry.webglAddon.dispose();
    } catch {}
    entry.webglAddon = null;
    entry.webglAttached = false;
  }
  entry.webglState = "disabled";

  // Keep the off-screen buffer in sync with live PTY output so previews
  // (mini-terminals on the dashboard) can serialize a fresh snapshot at
  // any time — not just the stale state from when the user last viewed it.
  startParkedBroadcast(sessionId, entry);
  notifyPreviewSourceLifecycleChange(sessionId);
}

/**
 * Stop the parked broadcast listener for a session. Call this right before
 * reparenting a pool entry back into a live view, so the session-terminal's
 * own channel becomes the sole writer and the replay snapshot isn't duplicated.
 */
export function unparkTerminal(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;
  stopParkedBroadcast(entry);
  notifyPreviewSourceLifecycleChange(sessionId);
}

/** Dispose the UI resources for a pool entry without terminating the PTY session. */
export function disposePoolEntry(sessionId: string): void {
  const entry = pool.get(sessionId);
  if (!entry) return;

  if (entry.webglRecoveryTimer !== null) {
    window.clearTimeout(entry.webglRecoveryTimer);
    entry.webglRecoveryTimer = null;
  }
  if (entry.renderIntegrityFrame !== null) {
    window.cancelAnimationFrame(entry.renderIntegrityFrame);
    entry.renderIntegrityFrame = null;
  }
  if (entry.renderIntegrityTimer !== null) {
    window.clearTimeout(entry.renderIntegrityTimer);
    entry.renderIntegrityTimer = null;
  }
  stopParkedBroadcast(entry);
  entry.teardown?.();
  entry.terminal.dispose();
  entry.container.remove();
  pool.delete(sessionId);
  notifyPreviewSourceLifecycleChange(sessionId);
}

/** Fully destroy a pool entry and terminate the PTY session. */
function destroyPoolEntry(sessionId: string): void {
  disposePoolEntry(sessionId);
  invoke("kill_pty_session", { sessionId }).catch((err) => {
    console.warn("[terminal-pool] Failed to kill PTY for session", sessionId, err);
  });
}

function evictCold(): void {
  const sessions = useSessionStore.getState().sessions;

  // First pass: evict oldest parked terminal for a done/completed session
  let coldestId: string | null = null;
  let coldestTime = Number.POSITIVE_INFINITY;

  for (const [id, entry] of pool) {
    const isParked = entry.container.parentNode === ensureOffscreen();
    const isDone = DONE_STATUSES.has(sessions[id]?.status ?? "");
    if (isParked && isDone && entry.lastAccessedAt < coldestTime) {
      coldestTime = entry.lastAccessedAt;
      coldestId = id;
    }
  }

  // Second pass: if no cold terminals, evict oldest warm parked terminal
  if (!coldestId) {
    for (const [id, entry] of pool) {
      const isParked = entry.container.parentNode === ensureOffscreen();
      if (isParked && entry.lastAccessedAt < coldestTime) {
        coldestTime = entry.lastAccessedAt;
        coldestId = id;
      }
    }
  }

  if (coldestId) disposePoolEntry(coldestId);
}

useSessionStore.subscribe((state, prev) => {
  for (const id of Object.keys(prev.sessions)) {
    if (!state.sessions[id]) {
      destroyPoolEntry(id);
    }
  }
});
