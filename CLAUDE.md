# CLAUDE.md - AgTower Project Guide

## What is AgTower?

AgTower is a Tauri v2 desktop app (Rust + React 19) for managing and monitoring AI coding agent sessions across multiple repositories. It's a triage queue and oversight layer — a "control tower" that surfaces which agents need attention and enables rapid response through keyboard-first navigation.

**Package ID:** `com.harflabs.agtower`
**Version:** 1.0.0

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Tailwind CSS v4, shadcn/ui |
| Build | Vite 8, Tauri CLI v2 |
| Desktop | Tauri v2 (Rust), macOS 13+ |
| Terminal | xterm.js v6 (WebGL renderer) |
| State | Zustand v5 |
| Routing | React Router v7 |
| Database | SQLite via rusqlite 0.39 |
| PTY | portable-pty 0.9 + optional tmux |
| Linting | Biome 2.4 (100-char line width, 2-space indent) |
| Testing | Vitest 4 |
| Dead code | Knip 6 |

## Commands

```bash
pnpm install              # Install dependencies
pnpm tauri dev            # Dev server + Rust backend (main dev workflow)
pnpm dev                  # Vite only (no Tauri)
pnpm build                # TypeScript + Vite bundle
pnpm build:mac            # Ad-hoc signed .app bundle
pnpm build:dmg            # .app + DMG installer
pnpm test                 # Run vitest
pnpm lint                 # Biome lint
pnpm lint:fix             # Biome fix
pnpm lint:dead            # Knip dead code detection
pnpm format               # Biome format
pnpm check                # Full pipeline: lint + dead + test + build + cargo fmt/clippy/test
```

## Project Structure

### Frontend (`src/`)

```
src/
  main.tsx                   # Entry point, provider self-registration imports
  App.tsx                    # Root component
  router.tsx                 # Routes
  index.css                  # Global styles + Tailwind
  types/
    session.ts               # SessionRecord, SessionStatus, ProviderType
    sidebar.ts               # Sidebar tree types
  stores/                    # Zustand stores (one per file)
    session-store.ts         # All session state (SessionRecord + SessionLiveState)
    settings-store.ts        # Persistent settings (theme, notifications, archive days, font size)
    repo-store.ts            # Repository/workspace management
    sidebar-store.ts         # Sidebar UI (width, collapsed, focus, keyboard nav)
    modal-store.ts           # Modal/dialog visibility flags
    split-view-store.ts      # Split-pane state (in-memory only)
    provider-availability-store.ts # CLI detection cache
    updater-store.ts         # App-update flow state
  providers/                 # Provider abstraction layer
    registry.ts              # Global provider registry
    types.ts                 # ProviderModule interface
    claude-code/             # Claude Code provider (index, discovery, launcher,
                             # format, settings, types)
    codex/                   # Codex provider (same shape)
    shared/                  # configured-env, provider-settings-section
  hooks/                     # use-app-init, use-keyboard-shortcuts, use-session,
                             # use-session-drag (sidebar→split-pane handoff),
                             # use-attention-signals, use-deep-link, use-updater,
                             # use-fullscreen-state, use-window-active-state, etc.
  components/
    app-shell.tsx, app-sidebar.tsx, app-shell-toolbar.tsx, breadcrumb.tsx
    sidebar/                 # session row, drag ghost, context menu, remove-workspace
    session/                 # session-terminal, split-pane-container, split-drop-zone,
                             # session-header, terminal-context-menu, terminal-search-bar
    dashboard/               # kanban-column, session-card, mini-terminal
    command-palette/         # index, command-actions, ranking, query, recents, danger,
                             # palette-selectors, model
    setup-assistant/         # onboarding/settings flows
    icons/                   # provider-icon, stop-icon
    ui/                      # shadcn/ui base components (linting disabled)
  lib/
    engine.ts                # Tauri command wrappers
    engine-sync.ts           # Subscribe to Rust event stream
    terminal-pool.ts         # xterm.js instance caching by sessionId
    terminal-focus.ts        # Focus state management
    keyboard/                # registry (single source of truth), help, focus-target,
                             # input-guard, select-all
    native-menu.ts, native-dialog.ts # NSMenu / NSAlert wrappers via Tauri
    notifications.ts         # Desktop notification API
    session-helpers.ts       # Filtering, sorting, kanban grouping
    session-navigation.ts    # Focus navigation, advancement
    haptics.ts, status-icons.tsx
    onboarding-state.ts, setup-assistant.ts, app-reset.ts, app-version.ts,
    settings-actions.ts, split-view.ts, storage-keys.ts, tauri-window-events.ts,
    toolbar-meta.ts, viewed-session-history.ts, welcome-icon.ts,
    xterm-render-integrity.ts, errors.ts, platform.ts, app-commands.ts, utils.ts
  pages/
    dashboard.tsx, session.tsx, new-session.tsx, settings.tsx, onboarding.tsx
```

### Rust Backend (`src-tauri/src/`)

```
src-tauri/src/
  main.rs                    # Entry point (fix_path_env, delegates to lib.rs)
  lib.rs                     # Tauri::Builder, plugins, command registry, tmux cleanup
  app_state.rs               # AppState holding PtyManager
  pty_manager.rs             # PTY creation, tmux integration, session lifecycle
  control_socket.rs          # Unix socket the agtower-hook helper writes to
  commands/
    mod.rs                   # Command re-exports
    engine_commands.rs       # Engine startup, sessions/repos/settings CRUD, rename
    terminal.rs              # PTY spawn/attach/park, resize, input, focus
    view_commands.rs         # Sidebar tree computation
    window.rs                # Invisible NSToolbar, vibrancy, native title-bar handling
    repo.rs                  # Repository validation, git HEAD probe
    discovery.rs             # CLI session discovery commands
    tray.rs                  # System tray
    power.rs                 # Sleep prevention (caffeinate / systemd-inhibit)
    appearance.rs            # System accent color
    haptics.rs               # NSHapticFeedback
    sound.rs                 # NSSound
  engine/
    mod.rs                   # Engine coordinator + startup sequence
    database.rs              # SQLite schema bootstrap
    session_store.rs         # Session persistence, event emission, recovery
    repo_store.rs            # Repository persistence
    computation.rs           # Sidebar tree derivation
  providers/
    mod.rs                   # Provider trait
    types.rs                 # SessionMetadata
    claude_code/             # mod, detection, discovery
    codex/                   # mod, detection, discovery
```

## Key Concepts

### Session Model

A `Session = SessionRecord & SessionLiveState`:
- **SessionRecord**: persisted to SQLite (id, repoPath, provider, status, title, prompt, tokens, timestamps, providerData)
- **SessionLiveState**: in-memory only (ptyActive, liveProviderData with tool use, tokens)

### Session Statuses

- **running** — Agent actively working, PTY attached
- **idle** — Session open but paused/waiting
- **needsAttention** — Agent blocked, needs user input
- **closed** — Finished, can preview/resume
- **archived** — Hidden from main view, can unarchive + resume

### Provider Abstraction

Each provider (Claude Code, Codex) implements `ProviderModule`:
- `launcher.buildPtyLaunch()` — how to spawn the CLI
- `detect()` — CLI availability + version probe
- `formatModelName` / `formatTokenSummary` / `getActivityText` — UI display helpers
- `getProviderSessionId` / `preprocessPrompt` — session identity and prompt-rewriting hooks

Providers self-register at import time. `src/main.tsx` triggers the imports at startup; each provider's `index.ts` calls `registerProvider(...)`.

### PTY + Terminal Architecture

- **Rust**: `pty_manager.rs` creates PTYs via `portable-pty`, streams to JS via Tauri events
- **Tmux mode**: optional — each session can run in its own tmux session (`agtower-*`)
- **Frontend**: `terminal-pool.ts` caches xterm.js instances by sessionId
- **Ownership**: `PtyOwnerLease` token system prevents race conditions
- **Events**: `PtyOutput` (base64 data), `Terminated` (exit code/signal)

### Keyboard System

- Single source of truth: `src/lib/keyboard/registry.ts` — `SHORTCUTS` array
- Scoped: global, session, dashboard — no conflicts
- Synchronous keydown handler so the UI commits in the same frame
- Sidebar has vim-style j/k navigation with `keyboardNavActive` state
- Escape precedence: shortcut modal > command palette > search > input blur > deactivate sidebar focus mode (intentionally does NOT stop the agent)
- The shortcut help modal (`?` or `Cmd+/`) renders the current registry verbatim — that is the user-facing reference

### State Management Pattern

```
useSettingsStore           → persist middleware → localStorage
useSessionStore            → in-memory, hydrated from Rust DB at startup
useRepoStore               → in-memory, hydrated from Rust DB at startup
useSidebarStore            → persist middleware → localStorage
useSplitViewStore          → in-memory only
useModalStore              → in-memory only
useProviderAvailabilityStore → persist middleware (cached probe results)
useUpdaterStore            → in-memory only
```

`useSessionStore` and `useRepoStore` use a `_hydrated` flag to guard initial load from the engine.

### Split-Pane View

- Alt+Click a session in the sidebar opens it side-by-side with the active session.
- A custom mouse-based drag (`use-session-drag.ts`) handles sidebar→split-pane handoffs because Tauri v2/wry breaks HTML5 DnD.
- The sidebar's own row-reordering uses `@dnd-kit` (PointerSensor) which works fine.
- Max 2 panes, draggable divider, X to close.
- Files: `split-view-store.ts`, `use-session-drag.ts`, `split-pane-container.tsx`, `split-drop-zone.tsx`.

## Important Constraints

### HTML5 Drag and Drop Does NOT Work in Tauri v2

Tauri v2's `wry` layer (`WryWebView`) overrides macOS `NSDraggingDestination` methods and always returns `true`, preventing `WKWebView` from forwarding drag events to JavaScript. Pointer-event-based libraries (`@dnd-kit`) and our own mouse-based drag hook work correctly; native HTML5 DnD (`onDrag*`) does not.

### macOS Chrome: Invisible NSToolbar, NOT `trafficLightPosition`

**Never add `trafficLightPosition` back to `tauri.conf.json`.** It causes unfixable alignment bugs — position resets on resize/theme/fullscreen (Tauri issues #13044, #14072, #14477) and the coordinate space differs across macOS SDK versions.

Instead, `src-tauri/src/commands/window.rs` attaches an **invisible `NSToolbar`** to the `NSWindow` via `objc2`. AppKit then positions the traffic lights using its unified-toolbar layout algorithm — the same one Safari/Mail/Xcode/Finder use. Toolbar content using `flex items-center` aligns with traffic lights by construction; no CSS offset hacks needed.

- `attach_invisible_toolbar()` — called from `setup()` for the main window.
- `detach_window_toolbar()` + `sync_toolbar_for_fullscreen()` — called from `RunEvent::WindowEvent::Resized` to detach the toolbar on fullscreen enter and reattach on exit. Pattern from Spacedrive.
- `transparent: true` + `macOSPrivateApi: true` + `window-vibrancy` (Sidebar material, `FollowsWindowActiveState`) provide the translucent sidebar.

### macOS AppKit calls must run on the main thread

`MainThreadMarker::new()` returns `None` when called off the main thread. Our `attach_invisible_toolbar` / `detach_window_toolbar` helpers silently no-op in that case. Tauri `#[tauri::command]` handlers run on a worker thread pool by default — wrap AppKit-touching commands in `app.run_on_main_thread(move || { ... })`. `setup()` and `RunEvent` callbacks already run on the main thread, so direct calls there are safe.

### Context menus and dropdowns: use native NSMenu, not Radix

`src/lib/native-menu.ts` wraps `@tauri-apps/api/menu` to create real `NSMenu` instances. Use `createContextMenuHandler(() => [...])` for right-click menus and `showNativeMenu([...])` for click-triggered dropdowns. Don't re-add `@/components/ui/context-menu` or `@/components/ui/dropdown-menu` (deleted on purpose) — Radix menus are HTML popovers with web styling and won't match the native chrome.

Caveats: native `NSMenu` items are text-only (no icons rendered consistently across versions), and "destructive" items aren't color-coded (macOS convention — place destructive actions below a separator instead).

### Window state mirrors: data-fullscreen, data-window-active

`useFullscreenState` and `useWindowActiveState` (in `src/hooks/`) write to `html[data-fullscreen]` and `html[data-window-active]`. CSS uses these to:
- Swap sidebar back to a solid background in fullscreen (no vibrancy backdrop).
- Make `body` opaque in fullscreen (hide transparent-window black reveal).
- Zero the `--window-titlebar-safe-area` padding when there are no traffic lights.
- Dim toolbar buttons when window loses focus (matches native NSToolbar behavior).

### Biome Rules

- 100-char line width, 2-space indent
- `noExplicitAny: off` — `any` is allowed
- `noNonNullAssertion: off` — `!` assertions allowed
- `src/components/ui/**` — linting disabled (shadcn library code)
- CSS linting disabled (Tailwind generates CSS)

### Testing

- Tests are co-located with source as `*.test.ts` / `*.test.tsx`.
- ~30 frontend test files covering command palette ranking, keyboard registry, navigation, terminal pool, session helpers, provider format helpers, and stores.
- ~100 Rust unit tests across `pty_manager` (incl. the PTY ownership lease), `engine::computation`, `engine::database`, `engine::session_store` (apply_updates, dedup), `control_socket` (status-transition guards), and provider discovery.
- Run with `pnpm test` (frontend) or `cargo test --manifest-path src-tauri/Cargo.toml` (Rust).

### Git Workflow

- `main` is stable; feature branches for new work; PRs merged to `main`.
- Commit style: imperative mood, concise.

## Critical Files for Common Tasks

| Task | Start Here |
|------|-----------|
| Add keyboard shortcut | `src/lib/keyboard/registry.ts` + `use-keyboard-shortcuts.ts` |
| Add command palette action | `src/components/command-palette/command-actions.ts` |
| Modify session state | `src/stores/session-store.ts` |
| Add new provider | Implement `ProviderModule` in `src/providers/`, import from `src/main.tsx` |
| Modify terminal rendering | `src/components/session/session-terminal.tsx` |
| Add Rust command | `src-tauri/src/commands/*.rs` + register in `lib.rs` |
| Change DB schema | `src-tauri/migrations/001_init.sql` + `src-tauri/src/engine/database.rs` |
| Session discovery | `src/providers/[provider]/discovery.ts` (TS) + `src-tauri/src/providers/[provider]/discovery.rs` (Rust) |
| PTY management | `src-tauri/src/pty_manager.rs` |

## Environment

- Dev server: `http://localhost:1420`
- App data: `~/Library/Application Support/com.harflabs.agtower` (macOS)
- Claude projects: `~/.claude/projects/`
- Codex sessions: `~/.codex/sessions/`
- Platform detection: `src/lib/platform.ts` (`IS_MACOS`, `HAS_TAURI_RUNTIME`)
