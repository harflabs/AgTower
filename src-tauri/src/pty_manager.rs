use base64::Engine;
use parking_lot::{Condvar, Mutex};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::SessionEvent;
use crate::engine::session_store::{SessionStatus, SessionUpdate};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Default ring buffer capacity: 2MB — enough for ~50K lines of terminal output.
const RING_BUFFER_CAPACITY: usize = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// tmux integration (for the "Launch sessions in tmux" setting)
//
// We run our tmux sessions on a dedicated socket (`-L agtower`) and hand a
// bundled config file to tmux via `-f`. The dedicated socket gives us a
// fresh tmux server guaranteed to load our config — if we used the default
// socket and the user already had a tmux server running, our `-f` would be
// a no-op because the server was started earlier with the user's config.
// The config enables mouse support so users can click to select panes,
// scroll-wheel through scrollback, and drag to resize.
//
// The config file is the canonical source at `src-tauri/resources/tmux.conf`
// and ships inside the `.app` bundle at
// `AgTower.app/Contents/Resources/tmux.conf` via `bundle.macOS.files` in
// `tauri.conf.json`. A user who drags AgTower.app into /Applications gets
// the config for free — the file lives inside the bundle itself and we
// never write anything to disk at runtime.
// ---------------------------------------------------------------------------
const TMUX_SOCKET_NAME: &str = "agtower";

static TMUX_CONFIG_PATH: OnceLock<String> = OnceLock::new();
static BUNDLED_BIN_DIR: OnceLock<String> = OnceLock::new();

/// Resolve the directory that ships AgTower's bundled helper CLIs (currently
/// just `agtower-hook`). Same resolution strategy as `init_tmux_config`:
/// production → `Resources/bin/` inside the app bundle; dev → the source
/// tree's `src-tauri/resources/bin/`.
pub(crate) fn init_bundled_bin_dir(app: &AppHandle) {
    BUNDLED_BIN_DIR.get_or_init(|| {
        if let Ok(dir) = app.path().resource_dir() {
            let bin_dir = dir.join("bin");
            if bin_dir.is_dir() {
                return bin_dir.to_string_lossy().into_owned();
            }
        }
        const DEV_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/bin");
        if std::path::Path::new(DEV_PATH).is_dir() {
            return DEV_PATH.to_string();
        }
        eprintln!(
            "[pty] agtower helper bin dir not found at resource_dir/bin or \
             {DEV_PATH}. Hook-driven session state will not work."
        );
        String::new()
    });
}

fn bundled_bin_dir() -> &'static str {
    BUNDLED_BIN_DIR.get().map(String::as_str).unwrap_or("")
}

/// Resolve the path to AgTower's bundled tmux config and cache it in
/// `TMUX_CONFIG_PATH`.
///
/// Called once from the Tauri `setup()` hook before any tmux work happens.
/// Idempotent — subsequent calls are no-ops because `OnceLock::get_or_init`
/// only runs its closure on the first call.
///
/// Resolution order (both paths are "the file on disk" — no writes, no
/// temp-dir extraction):
///   1. **Production**: `resource_dir()/tmux.conf`, i.e.
///      `AgTower.app/Contents/Resources/tmux.conf`. This is where Tauri's
///      `bundle.macOS.files` entry lands the file during `tauri build`.
///   2. **Dev**: `<CARGO_MANIFEST_DIR>/resources/tmux.conf`. `env!` is
///      resolved at compile time, so in a dev build this points at the
///      real source file in the repo. In a shipped binary the baked string
///      points at the original developer's machine and `is_file()` returns
///      false, so the branch is cleanly skipped.
///
/// If neither resolves (should not be reachable in any legitimate build),
/// we log a fatal error and cache an empty string. Subsequent tmux calls
/// will fail loudly with a missing-config error rather than silently
/// running without our overrides.
pub(crate) fn init_tmux_config(app: &AppHandle) {
    TMUX_CONFIG_PATH.get_or_init(|| {
        // 1. Production: inside the bundled .app.
        if let Ok(dir) = app.path().resource_dir() {
            let path = dir.join("tmux.conf");
            if path.is_file() {
                return path.to_string_lossy().into_owned();
            }
        }

        // 2. Dev: inside the source tree. CARGO_MANIFEST_DIR is baked in at
        //    compile time — valid on the dev machine, a dead path on any
        //    shipped binary (so we just fall through on the user's machine).
        const DEV_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/tmux.conf");
        if std::path::Path::new(DEV_PATH).is_file() {
            return DEV_PATH.to_string();
        }

        eprintln!(
            "[pty] FATAL: tmux config not found at resource_dir/tmux.conf or \
             {DEV_PATH}. tmux mode will fail until the bundled resource is \
             restored."
        );
        String::new()
    });
}

/// Return the AgTower tmux config path as a `&'static str`.
///
/// In normal operation the `OnceLock` was populated by `init_tmux_config`
/// during Tauri setup. If something calls us before that ran — an ordering
/// bug we shouldn't be able to introduce — we return an empty string so the
/// downstream tmux command errors out visibly instead of silently losing
/// our overrides.
fn tmux_config_path() -> &'static str {
    TMUX_CONFIG_PATH
        .get()
        .map(String::as_str)
        .unwrap_or_else(|| {
            eprintln!("[pty] tmux_config_path() called before init_tmux_config()");
            ""
        })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PtyLaunchSpec {
    LoginShell,
    Process {
        program: String,
        args: Vec<String>,
        env: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PtyProcessState {
    Running,
    Terminated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PtyAttachmentState {
    Attached,
    Detached,
    Parked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyStateSnapshot {
    pub process_state: PtyProcessState,
    pub attachment_state: PtyAttachmentState,
    /// Current PTY column count. Used by dashboard mini-terminals to size
    /// their preview to match the real PTY so alternate-screen TUIs (notably
    /// Codex) render correctly when replayed.
    pub cols: u16,
    /// Current PTY row count. See `cols`.
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyPreviewBootstrap {
    pub process_state: PtyProcessState,
    pub attachment_state: PtyAttachmentState,
    pub cols: u16,
    pub rows: u16,
    /// Full retained ring-buffer contents as base64. Preview-only consumers
    /// replay this into a hidden xterm to reconstruct the current viewport
    /// without stealing PTY ownership from the live terminal.
    pub snapshot: String,
    /// Monotonic byte offset of the ring buffer snapshot. Broadcast events
    /// beyond this offset are newer than the bootstrap payload.
    pub output_offset: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyOutputBroadcast {
    pub data: String,
    pub end_offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyOwnerLease {
    pub token: String,
    pub generation: u64,
}

// ---------------------------------------------------------------------------
// Flow control — allows the frontend to pause/resume PTY reading
// ---------------------------------------------------------------------------

struct FlowControl {
    paused: Mutex<bool>,
    cond: Condvar,
}

impl FlowControl {
    fn new() -> Self {
        Self {
            paused: Mutex::new(false),
            cond: Condvar::new(),
        }
    }

    /// Block until unpaused. Returns periodically (100ms) so the caller
    /// can detect PTY closure even while paused.
    fn wait_if_paused(&self) {
        let mut guard = self.paused.lock();
        while *guard {
            self.cond
                .wait_for(&mut guard, std::time::Duration::from_millis(100));
        }
    }

    fn pause(&self) {
        *self.paused.lock() = true;
    }

    fn resume(&self) {
        let mut guard = self.paused.lock();
        *guard = false;
        self.cond.notify_one();
    }
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

/// Minimal sniffer for the one-time terminal-setup state a TUI emits at
/// startup — alternate-screen enable, scroll region (DECSTBM), and origin
/// mode. The byte ring evicts these early sequences once a session streams
/// past its 2 MB capacity, so a raw snapshot tail would replay into a terminal
/// left at xterm defaults: the wrong scroll region makes the TUI's
/// bottom-anchored absolute redraws pile onto the last rows. We observe the
/// setup as it streams past — before eviction — and re-emit it as
/// a preamble in the preview bootstrap so the replayed tail lands correctly.
///
/// Only these few short sequences are parsed; all other output (colours,
/// content, cursor moves) is ignored and never mutated.
#[derive(Default)]
struct TermSetup {
    /// Active alternate-screen private mode (1049 / 1047 / 47), `None` on the
    /// main screen.
    alt_screen: Option<u16>,
    /// DECSTBM scroll region as 1-based `(top, bottom)`, `None` for the default
    /// full-screen region.
    scroll_region: Option<(u16, u16)>,
    /// DECOM origin mode.
    origin_mode: bool,
    /// Trailing bytes of a possibly-incomplete escape sequence, carried to the
    /// next chunk so a sequence split across reads is still parsed.
    pending: Vec<u8>,
}

/// Cap on carried partial-sequence bytes; a longer unterminated sequence is
/// dropped rather than buffered unboundedly.
const TERM_SETUP_PENDING_MAX: usize = 64;

fn parse_csi_u16(bytes: &[u8]) -> Option<u16> {
    if bytes.is_empty() {
        return None;
    }
    let mut v: u32 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        v = v.saturating_mul(10).saturating_add((b - b'0') as u32);
        if v > u16::MAX as u32 {
            return Some(u16::MAX);
        }
    }
    Some(v as u16)
}

impl TermSetup {
    /// Observe a freshly-read output chunk, updating the tracked setup state.
    fn observe(&mut self, data: &[u8]) {
        if self.pending.is_empty() {
            self.scan(data);
        } else {
            let mut combined = std::mem::take(&mut self.pending);
            combined.extend_from_slice(data);
            self.scan(&combined);
        }
    }

    fn scan(&mut self, data: &[u8]) {
        let len = data.len();
        let mut i = 0;
        while i < len {
            if data[i] != 0x1b {
                i += 1;
                continue;
            }
            if i + 1 >= len {
                self.carry(&data[i..]);
                return;
            }
            if data[i + 1] != b'[' {
                // ESC c (RIS) resets everything; other escapes aren't setup.
                if data[i + 1] == b'c' {
                    self.alt_screen = None;
                    self.scroll_region = None;
                    self.origin_mode = false;
                }
                i += 2;
                continue;
            }
            // CSI: ESC [ [?] params [intermediates] final(0x40..=0x7e)
            let mut j = i + 2;
            let private = j < len && data[j] == b'?';
            if private {
                j += 1;
            }
            let params_start = j;
            while j < len && (data[j].is_ascii_digit() || data[j] == b';') {
                j += 1;
            }
            let params_end = j;
            while j < len && (0x20..=0x2f).contains(&data[j]) {
                j += 1;
            }
            if j >= len {
                // Unterminated — carry from the ESC so the next chunk completes it.
                self.carry(&data[i..]);
                return;
            }
            let final_byte = data[j];
            if (0x40..=0x7e).contains(&final_byte) {
                self.apply_csi(private, &data[params_start..params_end], final_byte);
            }
            i = j + 1;
        }
    }

    fn apply_csi(&mut self, private: bool, params: &[u8], final_byte: u8) {
        match (private, final_byte) {
            (true, b'h') | (true, b'l') => {
                let set = final_byte == b'h';
                for p in params.split(|&b| b == b';') {
                    match parse_csi_u16(p) {
                        Some(mode @ (1049 | 1047 | 47)) => {
                            self.alt_screen = if set { Some(mode) } else { None };
                        }
                        Some(6) => self.origin_mode = set,
                        _ => {}
                    }
                }
            }
            (false, b'r') => {
                // DECSTBM: `CSI t ; b r`, or `CSI r` (reset to full screen).
                if params.is_empty() {
                    self.scroll_region = None;
                } else {
                    let parts: Vec<&[u8]> = params.split(|&b| b == b';').collect();
                    if parts.len() == 2 {
                        if let (Some(t), Some(b)) =
                            (parse_csi_u16(parts[0]), parse_csi_u16(parts[1]))
                        {
                            self.scroll_region = Some((t, b));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn carry(&mut self, tail: &[u8]) {
        if tail.len() <= TERM_SETUP_PENDING_MAX {
            self.pending = tail.to_vec();
        } else {
            // Too long to be one of our short setup sequences; drop it.
            self.pending.clear();
        }
    }

    /// Re-emit the tracked setup as a self-contained preamble. Order matters:
    /// entering the alt screen clears it (clean canvas for the replayed tail),
    /// then the scroll region and origin mode are re-established.
    fn preamble(&self) -> Vec<u8> {
        let mut p = Vec::new();
        if let Some(mode) = self.alt_screen {
            p.extend_from_slice(format!("\x1b[?{mode}h").as_bytes());
        }
        if let Some((top, bottom)) = self.scroll_region {
            p.extend_from_slice(format!("\x1b[{top};{bottom}r").as_bytes());
        }
        if self.origin_mode {
            p.extend_from_slice(b"\x1b[?6h");
        }
        p
    }
}

struct RingBuffer {
    buf: Vec<u8>,
    write_pos: usize,
    len: usize,
    /// Tracks the TUI's one-time setup so previews can reconstruct it even
    /// after the original sequences scroll out of the ring.
    setup: TermSetup,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: vec![0u8; capacity],
            write_pos: 0,
            len: 0,
            setup: TermSetup::default(),
        }
    }

    /// A self-contained preamble that re-establishes the TUI's setup state
    /// (alt-screen / scroll region / origin) for replay into a fresh terminal.
    ///
    /// Only emitted once the ring has wrapped (`len == capacity`). While the
    /// snapshot still starts at byte 0 it already carries the original setup at
    /// its true position, so a synthetic preamble would just prepend redundant
    /// bytes — and could re-assert a later state ahead of earlier snapshot
    /// bytes. The preamble is only needed once earlier bytes have been evicted.
    fn setup_preamble(&self) -> Vec<u8> {
        if self.len < self.buf.len() {
            return Vec::new();
        }
        self.setup.preamble()
    }

    /// Append data to the ring buffer, overwriting oldest bytes when full.
    fn push_slice(&mut self, data: &[u8]) {
        // Track setup sequences before they can be evicted from the ring.
        self.setup.observe(data);
        let cap = self.buf.len();
        if data.len() >= cap {
            let start = data.len() - cap;
            self.buf.copy_from_slice(&data[start..]);
            self.write_pos = 0;
            self.len = cap;
            return;
        }

        let first_chunk = cap - self.write_pos;
        if data.len() <= first_chunk {
            self.buf[self.write_pos..self.write_pos + data.len()].copy_from_slice(data);
        } else {
            self.buf[self.write_pos..self.write_pos + first_chunk]
                .copy_from_slice(&data[..first_chunk]);
            let remainder = data.len() - first_chunk;
            self.buf[..remainder].copy_from_slice(&data[first_chunk..]);
        }

        self.write_pos = (self.write_pos + data.len()) % cap;
        self.len = (self.len + data.len()).min(cap);
    }

    /// Return all valid bytes in chronological order.
    fn snapshot(&self) -> Vec<u8> {
        if self.len == 0 {
            return Vec::new();
        }
        let cap = self.buf.len();
        if self.len < cap {
            return self.buf[..self.len].to_vec();
        }
        let read_pos = self.write_pos;
        let mut out = Vec::with_capacity(cap);
        out.extend_from_slice(&self.buf[read_pos..]);
        out.extend_from_slice(&self.buf[..read_pos]);
        out
    }
}

// ---------------------------------------------------------------------------
// PTY handle
// ---------------------------------------------------------------------------

/// (exit_code, signal) from a terminated PTY process.
type ExitInfo = Arc<Mutex<Option<(Option<i32>, Option<String>)>>>;

struct PtyHandle {
    /// Separate Mutex for PTY writes — allows writing without holding the main handles lock.
    pty_writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pty_master: Box<dyn MasterPty + Send>,
    ring_buffer: Arc<Mutex<RingBuffer>>,
    dispatch_lock: Arc<Mutex<()>>,
    active_channel: Arc<Mutex<Option<Channel<SessionEvent>>>>,
    active_owner: Arc<Mutex<Option<PtyOwnerLease>>>,
    attachment_state: Arc<Mutex<PtyAttachmentState>>,
    terminated: Arc<AtomicBool>,
    exit_info: ExitInfo,
    flow_control: Arc<FlowControl>,
    /// Current PTY dimensions (cols, rows). Kept in sync with `pty_master.resize()`
    /// so snapshot consumers (mini-terminals) can size their previews to match.
    dimensions: Arc<Mutex<(u16, u16)>>,
    /// Monotonic count of PTY output bytes emitted so far. Used by preview-only
    /// consumers to reconcile bootstrap snapshots with live broadcasts.
    output_offset: Arc<AtomicU64>,
    /// Name of the tmux session wrapping this PTY, when `launch_in_tmux` was
    /// true at creation time. Populated so `kill_session` and `cleanup_all`
    /// can explicitly `tmux kill-session` instead of leaking a detached
    /// tmux session when the PTY client dies. `None` for directly-spawned
    /// sessions.
    tmux_session_name: Option<String>,
    /// Set to `true` when the child process enables xterm focus reporting by
    /// sending `\x1b[?1004h`. Only sessions that opt in should receive
    /// focus-in/out CSI sequences — writing `\x1b[I` / `\x1b[O` to sessions
    /// that haven't requested focus reporting causes the terminal driver to
    /// echo them as visible garbage ("I", "IOOI") during shell init.
    focus_reporting_enabled: Arc<AtomicBool>,
}

const FOCUS_REPORTING_ENABLE: &[u8] = b"\x1b[?1004h";
const FOCUS_REPORTING_DISABLE: &[u8] = b"\x1b[?1004l";
const FOCUS_REPORTING_SEQUENCE_LEN: usize = b"\x1b[?1004h".len();
const FOCUS_REPORTING_TAIL_LEN: usize = FOCUS_REPORTING_SEQUENCE_LEN - 1;
const FOCUS_REPORTING_BRIDGE_LEN: usize = FOCUS_REPORTING_TAIL_LEN * 2;

fn update_focus_reporting_state(
    chunk: &[u8],
    previous_tail: &mut Vec<u8>,
    focus_reporting_enabled: &AtomicBool,
) {
    if chunk.is_empty() {
        return;
    }

    if !previous_tail.is_empty() {
        debug_assert!(previous_tail.len() <= FOCUS_REPORTING_TAIL_LEN);

        let prefix_len = chunk.len().min(FOCUS_REPORTING_TAIL_LEN);
        let mut bridge = [0u8; FOCUS_REPORTING_BRIDGE_LEN];
        bridge[..previous_tail.len()].copy_from_slice(previous_tail);
        bridge[previous_tail.len()..previous_tail.len() + prefix_len]
            .copy_from_slice(&chunk[..prefix_len]);
        apply_focus_reporting_sequences(
            &bridge[..previous_tail.len() + prefix_len],
            focus_reporting_enabled,
        );
    }

    apply_focus_reporting_sequences(chunk, focus_reporting_enabled);

    previous_tail.clear();
    let keep = chunk.len().min(FOCUS_REPORTING_TAIL_LEN);
    previous_tail.extend_from_slice(&chunk[chunk.len() - keep..]);
}

fn apply_focus_reporting_sequences(data: &[u8], focus_reporting_enabled: &AtomicBool) {
    for window in data.windows(FOCUS_REPORTING_SEQUENCE_LEN) {
        if window == FOCUS_REPORTING_ENABLE {
            focus_reporting_enabled.store(true, Ordering::SeqCst);
        } else if window == FOCUS_REPORTING_DISABLE {
            focus_reporting_enabled.store(false, Ordering::SeqCst);
        }
    }
}

fn emit_preview_state(
    app_handle: &AppHandle,
    session_id: &str,
    process_state: PtyProcessState,
    attachment_state: PtyAttachmentState,
    cols: u16,
    rows: u16,
) {
    let _ = app_handle.emit(
        &format!("pty-state-broadcast:{}", session_id),
        &PtyStateSnapshot {
            process_state,
            attachment_state,
            cols,
            rows,
        },
    );
}

/// Strip terminal response echoes from PTY output during the startup grace period.
///
/// The PTY's `echoctl` flag converts control chars to caret notation (`^X`).
/// When xterm.js writes terminal responses (DA, focus, cursor reports) back
/// to the PTY, the echo appears as visible `^[[...` text. These arrive late
/// (IPC round-trip), so we filter inline during a grace period.
///
/// Handles:
/// - Caret-notation CSI (`^[[...X`): ALL final bytes — these are always echoes
/// - Caret-notation ESC+letter (`^[O`, etc.): SS3 and other echo artifacts
/// - Raw ESC responses (`\x1b[...c`, `\x1b[I`, `\x1b[O`, `\x1b[R`): known response types only
/// - Does NOT strip incomplete raw ESC (could be split program output at chunk boundary)
fn strip_startup_noise(data: &[u8], out: &mut Vec<u8>) {
    let mut i = 0;
    while i < data.len() {
        // ── Raw ESC: only strip known terminal response types ──
        // We must NOT strip incomplete raw ESC sequences — they could be
        // legitimate program output (e.g. SGR color) split at a chunk boundary.
        if data[i] == 0x1b && i + 1 < data.len() && data[i + 1] == b'[' {
            let mut j = i + 2;
            while j < data.len() && (0x30..=0x3f).contains(&data[j]) {
                j += 1;
            }
            while j < data.len() && (0x20..=0x2f).contains(&data[j]) {
                j += 1;
            }
            // c=DA, I=FocusIn, O=FocusOut, R=CursorPositionReport, y=DECRPM
            if j < data.len() && matches!(data[j], b'c' | b'I' | b'O' | b'R' | b'y') {
                i = j + 1;
                continue;
            }
            // Not a known response (or incomplete) — keep it for xterm.js to parse
            out.push(data[i]);
            i += 1;
            continue;
        }

        // ── Caret-notation CSI: ^[[...X ──
        // echoctl renders ESC as ^[ (literal ^ + [), so echoed CSI becomes ^[[...
        // ALL ^[[ sequences during startup are echoed responses — programs never
        // output literal ^[[ text during their first 8KB of output.
        if data[i] == b'^' && i + 2 < data.len() && data[i + 1] == b'[' && data[i + 2] == b'[' {
            let mut j = i + 3;
            // Parameter bytes: ?, >, digits, semicolons
            while j < data.len()
                && (data[j] == b'?'
                    || data[j] == b'>'
                    || data[j].is_ascii_digit()
                    || data[j] == b';')
            {
                j += 1;
            }
            // Final byte (0x40-0x7E, excluding ^ which starts the next ^[ prefix)
            if j < data.len() && (0x40..=0x7e).contains(&data[j]) && data[j] != b'^' {
                i = j + 1;
                continue;
            }
            // Incomplete caret CSI — skip what we have
            i = j;
            continue;
        }

        // ── Caret-notation ESC+letter: ^[X (e.g. ^[O = SS3 echo) ──
        if data[i] == b'^'
            && i + 2 < data.len()
            && data[i + 1] == b'['
            && data[i + 2].is_ascii_alphabetic()
        {
            i += 3;
            continue;
        }

        // ── Trailing ^[ at end of buffer ──
        if data[i] == b'^' && i + 1 < data.len() && data[i + 1] == b'[' && i + 2 >= data.len() {
            i += 2;
            continue;
        }

        out.push(data[i]);
        i += 1;
    }
}

/// POSIX shell-escape a single argument so it survives `sh -c` intact.
///
/// Used to build the command string we hand to `tmux new-session`, which
/// passes its positional argument through `sh -c`. Tokens that contain only
/// safe characters are returned unchanged; everything else is wrapped in
/// single quotes with embedded single quotes escaped as `'\''`.
fn shell_escape(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '/' | '.' | ':' | '='))
    {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Strip ANSI escape sequences from text for display purposes.
fn strip_ansi(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&c) = chars.peek() {
                    chars.next();
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                chars.next();
                while let Some(&c) = chars.peek() {
                    chars.next();
                    if c == '\x07' || c == '\\' {
                        break;
                    }
                }
            }
        } else if ch == '\r' || ch == '\n' {
            result.push('\n');
        } else if !ch.is_control() {
            result.push(ch);
        }
    }
    result
}

fn append_recent_text(window: &mut String, chunk: &str, max_chars: usize) {
    window.push_str(chunk);
    let len = window.chars().count();
    if len <= max_chars {
        return;
    }

    let trim_chars = len - max_chars;
    let trim_bytes = window
        .char_indices()
        .nth(trim_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    window.drain(..trim_bytes);
}

/// Minimal PTY byte scanner that detects raw `\x07` BEL bytes outside any OSC
/// sequence. Codex's TUI emits BEL on attention events, which serves as a
/// fallback when the `agtower-hook` push channel does not fire. Everything
/// else (OSC 9, OSC 9;4, OSC 777, OSC 0) is ignored.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum BellScanState {
    #[default]
    Normal,
    SawEsc,
    InOsc,
    InOscSawEsc,
}

#[derive(Debug, Default)]
struct BellScanner {
    state: BellScanState,
}

impl BellScanner {
    /// Returns true iff `data` contained a BEL that wasn't swallowed by an OSC
    /// sequence. Preserves cross-chunk OSC state so bells emitted around
    /// partial OSC sequences register correctly.
    fn feed(&mut self, data: &[u8]) -> bool {
        let mut saw_bell = false;
        for &byte in data {
            match self.state {
                BellScanState::Normal => match byte {
                    0x1b => self.state = BellScanState::SawEsc,
                    0x07 => saw_bell = true,
                    _ => {}
                },
                BellScanState::SawEsc => match byte {
                    b']' => self.state = BellScanState::InOsc,
                    0x1b => {}
                    0x07 => {
                        saw_bell = true;
                        self.state = BellScanState::Normal;
                    }
                    _ => self.state = BellScanState::Normal,
                },
                BellScanState::InOsc => match byte {
                    0x07 => self.state = BellScanState::Normal,
                    0x1b => self.state = BellScanState::InOscSawEsc,
                    _ => {}
                },
                BellScanState::InOscSawEsc => match byte {
                    b'\\' | 0x07 => self.state = BellScanState::Normal,
                    0x1b => {}
                    _ => self.state = BellScanState::InOsc,
                },
            }
        }
        saw_bell
    }
}

fn normalize_attention_text(text: &str) -> String {
    text.to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn squash_attention_text(text: &str) -> String {
    text.to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

fn attention_text_contains(normalized: &str, squashed: &str, phrase: &str) -> bool {
    let phrase_normalized = normalize_attention_text(phrase);
    let phrase_squashed = squash_attention_text(phrase);
    normalized.contains(&phrase_normalized) || squashed.contains(&phrase_squashed)
}

fn attention_line_starts_with(normalized_line: &str, squashed_line: &str, phrase: &str) -> bool {
    let phrase_normalized = normalize_attention_text(phrase);
    let phrase_squashed = squash_attention_text(phrase);
    normalized_line.starts_with(&phrase_normalized) || squashed_line.starts_with(&phrase_squashed)
}

fn is_numbered_choice_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    let trimmed = trimmed
        .strip_prefix('>')
        .map(str::trim_start)
        .unwrap_or(trimmed);

    let bytes = trimmed.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }

    if idx == 0 || idx >= bytes.len() || !matches!(bytes[idx], b'.' | b')') {
        return false;
    }

    bytes[idx + 1..]
        .iter()
        .any(|byte| byte.is_ascii_alphanumeric())
}

fn has_generic_confirmation_prompt(normalized_lines: &[String], squashed_lines: &[String]) -> bool {
    normalized_lines
        .iter()
        .zip(squashed_lines.iter())
        .any(|(line, squashed_line)| {
            line.contains('?')
                && [
                    "do you want",
                    "would you like",
                    "should i",
                    "shall i",
                    "can i",
                    "could i",
                    "may i",
                ]
                .iter()
                .any(|phrase| attention_line_starts_with(line, squashed_line, phrase))
        })
}

fn has_generic_choice_prompt(normalized_lines: &[String], squashed_lines: &[String]) -> bool {
    normalized_lines
        .iter()
        .zip(squashed_lines.iter())
        .any(|(line, squashed_line)| {
            line.contains('?')
                && [
                    "what would you like",
                    "which option",
                    "which one",
                    "please choose",
                    "choose one",
                    "choose an option",
                    "select an option",
                    "how would you like",
                ]
                .iter()
                .any(|phrase| attention_line_starts_with(line, squashed_line, phrase))
        })
}

fn detect_claude_attention_prompt(recent_text: &str) -> Option<&'static str> {
    let normalized = normalize_attention_text(recent_text);
    let squashed = squash_attention_text(recent_text);
    let normalized_lines = recent_text
        .lines()
        .map(normalize_attention_text)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let squashed_lines = recent_text
        .lines()
        .map(squash_attention_text)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    let choice_count = normalized_lines
        .iter()
        .filter(|line| is_numbered_choice_line(line))
        .count();
    let has_cancel_hint = attention_text_contains(&normalized, &squashed, "esc to cancel");
    let has_selection_hint = [
        "enter to select",
        "enter to confirm",
        "enter to submit",
        "submit answers",
    ]
    .iter()
    .any(|phrase| attention_text_contains(&normalized, &squashed, phrase));
    let has_choice_prompt = has_generic_choice_prompt(&normalized_lines, &squashed_lines);
    let has_confirmation_prompt =
        has_generic_confirmation_prompt(&normalized_lines, &squashed_lines);
    let has_question_line = normalized_lines.iter().any(|line| line.contains('?'));

    if attention_text_contains(&normalized, &squashed, "waiting for leader to approve") {
        return Some("worker request");
    }

    if choice_count >= 2 && has_selection_hint {
        return Some("input needed");
    }

    if choice_count >= 2
        && (has_confirmation_prompt || has_choice_prompt || (has_question_line && has_cancel_hint))
    {
        if has_confirmation_prompt {
            return Some("confirmation");
        }

        return Some("user response");
    }

    None
}

/// Dispatcher for text-based attention prompts (Claude only).
///
/// Claude uses text scraping (numbered menus, confirmation prompts) because
/// its approval UX is rendered as prose. Codex signals attention via `\x07`
/// (the TUI's notification bell, caught by `maybe_mark_attention_bell`)
/// instead of relying on hard-coded English overlay titles.
fn maybe_mark_needs_attention(app_handle: &AppHandle, session_id: &str, recent_text: &str) {
    let Some(engine) = app_handle.try_state::<Arc<crate::engine::Engine>>() else {
        return;
    };
    let Some(session) = engine.sessions.get(session_id) else {
        return;
    };

    let waiting_for = match session.provider.as_str() {
        "claude-code" => detect_claude_attention_prompt(recent_text),
        _ => None,
    };

    let Some(waiting_for) = waiting_for else {
        return;
    };

    mark_needs_attention(app_handle, session_id, waiting_for, true);
}

/// Dispatcher for PTY bell-based attention signals. Provider-agnostic — the
/// downstream `mark_needs_attention` enforces the provider guard.
fn maybe_mark_attention_bell(app_handle: &AppHandle, session_id: &str) {
    mark_needs_attention(app_handle, session_id, "terminal bell", false);
}

/// Core NeedsAttention transition — shared between Claude and Codex PTY paths.
///
/// The provider guard at the top accepts both `"claude-code"` and `"codex"`.
/// All other providers are a no-op. The status gate keeps the existing
/// Running/Idle/NeedsAttention allow-list so we never resurrect Closed sessions.
fn mark_needs_attention(
    app_handle: &AppHandle,
    session_id: &str,
    waiting_for: &str,
    overwrite_existing_reason: bool,
) {
    let Some(engine) = app_handle.try_state::<Arc<crate::engine::Engine>>() else {
        return;
    };
    let Some(session) = engine.sessions.get(session_id) else {
        return;
    };

    if !matches!(session.provider.as_str(), "claude-code" | "codex")
        || !matches!(
            session.status,
            SessionStatus::Running | SessionStatus::Idle | SessionStatus::NeedsAttention
        )
    {
        return;
    }

    let existing_waiting_for = session
        .live_provider_data
        .get("waitingFor")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty());

    if session.status == SessionStatus::NeedsAttention
        && existing_waiting_for.is_some()
        && !overwrite_existing_reason
    {
        return;
    }

    let _ = engine.sessions.update(
        session_id,
        SessionUpdate {
            status: if session.status == SessionStatus::NeedsAttention {
                None
            } else {
                Some(SessionStatus::NeedsAttention)
            },
            live_provider_data: Some(serde_json::json!({
                "waitingFor": waiting_for,
            })),
            ..Default::default()
        },
    );
}

// ---------------------------------------------------------------------------
// PTY manager
// ---------------------------------------------------------------------------

pub(crate) struct PtyManager {
    handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
    owner_claims: Arc<Mutex<HashMap<String, PtyOwnerLease>>>,
    owner_generations: Arc<Mutex<HashMap<String, u64>>>,
}

impl PtyManager {
    pub(crate) fn new() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            owner_claims: Arc::new(Mutex::new(HashMap::new())),
            owner_generations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn current_owner_matches(
        &self,
        session_id: &str,
        owner_token: &str,
        owner_generation: u64,
    ) -> bool {
        self.owner_claims
            .lock()
            .get(session_id)
            .map(|lease| lease.token == owner_token && lease.generation == owner_generation)
            .unwrap_or(false)
    }

    pub(crate) fn claim_owner(&self, session_id: &str, owner_token: &str) -> PtyOwnerLease {
        let generation = {
            let mut generations = self.owner_generations.lock();
            let entry = generations.entry(session_id.to_string()).or_insert(0);
            *entry += 1;
            *entry
        };

        let lease = PtyOwnerLease {
            token: owner_token.to_string(),
            generation,
        };
        self.owner_claims
            .lock()
            .insert(session_id.to_string(), lease.clone());
        lease
    }

    /// Create a new PTY session, spawn the given command, and start streaming
    /// output to the provided channel.
    ///
    /// `launch_in_tmux`, when true, wraps the resolved provider command in
    /// `tmux new-session -s agtower-<session-id> <shell-escaped command>`.
    /// The user is expected to have tmux installed themselves; we do not
    /// bundle it. This is the entry point for Claude Code's experimental
    /// agent-teams display mode — once inside tmux, Claude Code's native
    /// tmux integration can spawn teammates as real tmux panes.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn create_session(
        &self,
        session_id: &str,
        repo_path: &str,
        launch: &PtyLaunchSpec,
        owner_token: &str,
        owner_generation: u64,
        cols: u16,
        rows: u16,
        on_event: Channel<SessionEvent>,
        app_handle: AppHandle,
        launch_in_tmux: bool,
    ) -> Result<(), String> {
        if !self.current_owner_matches(session_id, owner_token, owner_generation) {
            return Err(format!("Session {} has a stale PTY owner", session_id));
        }

        self.handles.lock().remove(session_id);

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            // Try to detect the user's default shell from /etc/passwd before
            // falling back to /bin/sh (the only POSIX-guaranteed shell).
            std::process::Command::new("getent")
                .args(["passwd", &std::env::var("USER").unwrap_or_default()])
                .output()
                .ok()
                .and_then(|out| {
                    let line = String::from_utf8_lossy(&out.stdout);
                    line.trim().rsplit(':').next().map(|s| s.to_string())
                })
                .filter(|s| !s.is_empty() && std::path::Path::new(s).exists())
                .unwrap_or_else(|| "/bin/sh".to_string())
        });

        // Resolve the concrete (program, args) the user asked for first. When
        // tmux wrapping is enabled we keep this resolved form and pass it as
        // tmux's shell-command argument; otherwise we spawn it directly.
        let (resolved_program, resolved_args, configured_env): (
            String,
            Vec<String>,
            HashMap<String, String>,
        ) = match launch {
            PtyLaunchSpec::LoginShell => (shell.clone(), vec!["-l".to_string()], HashMap::new()),
            PtyLaunchSpec::Process { program, args, env } => {
                // For "codex", resolve to the native Rust binary to bypass the
                // Node.js wrapper (which adds input lag from extra stdio piping
                // and triggers auto-updates via CODEX_MANAGED_BY_NPM).
                let resolved = if program == "codex" {
                    resolve_codex_native_binary().unwrap_or_else(|| program.to_string())
                } else {
                    program.to_string()
                };
                (resolved, args.clone(), env.clone().unwrap_or_default())
            }
        };

        // Tracks the tmux session we spawned (if any) so kill_session can
        // explicitly tear it down later. `None` for directly-launched sessions.
        let tmux_session_name: Option<String> = if launch_in_tmux {
            Some(format!("agtower-{}", session_id))
        } else {
            None
        };

        // Compose the AgTower-specific env vars used by provider hooks to push
        // state back into the engine. These get injected into the spawned
        // process (and forwarded through tmux via `-e` below).
        let mut agtower_env: Vec<(String, String)> = Vec::new();
        agtower_env.push(("AGTOWER_SESSION_ID".to_string(), session_id.to_string()));
        if let Some(socket_path) = app_handle
            .try_state::<crate::ControlSocketPath>()
            .map(|state| state.0.clone())
        {
            agtower_env.push((
                "AGTOWER_SOCKET_PATH".to_string(),
                socket_path.to_string_lossy().into_owned(),
            ));
        }
        let bin_dir = bundled_bin_dir();
        if !bin_dir.is_empty() {
            let current_path = configured_env
                .get("PATH")
                .cloned()
                .or_else(|| std::env::var("PATH").ok())
                .unwrap_or_default();
            let new_path = if current_path.is_empty() {
                bin_dir.to_string()
            } else {
                format!("{bin_dir}:{current_path}")
            };
            agtower_env.push(("PATH".to_string(), new_path));
        }

        let mut cmd = if let Some(ref name) = tmux_session_name {
            // Build: tmux -L agtower -f <config> new-session -s agtower-<id> <escaped command>
            //
            // - `-L agtower` uses a dedicated socket so we get a fresh server
            //   that loads our config (mouse on, true colour) regardless of
            //   whether the user already has their own tmux running.
            // - `-f <config>` points at the auto-generated config that also
            //   sources `~/.tmux.conf` so the user's own settings still apply.
            // - tmux's [shell-command] positional is passed through `sh -c`,
            //   so we shell-escape each token and join with spaces. That
            //   gives argv-level precision through the shell layer.
            let joined = std::iter::once(resolved_program.as_str())
                .chain(resolved_args.iter().map(String::as_str))
                .map(shell_escape)
                .collect::<Vec<_>>()
                .join(" ");
            let config = tmux_config_path();
            let mut env_entries = configured_env.iter().collect::<Vec<_>>();
            env_entries.sort_by(|a, b| a.0.cmp(b.0));
            let mut tmux_args = vec![
                "-L".to_string(),
                TMUX_SOCKET_NAME.to_string(),
                "-f".to_string(),
                config.to_string(),
                "new-session".to_string(),
            ];
            for (key, value) in env_entries {
                tmux_args.push("-e".to_string());
                tmux_args.push(format!("{key}={value}"));
            }
            for (key, value) in &agtower_env {
                tmux_args.push("-e".to_string());
                tmux_args.push(format!("{key}={value}"));
            }
            tmux_args.extend(["-s".to_string(), name.to_string(), joined]);
            let mut cmd = CommandBuilder::new("tmux");
            cmd.args(&tmux_args);
            cmd
        } else {
            let mut cmd = CommandBuilder::new(&resolved_program);
            cmd.args(&resolved_args);
            cmd
        };
        cmd.cwd(repo_path);
        if !launch_in_tmux {
            for (key, value) in &configured_env {
                cmd.env(key, value);
            }
            for (key, value) in &agtower_env {
                cmd.env(key, value);
            }
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Advertise as a terminal that supports the kitty keyboard protocol.
        // Claude Code checks TERM_PROGRAM against an allow-list
        // ["iTerm.app", "kitty", "WezTerm", "ghostty"] to decide whether
        // to enable its CSI-u parser. Without this, Shift+Enter (sent as
        // ESC[13;2u by our xterm.js handler) is silently ignored.
        cmd.env("TERM_PROGRAM", "ghostty");
        // Prevent Codex CLI from auto-updating on exit (adds 5s+ delay)
        cmd.env_remove("CODEX_MANAGED_BY_NPM");
        cmd.env_remove("CODEX_MANAGED_BY_BUN");
        if std::env::var("LANG").is_err() && !configured_env.contains_key("LANG") {
            cmd.env("LANG", "en_US.UTF-8");
        }
        if std::env::var("LC_CTYPE").is_err() && !configured_env.contains_key("LC_CTYPE") {
            cmd.env("LC_CTYPE", "UTF-8");
        }

        let mut child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        if let Some(engine) = app_handle.try_state::<Arc<crate::engine::Engine>>() {
            if let Some(pid) = child.process_id() {
                let _ = engine.sessions.update(
                    session_id,
                    SessionUpdate {
                        pid: Some(Some(pid as i64)),
                        pty_active: Some(true),
                        ..Default::default()
                    },
                );
            } else {
                let _ = engine.sessions.update(
                    session_id,
                    SessionUpdate {
                        pty_active: Some(true),
                        ..Default::default()
                    },
                );
            }
        }

        if !self.current_owner_matches(session_id, owner_token, owner_generation) {
            let _ = child.kill();
            return Err(format!("Session {} has a stale PTY owner", session_id));
        }

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        if !self.current_owner_matches(session_id, owner_token, owner_generation) {
            let _ = child.kill();
            return Err(format!("Session {} has a stale PTY owner", session_id));
        }

        let ring_buffer = Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY)));
        let active_channel: Arc<Mutex<Option<Channel<SessionEvent>>>> =
            Arc::new(Mutex::new(Some(on_event)));
        let terminated = Arc::new(AtomicBool::new(false));
        let exit_info: ExitInfo = Arc::new(Mutex::new(None));
        let flow_control = Arc::new(FlowControl::new());
        let attachment_state = Arc::new(Mutex::new(PtyAttachmentState::Attached));
        let dispatch_lock = Arc::new(Mutex::new(()));
        let dimensions = Arc::new(Mutex::new((cols, rows)));
        let output_offset = Arc::new(AtomicU64::new(0));
        let focus_reporting_enabled = Arc::new(AtomicBool::new(false));
        let active_owner = Arc::new(Mutex::new(Some(PtyOwnerLease {
            token: owner_token.to_string(),
            generation: owner_generation,
        })));

        {
            let claims = self.owner_claims.lock();
            let Some(current_owner) = claims.get(session_id) else {
                let _ = child.kill();
                return Err(format!("Session {} has a stale PTY owner", session_id));
            };
            if current_owner.token != owner_token || current_owner.generation != owner_generation {
                let _ = child.kill();
                return Err(format!("Session {} has a stale PTY owner", session_id));
            }

            self.handles.lock().insert(
                session_id.to_string(),
                PtyHandle {
                    pty_writer: Arc::new(Mutex::new(writer)),
                    pty_master: pty_pair.master,
                    ring_buffer: Arc::clone(&ring_buffer),
                    dispatch_lock: Arc::clone(&dispatch_lock),
                    active_channel: Arc::clone(&active_channel),
                    active_owner: Arc::clone(&active_owner),
                    attachment_state: Arc::clone(&attachment_state),
                    terminated: Arc::clone(&terminated),
                    exit_info: Arc::clone(&exit_info),
                    flow_control: Arc::clone(&flow_control),
                    dimensions: Arc::clone(&dimensions),
                    output_offset: Arc::clone(&output_offset),
                    tmux_session_name: tmux_session_name.clone(),
                    focus_reporting_enabled: Arc::clone(&focus_reporting_enabled),
                },
            );
        }

        // Clone for event emission in reader thread
        let session_id_owned = session_id.to_string();
        let terminated_for_panic = Arc::clone(&terminated);
        let exit_info_for_panic = Arc::clone(&exit_info);
        let active_channel_for_panic = Arc::clone(&active_channel);
        let active_owner_for_panic = Arc::clone(&active_owner);
        let attachment_state_for_panic = Arc::clone(&attachment_state);
        let dimensions_for_panic = Arc::clone(&dimensions);
        let dispatch_lock_for_reader = Arc::clone(&dispatch_lock);
        let flow_control_for_reader = Arc::clone(&flow_control);
        let output_offset_for_reader = Arc::clone(&output_offset);
        let focus_reporting_for_reader = Arc::clone(&focus_reporting_enabled);

        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut child = child;
                let mut buf = [0u8; 16384];
                let mut recent_cleaned = String::new();
                let mut bell_scanner = BellScanner::default();
                let mut focus_reporting_tail = Vec::with_capacity(FOCUS_REPORTING_TAIL_LEN);
                let mut startup_bytes_seen: usize = 0;
                const STARTUP_GRACE_BYTES: usize = 8192; // Filter DA noise in first 8KB

                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => {
                            let (exit_code, signal) = child
                                .wait()
                                .ok()
                                .map(|status| {
                                    let code = Some(status.exit_code() as i32);
                                    let signal = status
                                        .to_string()
                                        .strip_prefix("Terminated by ")
                                        .map(|s| s.to_string());
                                    (code, signal)
                                })
                                .unwrap_or((None, None));

                            terminated.store(true, Ordering::SeqCst);
                            if let Some(engine) =
                                app_handle.try_state::<Arc<crate::engine::Engine>>()
                            {
                                let mut updates = SessionUpdate {
                                    pty_active: Some(false),
                                    ..Default::default()
                                };

                                // For Codex, PTY EOF is the authoritative Closed
                                // signal: no PID file, and its `notify` hook
                                // only fires on turn-complete. We mark Closed
                                // directly here. Claude's `SessionEnd` hook
                                // covers its own close path.
                                let is_codex_active = engine
                                    .sessions
                                    .get(&session_id_owned)
                                    .map(|s| s.provider == "codex" && s.status.is_active())
                                    .unwrap_or(false);

                                if is_codex_active {
                                    updates.status = Some(SessionStatus::Closed);
                                    updates.ended_at = Some(Some(crate::engine::epoch_ms()));
                                    updates.exit_code = Some(exit_code.map(|c| c as i64));
                                    let has_error =
                                        matches!(exit_code, Some(c) if c != 0) || signal.is_some();
                                    if has_error {
                                        updates.stop_reason = Some(Some("error".to_string()));
                                        updates.error =
                                            Some(Some(signal.clone().unwrap_or_else(|| {
                                                format!("exit code {}", exit_code.unwrap_or(-1))
                                            })));
                                    }
                                }

                                let _ = engine.sessions.update(&session_id_owned, updates);
                            }
                            let _dispatch_guard = dispatch_lock_for_reader.lock();
                            let ch_guard = active_channel.lock();
                            *exit_info.lock() = Some((exit_code, signal.clone()));
                            *attachment_state.lock() = PtyAttachmentState::Detached;
                            *active_owner.lock() = None;
                            let (cols, rows) = *dimensions.lock();
                            emit_preview_state(
                                &app_handle,
                                &session_id_owned,
                                PtyProcessState::Terminated,
                                PtyAttachmentState::Detached,
                                cols,
                                rows,
                            );
                            if let Some(ch) = ch_guard.as_ref() {
                                let _ = ch.send(SessionEvent::Terminated {
                                    code: exit_code,
                                    signal,
                                });
                            }
                            drop(ch_guard);
                            *active_channel.lock() = None;
                            break;
                        }
                        Ok(n) => {
                            // Detect xterm focus reporting mode (DECSET/DECRST 1004).
                            // Only sessions that enable this should receive focus CSI.
                            update_focus_reporting_state(
                                &buf[..n],
                                &mut focus_reporting_tail,
                                &focus_reporting_for_reader,
                            );

                            // During startup grace period, strip DA noise inline.
                            // After STARTUP_GRACE_BYTES, pass data through directly (zero cost).
                            let mut filtered_buf: Vec<u8> = Vec::new();
                            let data: &[u8] = if startup_bytes_seen < STARTUP_GRACE_BYTES {
                                startup_bytes_seen += n;
                                strip_startup_noise(&buf[..n], &mut filtered_buf);
                                if filtered_buf.is_empty() {
                                    continue; // Entire chunk was DA noise
                                }
                                &filtered_buf
                            } else {
                                &buf[..n]
                            };

                            let encoded = B64.encode(data);
                            let end_offset;
                            {
                                let _dispatch_guard = dispatch_lock_for_reader.lock();
                                ring_buffer.lock().push_slice(data);
                                end_offset = output_offset_for_reader
                                    .fetch_add(data.len() as u64, Ordering::SeqCst)
                                    + data.len() as u64;

                                // Send to the active channel (full terminal) immediately.
                                // Delaying flush until a subsequent read can strand the tail
                                // of interactive redraws, which shows up as "nothing renders
                                // until I press another key".
                                let ch_guard = active_channel.lock();
                                if let Some(ch) = ch_guard.as_ref() {
                                    let _ = ch.send(SessionEvent::PtyOutput {
                                        data: encoded.clone(),
                                    });
                                }
                            }

                            // Broadcast for dashboard mini-terminals. Tauri still serializes the
                            // payload here even when no preview is listening (it only skips the
                            // webview dispatch), so this is one serde pass per chunk on this
                            // background reader thread. Kept outside dispatch_lock to keep
                            // attach/replay contention low.
                            let _ = app_handle.emit(
                                &format!("pty-output-broadcast:{}", session_id_owned),
                                &PtyOutputBroadcast {
                                    data: encoded,
                                    end_offset,
                                },
                            );

                            // Provider hooks (see `agtower-hook` + launchers) are
                            // the primary source of session state. A raw BEL
                            // outside any OSC is kept as a fallback: Codex's TUI
                            // bells on attention, so we still react if the hook
                            // path ever fails to fire.
                            if bell_scanner.feed(data) {
                                maybe_mark_attention_bell(&app_handle, &session_id_owned);
                            }

                            // Best-effort attention heuristic. Decoding per-chunk means a UTF-8
                            // codepoint or ANSI escape split across a read() boundary can briefly
                            // garble this rolling window — but it re-matches across the many frames
                            // a TUI redraws, and the agtower-hook control socket is the authoritative
                            // NeedsAttention signal, so a missed scrape never loses an attention event.
                            let text = String::from_utf8_lossy(data);
                            let cleaned = strip_ansi(&text);
                            append_recent_text(&mut recent_cleaned, &cleaned, 4096);
                            maybe_mark_needs_attention(
                                &app_handle,
                                &session_id_owned,
                                &recent_cleaned,
                            );

                            // Flow control: block if the frontend write queue is saturated.
                            // Placed after flush so EOF detection in read() is never blocked.
                            flow_control_for_reader.wait_if_paused();
                        }
                    }
                }
            }));

            if result.is_err() {
                eprintln!("[pty] Reader thread panicked — marking session as terminated");
                terminated_for_panic.store(true, Ordering::SeqCst);
                *exit_info_for_panic.lock() = Some((Some(1), None));
                *attachment_state_for_panic.lock() = PtyAttachmentState::Detached;
                *active_owner_for_panic.lock() = None;

                // Mirror the clean-EOF path's engine update. The Terminated event
                // below only reaches a mounted session (one with an active channel);
                // a parked/unmounted session would otherwise keep a stale active
                // badge with a dead PTY until the next restart. Reconcile it here.
                if let Some(engine) = app_handle.try_state::<Arc<crate::engine::Engine>>() {
                    let mut updates = SessionUpdate {
                        pty_active: Some(false),
                        ..Default::default()
                    };
                    let is_codex_active = engine
                        .sessions
                        .get(&session_id_owned)
                        .map(|s| s.provider == "codex" && s.status.is_active())
                        .unwrap_or(false);
                    if is_codex_active {
                        updates.status = Some(SessionStatus::Closed);
                        updates.ended_at = Some(Some(crate::engine::epoch_ms()));
                        updates.exit_code = Some(Some(1));
                        updates.stop_reason = Some(Some("error".to_string()));
                        updates.error = Some(Some("reader thread panicked".to_string()));
                    }
                    let _ = engine.sessions.update(&session_id_owned, updates);
                }

                let (cols, rows) = *dimensions_for_panic.lock();
                emit_preview_state(
                    &app_handle,
                    &session_id_owned,
                    PtyProcessState::Terminated,
                    PtyAttachmentState::Detached,
                    cols,
                    rows,
                );
                let ch_guard = active_channel_for_panic.lock();
                if let Some(ch) = ch_guard.as_ref() {
                    let _ = ch.send(SessionEvent::Terminated {
                        code: Some(1),
                        signal: None,
                    });
                }
                drop(ch_guard);
                *active_channel_for_panic.lock() = None;
            }
        });

        Ok(())
    }

    /// Pause PTY reading for a session (frontend backpressure).
    pub(crate) fn pause_reading(&self, session_id: &str) -> Result<(), String> {
        let handles = self.handles.lock();
        let handle = handles
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        handle.flow_control.pause();
        Ok(())
    }

    /// Resume PTY reading for a session.
    pub(crate) fn resume_reading(&self, session_id: &str) -> Result<(), String> {
        let handles = self.handles.lock();
        let handle = handles
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        handle.flow_control.resume();
        Ok(())
    }

    /// Reattach to an existing session.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn attach_session(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
        on_event: Channel<SessionEvent>,
        owner_token: &str,
        owner_generation: u64,
        replay_snapshot: bool,
    ) -> Result<(), String> {
        if !self.current_owner_matches(session_id, owner_token, owner_generation) {
            return Err(format!("Session {} has a stale PTY owner", session_id));
        }

        let lease = PtyOwnerLease {
            token: owner_token.to_string(),
            generation: owner_generation,
        };

        let (
            active_channel,
            active_owner,
            ring_buffer,
            terminated,
            exit_info,
            attachment_state,
            dispatch_lock,
        ) = {
            let handles = self.handles.lock();
            let handle = handles
                .get(session_id)
                .ok_or_else(|| format!("Session {} not found", session_id))?;

            if handle.terminated.load(Ordering::SeqCst) {
                return Err(format!("Session {} has already terminated", session_id));
            }

            let _ = handle.pty_master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
            *handle.dimensions.lock() = (cols, rows);

            // Reset flow control — new frontend starts with clean state
            handle.flow_control.resume();

            (
                Arc::clone(&handle.active_channel),
                Arc::clone(&handle.active_owner),
                Arc::clone(&handle.ring_buffer),
                Arc::clone(&handle.terminated),
                Arc::clone(&handle.exit_info),
                Arc::clone(&handle.attachment_state),
                Arc::clone(&handle.dispatch_lock),
            )
        };

        let _dispatch_guard = dispatch_lock.lock();

        if !self.current_owner_matches(session_id, owner_token, owner_generation) {
            return Err(format!("Session {} has a stale PTY owner", session_id));
        }

        if replay_snapshot {
            let snapshot = ring_buffer.lock().snapshot();
            if !snapshot.is_empty() {
                let chunk_size = 16384;
                for chunk in snapshot.chunks(chunk_size) {
                    let encoded = B64.encode(chunk);
                    let _ = on_event.send(SessionEvent::PtyOutput { data: encoded });
                }
            }
        }

        if terminated.load(Ordering::SeqCst) {
            let info = exit_info.lock();
            let (code, signal) = info.clone().unwrap_or((Some(0), None));
            let _ = on_event.send(SessionEvent::Terminated { code, signal });
            return Err(format!("Session {} has already terminated", session_id));
        }

        let mut ch_guard = active_channel.lock();
        *ch_guard = Some(on_event);
        *active_owner.lock() = Some(lease);
        *attachment_state.lock() = PtyAttachmentState::Attached;

        Ok(())
    }

    pub(crate) fn park_session(
        &self,
        session_id: &str,
        owner_token: Option<&str>,
        owner_generation: Option<u64>,
    ) -> Result<(), String> {
        let requested_owner = owner_token
            .zip(owner_generation)
            .map(|(token, generation)| PtyOwnerLease {
                token: token.to_string(),
                generation,
            });

        if let Some(owner) = requested_owner.as_ref() {
            let mut claims = self.owner_claims.lock();
            if matches!(claims.get(session_id), Some(current) if current == owner) {
                claims.remove(session_id);
            }
        } else {
            self.owner_claims.lock().remove(session_id);
        }

        let handles = self.handles.lock();
        if let Some(handle) = handles.get(session_id) {
            let should_park = match requested_owner.as_ref() {
                Some(owner) => handle
                    .active_owner
                    .lock()
                    .as_ref()
                    .map(|current| current == owner)
                    .unwrap_or(false),
                None => true,
            };
            if !should_park {
                return Ok(());
            }

            let _dispatch_guard = handle.dispatch_lock.lock();
            *handle.active_channel.lock() = None;
            *handle.active_owner.lock() = None;
            *handle.attachment_state.lock() = PtyAttachmentState::Parked;
            handle.flow_control.resume();
        }
        Ok(())
    }

    /// Write raw bytes to a session's PTY.
    /// Uses a separate per-session write lock so the main handles lock is released
    /// before any I/O — prevents blocking resize, kill, and other operations.
    pub(crate) fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let writer = {
            let handles = self.handles.lock();
            let handle = handles
                .get(session_id)
                .ok_or_else(|| format!("Session {} not found", session_id))?;
            Arc::clone(&handle.pty_writer)
        };

        let mut writer = writer.lock();
        writer
            .write_all(data)
            .map_err(|e| format!("PTY write: {}", e))?;
        writer.flush().map_err(|e| format!("PTY flush: {}", e))?;
        Ok(())
    }

    /// Send an xterm focus-in (`\x1b[I`) or focus-out (`\x1b[O`) CSI sequence to
    /// a session's PTY. Used to synthesise terminal focus events for providers
    /// (notably Codex) that gate notifications on `terminal_focused`.
    ///
    /// Only writes the CSI sequence if the child process has opted in by
    /// enabling DEC Private Mode 1004 (`\x1b[?1004h`). Writing focus CSI to
    /// sessions that haven't requested it causes the terminal driver to echo
    /// visible garbage ("I", "IOOI") during shell init when echo is still on.
    pub(crate) fn send_focus_event(&self, session_id: &str, focused: bool) -> Result<(), String> {
        let handles = self.handles.lock();
        let handle = handles
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        if !handle.focus_reporting_enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        drop(handles);
        let seq: &[u8] = if focused { b"\x1b[I" } else { b"\x1b[O" };
        self.write(session_id, seq)
    }

    /// Resize a session's PTY.
    pub(crate) fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let handles = self.handles.lock();
        let handle = handles
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        handle
            .pty_master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY resize: {}", e))?;
        *handle.dimensions.lock() = (cols, rows);
        Ok(())
    }

    /// Kill a session.
    pub(crate) fn kill_session(&self, session_id: &str) -> Result<(), String> {
        if let Some(handle) = self.handles.lock().remove(session_id) {
            // Unpause reader thread so it can detect PTY closure and exit cleanly
            handle.flow_control.resume();
            // Best-effort: explicitly tear down the wrapping tmux session if
            // we launched one. Killing the PTY alone only kills the tmux
            // *client*; without this the session can stick around detached
            // and leak.
            if let Some(ref name) = handle.tmux_session_name {
                kill_tmux_session(name);
            }
            // handle dropped here → pty_master closed → reader gets EOF
        }
        self.owner_claims.lock().remove(session_id);
        Ok(())
    }

    pub(crate) fn get_preview_bootstrap(&self, session_id: &str) -> Option<PtyPreviewBootstrap> {
        let handles = self.handles.lock();
        let handle = handles.get(session_id)?;
        let process_state = if handle.terminated.load(Ordering::SeqCst) {
            PtyProcessState::Terminated
        } else {
            PtyProcessState::Running
        };
        let attachment_state = *handle.attachment_state.lock();
        let (cols, rows) = *handle.dimensions.lock();
        let (snapshot, output_offset) = {
            let rb = handle.ring_buffer.lock();
            // Prepend the tracked setup preamble so a wrapped (mid-stream) tail
            // replays with the correct scroll region/alt-screen instead of
            // piling its bottom-anchored redraws onto the last rows.
            // Synthetic bytes only — output_offset stays the real byte count, so
            // live deltas still resume exactly where the snapshot ends.
            let mut bytes = rb.setup_preamble();
            bytes.extend_from_slice(&rb.snapshot());
            let snap = B64.encode(&bytes);
            let offset = handle.output_offset.load(Ordering::SeqCst);
            (snap, offset)
        };
        Some(PtyPreviewBootstrap {
            process_state,
            attachment_state,
            cols,
            rows,
            snapshot,
            output_offset,
        })
    }

    pub(crate) fn get_state(&self, session_id: &str) -> Option<PtyStateSnapshot> {
        let handles = self.handles.lock();
        let handle = handles.get(session_id)?;
        let process_state = if handle.terminated.load(Ordering::SeqCst) {
            PtyProcessState::Terminated
        } else {
            PtyProcessState::Running
        };
        let attachment_state = *handle.attachment_state.lock();
        let (cols, rows) = *handle.dimensions.lock();
        Some(PtyStateSnapshot {
            process_state,
            attachment_state,
            cols,
            rows,
        })
    }

    /// Clean up all sessions on app exit.
    pub(crate) fn cleanup_all(&self) {
        // Collect tmux session names to kill before dropping the handles —
        // dropping closes the PTY but leaves the tmux session detached.
        let tmux_names: Vec<String> = {
            let handles = self.handles.lock();
            handles
                .values()
                .filter_map(|h| h.tmux_session_name.clone())
                .collect()
        };
        self.handles.lock().clear();
        self.owner_claims.lock().clear();
        self.owner_generations.lock().clear();
        for name in tmux_names {
            kill_tmux_session(&name);
        }
    }
}

/// Best-effort tmux kill-session against our dedicated socket. Ignores the
/// exit status: if the session doesn't exist (already dead, never existed,
/// tmux server gone), we don't care — the goal state is "this tmux session
/// does not exist after this call," and not-existing is fine.
fn kill_tmux_session(name: &str) {
    let config = tmux_config_path();
    let _ = std::process::Command::new("tmux")
        .args([
            "-L",
            TMUX_SOCKET_NAME,
            "-f",
            config,
            "kill-session",
            "-t",
            name,
        ])
        .output();
}

/// List orphaned `agtower-*` tmux sessions left over from a previous run
/// and kill them. Runs once at app startup — any session matching our
/// naming scheme at that point is by definition not ours (we haven't
/// created any yet), so it's a crash leftover we should clean up.
///
/// Scoped to our dedicated `-L agtower` socket, so we never touch sessions
/// in the user's own tmux server. Safe no-op when tmux isn't installed or
/// when no AgTower tmux server has ever run on this machine (the
/// `list-sessions` call returns non-zero and we bail early).
pub(crate) fn cleanup_orphan_agtower_tmux_sessions() {
    let config = tmux_config_path();
    let output = std::process::Command::new("tmux")
        .args([
            "-L",
            TMUX_SOCKET_NAME,
            "-f",
            config,
            "list-sessions",
            "-F",
            "#{session_name}",
        ])
        .output();
    let Ok(out) = output else {
        return;
    };
    if !out.status.success() {
        // Non-zero usually means "no server running" — nothing to clean up.
        return;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let name = line.trim();
        if name.starts_with("agtower-") {
            kill_tmux_session(name);
        }
    }
}

#[cfg(test)]
mod attention_tests {
    use super::*;

    #[test]
    fn detects_generic_confirmation_dialog() {
        let text = r#"
        Bash command
        touch /tmp/agtower_probe
        Do you want to proceed?
        1. Yes
        2. Yes, and always allow access to tmp/ from this project
        3. No
        Esc to cancel · Tab to amend · ctrl+e to explain
        "#;

        assert_eq!(detect_claude_attention_prompt(text), Some("confirmation"));
    }

    #[test]
    fn detects_generic_confirmation_dialog_without_footer() {
        let text = r#"
        Network request outside of sandbox
        Host: example.com
        Would you like to continue?
        1. Yes
        2. No
        "#;

        assert_eq!(detect_claude_attention_prompt(text), Some("confirmation"));
    }

    #[test]
    fn detects_generic_selection_dialog() {
        let text = r#"
        Which option would you like to use?
        1. Use the fast path
        2. Use the careful path
        Enter to select · Tab/Arrow keys to navigate · Esc to cancel
        "#;

        assert_eq!(detect_claude_attention_prompt(text), Some("input needed"));
    }

    #[test]
    fn detects_cursor_spaced_confirmation_prompt_markers() {
        let text = "\u{1b}[1CDo\u{1b}[1Cyou\u{1b}[1Cwant\u{1b}[1Cto\u{1b}[1Cproceed?\n\u{1b}[1CEsc\u{1b}[1Cto\u{1b}[1Ccancel\nBash\u{1b}[1Ccommand";

        let cleaned = strip_ansi(text);
        assert_eq!(cleaned, "Doyouwanttoproceed?\nEsctocancel\nBashcommand");
        assert_eq!(detect_claude_attention_prompt(&cleaned), None);
    }

    #[test]
    fn detects_cursor_spaced_confirmation_prompt_with_choices() {
        let text = "\u{1b}[1CDo\u{1b}[1Cyou\u{1b}[1Cwant\u{1b}[1Cto\u{1b}[1Cproceed?\n1.\u{1b}[1CYes\n2.\u{1b}[1CNo\n\u{1b}[1CEsc\u{1b}[1Cto\u{1b}[1Ccancel";

        let cleaned = strip_ansi(text);
        assert_eq!(cleaned, "Doyouwanttoproceed?\n1.Yes\n2.No\nEsctocancel");
        assert_eq!(
            detect_claude_attention_prompt(&cleaned),
            Some("confirmation")
        );
    }

    #[test]
    fn does_not_flag_plain_numbered_output() {
        let text = r#"
        1. Gather evidence
        2. Compare working paths
        3. Verify the fix
        "#;

        assert_eq!(detect_claude_attention_prompt(text), None);
    }

    #[test]
    fn detects_worker_attention_prompt() {
        let text = "Waiting for leader to approve network access to api.example.com";

        assert_eq!(detect_claude_attention_prompt(text), Some("worker request"));
    }

    #[test]
    fn bell_scanner_detects_raw_bell() {
        let mut s = BellScanner::default();
        assert!(s.feed(b"\x07"));
    }

    #[test]
    fn bell_scanner_ignores_bell_inside_osc() {
        // OSC-terminating BEL must not be treated as an attention signal.
        let mut s = BellScanner::default();
        assert!(!s.feed(b"\x1b]0;title\x07"));
        assert!(!s.feed(b"\x1b]9;notify\x07"));
        assert!(!s.feed(b"\x1b]777;notify;x\x07"));
    }

    #[test]
    fn bell_scanner_preserves_osc_state_across_chunks() {
        let mut s = BellScanner::default();
        assert!(!s.feed(b"\x1b]777;notify;title"));
        assert!(!s.feed(b";body\x07"));
    }

    #[test]
    fn bell_scanner_detects_bell_after_osc_closes() {
        let mut s = BellScanner::default();
        assert!(!s.feed(b"\x1b]0;title\x07"));
        assert!(s.feed(b"\x07"));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        strip_startup_noise(data, &mut out);
        out
    }

    // --- PtyOwnerLease (the attach/reclaim race-prevention core) ---------------

    #[test]
    fn claim_owner_increments_generation_per_session() {
        let manager = PtyManager::new();
        let first = manager.claim_owner("sess", "token-a");
        let second = manager.claim_owner("sess", "token-b");
        assert_eq!(first.generation, 1);
        assert_eq!(second.generation, 2);
    }

    #[test]
    fn current_owner_matches_only_latest_token_and_generation() {
        let manager = PtyManager::new();
        let first = manager.claim_owner("sess", "token-a");
        assert!(manager.current_owner_matches("sess", &first.token, first.generation));

        // A re-claim bumps the generation, invalidating the prior lease — this is
        // exactly what stops two terminals from fighting over one PTY.
        let second = manager.claim_owner("sess", "token-b");
        assert!(manager.current_owner_matches("sess", &second.token, second.generation));
        assert!(!manager.current_owner_matches("sess", &first.token, first.generation));
    }

    #[test]
    fn current_owner_rejects_wrong_token_and_unknown_session() {
        let manager = PtyManager::new();
        let lease = manager.claim_owner("sess", "token-a");
        // Right generation, wrong token.
        assert!(!manager.current_owner_matches("sess", "other-token", lease.generation));
        // Right token, stale generation.
        assert!(!manager.current_owner_matches("sess", &lease.token, lease.generation + 1));
        // Session that was never claimed.
        assert!(!manager.current_owner_matches("never-claimed", &lease.token, lease.generation));
    }

    #[test]
    fn focus_reporting_detects_enable_split_across_chunks() {
        let enabled = AtomicBool::new(false);
        let mut tail = Vec::new();

        update_focus_reporting_state(b"before\x1b[?10", &mut tail, &enabled);
        assert!(!enabled.load(Ordering::SeqCst));

        update_focus_reporting_state(b"04hafter", &mut tail, &enabled);
        assert!(enabled.load(Ordering::SeqCst));
    }

    #[test]
    fn focus_reporting_detects_disable_split_across_chunks() {
        let enabled = AtomicBool::new(true);
        let mut tail = Vec::new();

        update_focus_reporting_state(b"before\x1b[?10", &mut tail, &enabled);
        assert!(enabled.load(Ordering::SeqCst));

        update_focus_reporting_state(b"04lafter", &mut tail, &enabled);
        assert!(!enabled.load(Ordering::SeqCst));
    }

    #[test]
    fn focus_reporting_applies_sequences_in_stream_order() {
        let enabled = AtomicBool::new(true);
        let mut tail = Vec::new();

        update_focus_reporting_state(b"\x1b[?1004l text \x1b[?1004h", &mut tail, &enabled);

        assert!(enabled.load(Ordering::SeqCst));
    }

    // ── Raw ESC responses ──

    #[test]
    fn noise_raw_da_response() {
        assert_eq!(filter(b"\x1b[?1;2c"), b"");
    }

    #[test]
    fn noise_raw_focus_out() {
        assert_eq!(filter(b"\x1b[O"), b"");
    }

    #[test]
    fn noise_raw_focus_in() {
        assert_eq!(filter(b"\x1b[I"), b"");
    }

    #[test]
    fn noise_raw_cursor_report() {
        assert_eq!(filter(b"\x1b[24;80R"), b"");
    }

    #[test]
    fn noise_raw_da_with_content() {
        assert_eq!(filter(b"\x1b[?1;2cHello"), b"Hello");
    }

    #[test]
    fn noise_preserves_sgr() {
        assert_eq!(filter(b"\x1b[0m"), b"\x1b[0m");
    }

    #[test]
    fn noise_preserves_cursor_home() {
        assert_eq!(filter(b"\x1b[H"), b"\x1b[H");
    }

    #[test]
    fn noise_preserves_sgr_24bit_color() {
        assert_eq!(filter(b"\x1b[38;2;119;87;200m"), b"\x1b[38;2;119;87;200m");
    }

    #[test]
    fn noise_preserves_incomplete_raw_esc() {
        // Incomplete SGR at chunk boundary — must NOT be stripped
        assert_eq!(filter(b"\x1b[38;2"), b"\x1b[38;2");
    }

    // ── Caret-notation echoes ──

    #[test]
    fn noise_caret_da_response() {
        assert_eq!(filter(b"^[[?1;2c"), b"");
    }

    #[test]
    fn noise_caret_focus_out() {
        // ^[[O — the exact pattern from the user's screenshot
        assert_eq!(filter(b"^[[O"), b"");
    }

    #[test]
    fn noise_caret_focus_in() {
        assert_eq!(filter(b"^[[I"), b"");
    }

    #[test]
    fn noise_caret_fragment_plus_response() {
        assert_eq!(filter(b"^[[0^[[?1;2c"), b"");
    }

    #[test]
    fn noise_caret_focus_with_content() {
        // ^[[O followed by box drawing char (╭ = 0xE2 0x95 0xAD)
        let mut input = b"^[[O".to_vec();
        input.extend_from_slice("╭".as_bytes());
        assert_eq!(filter(&input), "╭".as_bytes());
    }

    #[test]
    fn noise_caret_ss3_echo() {
        // ^[O — SS3 in caret notation
        assert_eq!(filter(b"^[O"), b"");
    }

    // ── Inline filtering ──

    #[test]
    fn noise_inline_raw_mixed() {
        assert_eq!(filter(b"Hello\x1b[?1;2cWorld"), b"HelloWorld");
    }

    #[test]
    fn noise_inline_caret_mixed() {
        assert_eq!(filter(b"Hello^[[?1;2cWorld"), b"HelloWorld");
    }

    #[test]
    fn noise_inline_focus_mixed() {
        assert_eq!(filter(b"Hello^[[OWorld"), b"HelloWorld");
    }

    // ── Edge cases ──

    #[test]
    fn noise_empty() {
        assert_eq!(filter(b""), b"");
    }

    #[test]
    fn noise_plain_text() {
        assert_eq!(filter(b"hello world"), b"hello world");
    }

    #[test]
    fn noise_trailing_caret_bracket() {
        // ^[ at end of buffer — strip (incomplete echo)
        assert_eq!(filter(b"Hello^["), b"Hello");
    }

    #[test]
    fn ring_buffer_basic() {
        let mut rb = RingBuffer::new(8);
        rb.push_slice(b"hello");
        assert_eq!(rb.snapshot(), b"hello");
    }

    #[test]
    fn ring_buffer_wrap() {
        let mut rb = RingBuffer::new(8);
        rb.push_slice(b"12345678");
        assert_eq!(rb.snapshot(), b"12345678");
        rb.push_slice(b"ab");
        assert_eq!(rb.snapshot(), b"345678ab");
    }

    #[test]
    fn ring_buffer_overflow() {
        let mut rb = RingBuffer::new(4);
        rb.push_slice(b"abcdefgh");
        assert_eq!(rb.snapshot(), b"efgh");
    }

    #[test]
    fn ring_buffer_empty() {
        let rb = RingBuffer::new(16);
        assert_eq!(rb.snapshot(), b"");
    }

    #[test]
    fn ring_buffer_incremental_wrap() {
        let mut rb = RingBuffer::new(4);
        rb.push_slice(b"ab");
        rb.push_slice(b"cd");
        assert_eq!(rb.snapshot(), b"abcd");
        rb.push_slice(b"ef");
        assert_eq!(rb.snapshot(), b"cdef");
    }

    fn seed_manager_with_handle(
        session_id: &str,
        data: &[u8],
        cols: u16,
        rows: u16,
        attachment_state: PtyAttachmentState,
        terminated: bool,
    ) -> PtyManager {
        let manager = PtyManager::new();
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open test pty");
        let writer = pty_pair.master.take_writer().expect("test pty writer");
        let mut ring_buffer = RingBuffer::new(data.len().max(16) + 16);
        ring_buffer.push_slice(data);

        manager.handles.lock().insert(
            session_id.to_string(),
            PtyHandle {
                pty_writer: Arc::new(Mutex::new(writer)),
                pty_master: pty_pair.master,
                ring_buffer: Arc::new(Mutex::new(ring_buffer)),
                dispatch_lock: Arc::new(Mutex::new(())),
                active_channel: Arc::new(Mutex::new(None)),
                active_owner: Arc::new(Mutex::new(None)),
                attachment_state: Arc::new(Mutex::new(attachment_state)),
                terminated: Arc::new(AtomicBool::new(terminated)),
                exit_info: Arc::new(Mutex::new(None)),
                flow_control: Arc::new(FlowControl::new()),
                dimensions: Arc::new(Mutex::new((cols, rows))),
                output_offset: Arc::new(AtomicU64::new(data.len() as u64)),
                tmux_session_name: None,
                focus_reporting_enabled: Arc::new(AtomicBool::new(false)),
            },
        );

        manager
    }

    #[test]
    fn preview_bootstrap_returns_state_and_snapshot_together() {
        let manager = seed_manager_with_handle(
            "preview-state",
            b"preview bytes",
            111,
            37,
            PtyAttachmentState::Parked,
            false,
        );

        let bootstrap = manager
            .get_preview_bootstrap("preview-state")
            .expect("preview bootstrap");

        assert_eq!(bootstrap.process_state, PtyProcessState::Running);
        assert_eq!(bootstrap.attachment_state, PtyAttachmentState::Parked);
        assert_eq!(bootstrap.cols, 111);
        assert_eq!(bootstrap.rows, 37);
        assert_eq!(B64.decode(bootstrap.snapshot).unwrap(), b"preview bytes");
        assert_eq!(bootstrap.output_offset, "preview bytes".len() as u64);
    }

    #[test]
    fn preview_bootstrap_respects_current_dimensions_for_terminated_sessions() {
        let manager = seed_manager_with_handle(
            "preview-dims",
            b"done",
            132,
            48,
            PtyAttachmentState::Detached,
            true,
        );

        let bootstrap = manager
            .get_preview_bootstrap("preview-dims")
            .expect("preview bootstrap");

        assert_eq!(bootstrap.process_state, PtyProcessState::Terminated);
        assert_eq!(bootstrap.attachment_state, PtyAttachmentState::Detached);
        assert_eq!((bootstrap.cols, bootstrap.rows), (132, 48));
    }

    #[test]
    fn preview_bootstrap_returns_full_retained_snapshot_not_a_tail_slice() {
        let full = "x".repeat(40_000);
        let manager = seed_manager_with_handle(
            "preview-full",
            full.as_bytes(),
            80,
            24,
            PtyAttachmentState::Detached,
            false,
        );

        let bootstrap = manager
            .get_preview_bootstrap("preview-full")
            .expect("preview bootstrap");

        let decoded = B64
            .decode(bootstrap.snapshot)
            .expect("decode preview bootstrap");
        assert_eq!(decoded.len(), full.len());
        assert_eq!(decoded, full.as_bytes());
    }

    // --- TermSetup: preview-snapshot setup reconstruction ----------------------

    #[test]
    fn term_setup_tracks_alt_screen_region_and_origin() {
        let mut s = TermSetup::default();
        s.observe(b"\x1b[?1049h\x1b[2;23r\x1b[?6hactual TUI content here");
        assert_eq!(s.preamble(), b"\x1b[?1049h\x1b[2;23r\x1b[?6h".to_vec());
    }

    #[test]
    fn term_setup_alt_screen_exit_clears() {
        let mut s = TermSetup::default();
        s.observe(b"\x1b[?1049h");
        s.observe(b"\x1b[?1049l");
        assert!(s.preamble().is_empty(), "left alt screen -> no preamble");
    }

    #[test]
    fn term_setup_handles_sequence_split_across_chunks() {
        let mut s = TermSetup::default();
        // DECSTBM split mid-sequence across two reads.
        s.observe(b"prefix\x1b[2;");
        s.observe(b"40rmore");
        assert_eq!(s.preamble(), b"\x1b[2;40r".to_vec());
    }

    #[test]
    fn term_setup_ris_resets_everything() {
        let mut s = TermSetup::default();
        s.observe(b"\x1b[?1049h\x1b[5;10r\x1b[?6h");
        s.observe(b"\x1bc");
        assert!(s.preamble().is_empty(), "RIS resets all tracked setup");
    }

    #[test]
    fn term_setup_decstbm_reset_clears_region() {
        let mut s = TermSetup::default();
        s.observe(b"\x1b[3;20r");
        s.observe(b"\x1b[r");
        assert!(
            s.preamble().is_empty(),
            "CSI r resets to full-screen region"
        );
    }

    #[test]
    fn term_setup_plain_content_has_empty_preamble() {
        let mut s = TermSetup::default();
        s.observe(b"plain output\nwith newlines and \x1b[31mcolor\x1b[0m but no setup");
        assert!(s.preamble().is_empty());
    }

    #[test]
    fn term_setup_latest_region_wins() {
        let mut s = TermSetup::default();
        s.observe(b"\x1b[1;50r");
        s.observe(b"\x1b[2;40r");
        assert_eq!(s.preamble(), b"\x1b[2;40r".to_vec());
    }

    #[test]
    fn ring_buffer_setup_preamble_only_after_wrap() {
        // Small ring so we can force a wrap cheaply. Setup (14 bytes) fits.
        let mut rb = RingBuffer::new(16);
        rb.push_slice(b"\x1b[?1049h\x1b[2;9r");
        assert!(
            rb.setup_preamble().is_empty(),
            "not wrapped: snapshot still contains the original setup at byte 0"
        );
        // Push past capacity -> oldest bytes (the setup) are evicted.
        rb.push_slice(b"aaaaaaaaaa");
        assert_eq!(
            rb.setup_preamble(),
            b"\x1b[?1049h\x1b[2;9r".to_vec(),
            "wrapped: preamble reconstructs the evicted setup"
        );
    }
}

// ---------------------------------------------------------------------------
// Codex native binary resolution
// ---------------------------------------------------------------------------

/// Find the native Codex Rust binary, bypassing the Node.js wrapper.
///
/// The npm-installed `codex` command is a Node.js script that spawns the
/// actual Rust binary. Running the Rust binary directly avoids:
/// - Extra stdio piping latency (causes input lag in the TUI)
/// - Auto-update on exit (CODEX_MANAGED_BY_NPM env var)
///
/// Result is cached after first resolution.
fn resolve_codex_native_binary() -> Option<String> {
    // Resolved fresh on each spawn (sessions are user-initiated and infrequent —
    // this is not a per-byte hot path). A process-lifetime cache would otherwise
    // pin a stale result for the whole run: a `None` from before Codex was
    // installed, or a path that later disappeared on upgrade.
    resolve_codex_native_binary_inner()
}

fn resolve_codex_native_binary_inner() -> Option<String> {
    use std::path::PathBuf;

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64-apple-darwin"
    } else {
        return None;
    };

    let platform_dir = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-x64"
        }
    } else {
        return None;
    };

    // 1. Find via `which codex` → resolve npm package → native binary
    if let Ok(output) = std::process::Command::new("which").arg("codex").output() {
        let wrapper_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !wrapper_path.is_empty() {
            let wrapper = PathBuf::from(&wrapper_path);
            let resolved = std::fs::canonicalize(&wrapper).unwrap_or(wrapper.clone());

            if let Some(pkg_root) = find_parent_containing(&resolved, "node_modules") {
                let native = pkg_root
                    .join("node_modules")
                    .join(format!("@openai/codex-{}", platform_dir))
                    .join("vendor")
                    .join(arch)
                    .join("codex")
                    .join("codex");
                if native.is_file() {
                    return Some(native.to_string_lossy().to_string());
                }
            }
        }
    }

    // 2. Homebrew paths (these ARE the native binary, not a wrapper)
    for path in &["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let p = PathBuf::from(path);
        if p.is_file() {
            // Verify it's a native binary, not a script. Read only the first 4
            // bytes — these Homebrew binaries are multi-MB Mach-O files, so
            // std::fs::read would load the whole executable just to sniff a magic.
            use std::io::Read as _;
            if let Ok(mut file) = std::fs::File::open(&p) {
                let mut magic = [0u8; 4];
                if file.read_exact(&mut magic).is_ok() && &magic != b"#!/u" {
                    // Not a shebang script → likely native Mach-O
                    return Some(path.to_string());
                }
            }
        }
    }

    None
}

/// Walk up from `path` to find a parent directory that contains `target_dir`.
fn find_parent_containing(path: &std::path::Path, target_dir: &str) -> Option<std::path::PathBuf> {
    let mut current = path.to_path_buf();
    while let Some(parent) = current.parent() {
        if parent.join(target_dir).is_dir() {
            return Some(parent.to_path_buf());
        }
        current = parent.to_path_buf();
    }
    None
}
