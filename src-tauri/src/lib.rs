use std::sync::Arc;

use tauri::Manager;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

mod app_state;
mod commands;
mod control_socket;
mod engine;
mod providers;
mod pty_manager;

use app_state::AppState;
use commands::power::SleepPreventionState;
use pty_manager::PtyManager;

/// Cached Unix-socket path exposed to PTYs via `AGTOWER_SOCKET_PATH`.
/// Managed as Tauri state so command handlers can read it when building env.
pub(crate) struct ControlSocketPath(pub std::path::PathBuf);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // single-instance MUST be the first plugin: it decides whether this
        // process keeps running. With the `deep-link` feature, it also
        // forwards any URL args from a second launch to the deep-link
        // plugin, which then fires on_open_url listeners in the running
        // instance — so only one codepath handles `agtower://` URLs
        // whether arrived at cold start or via re-launch.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch without a URL: just surface the existing window.
            // Second launch with a URL: the deep-link plugin will separately
            // emit on_open_url below and handle show/focus + routing.
            let _ = commands::window::main_window_ready(app.clone());
        }))
        .plugin(tauri_plugin_deep_link::init())
        // Global shortcut — a system-wide hotkey that summons AgTower from
        // anywhere. Registered at runtime in setup() so a conflict (another
        // app already owns the combo) just logs and continues, rather than
        // failing plugin init and breaking the app.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        commands::window::toggle_main_window_visibility(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .setup(|app| {
            // Activate the app immediately so macOS brings it to the foreground.
            // The main window starts hidden (visible: false) and is shown later
            // by main_window_ready — but the app must be "active" first or macOS
            // won't bring the window to the front when it appears.
            // setup() runs on the main thread, so MainThreadMarker is available.
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::NSApplication;
                use objc2_foundation::MainThreadMarker;
                if let Some(mtm) = MainThreadMarker::new() {
                    #[allow(deprecated)]
                    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
                }
            }

            // Materialise the tmux config at a stable path under the app
            // data dir. Must run before any tmux invocations — both the
            // orphan reaper below and every later `create_session` call
            // point at this same file via `tmux -f <config>`.
            pty_manager::init_tmux_config(app.handle());

            // Resolve the bundled helper-CLI dir (`agtower-hook`) so PTYs can
            // export it on PATH. Same resolution strategy as tmux config.
            pty_manager::init_bundled_bin_dir(app.handle());

            // Reap any `agtower-*` tmux sessions left over from a previous
            // run (crash, force-quit, etc.). This runs before PtyManager
            // creates any new sessions, so by definition anything matching
            // our naming scheme at this point is orphaned state we own.
            pty_manager::cleanup_orphan_agtower_tmux_sessions();

            app.manage(AppState {
                pty: PtyManager::new(),
            });
            app.manage(SleepPreventionState::new());

            // Create the Rust engine (database + session/repo stores)
            let engine_instance = engine::Engine::new(app.handle())
                .map_err(|err| std::io::Error::other(format!("Failed to create engine: {err}")))?;
            app.manage(Arc::new(engine_instance));

            // Spin up the control socket that CLI hooks use to push state
            // transitions back into the engine.
            match control_socket::start(app.handle().clone()) {
                Ok(path) => {
                    app.manage(ControlSocketPath(path));
                }
                Err(error) => {
                    eprintln!("[control-socket] failed to start: {error}");
                }
            }
            commands::window::setup_native_menu(app)?;

            // Apply NSVisualEffectView (Sidebar material) + invisible NSToolbar
            // to the main window. The toolbar delegates traffic-light layout to
            // AppKit (Safari/Mail/Xcode behavior). The vibrancy gives the
            // sidebar its translucent Finder-like look.
            #[cfg(target_os = "macos")]
            if let Some(main_window) = app.get_webview_window("main") {
                commands::window::apply_window_vibrancy(&main_window);
                commands::window::attach_invisible_toolbar(&main_window);
            }

            // agtower:// URLs arrive here — cold start, re-launch with a URL,
            // and `open` from Terminal all funnel through the deep-link plugin.
            // We surface the window unconditionally; the frontend's useDeepLink
            // hook subscribes to the same plugin and does the routing (this is
            // the only way — MemoryRouter means the URL can't navigate itself,
            // React has to do it with useNavigate).
            let handle_for_deep_link = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                let _ = commands::window::main_window_ready(handle_for_deep_link.clone());
            });

            // Register the summon shortcut (Cmd+Ctrl+A). Chosen to avoid
            // common conflicts: Slack uses Cmd+Shift+A, VS Code uses
            // Cmd+Shift+A, browsers use Cmd+Shift+T. Cmd+Ctrl+A is
            // effectively free across the dev-tool ecosystem. If it IS
            // already taken on a given machine, we log and continue —
            // the rest of the app keeps working.
            let summon = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SUPER), Code::KeyA);
            if let Err(err) = app.global_shortcut().register(summon) {
                eprintln!(
                    "[global-shortcut] Failed to register summon (Cmd+Ctrl+A); \
                     another app may already own it: {err}"
                );
            }

            // System tray
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let tray_builder = TrayIconBuilder::with_id("main")
                .tooltip("AgTower")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(
                    |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| match event.id.as_ref()
                    {
                        "show" => {
                            let _ = commands::window::main_window_ready(app.clone());
                        }
                        "quit" => {
                            if let Some(state) = app.try_state::<AppState>() {
                                state.pty.cleanup_all();
                            }
                            if let Some(sleep_state) = app.try_state::<SleepPreventionState>() {
                                sleep_state.cleanup();
                            }
                            app.exit(0);
                        }
                        _ => {}
                    },
                )
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let _ = commands::window::main_window_ready(app.clone());
                    }
                });

            let tray_builder = if let Some(icon) = app.default_window_icon() {
                tray_builder.icon(icon.clone())
            } else {
                tray_builder
            };
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);

            tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Repo commands
            commands::repo::validate_repository,
            commands::repo::get_git_head_sha,
            // Provider detection
            commands::discovery::detect_claude,
            commands::discovery::detect_codex,
            // Terminal / PTY commands
            commands::terminal::claim_pty_owner,
            commands::terminal::create_pty_session,
            commands::terminal::attach_pty_session,
            commands::terminal::park_pty_session,
            commands::terminal::get_pty_state,
            commands::terminal::get_pty_preview_bootstrap,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_pty_session,
            commands::terminal::pause_pty_reading,
            commands::terminal::resume_pty_reading,
            commands::terminal::set_session_focused,
            commands::terminal::check_tmux_available,
            // Discovery (onboarding-only; not called at runtime)
            commands::discovery::scan_cli_sessions,
            commands::discovery::extract_session_metadata,
            providers::codex::discovery::scan_codex_sessions,
            commands::discovery::extract_codex_metadata,
            // System
            commands::tray::update_tray_count,
            commands::power::prevent_sleep,
            commands::power::allow_sleep,
            commands::window::sync_native_menu_context,
            commands::window::main_window_ready,
            commands::window::perform_native_title_bar_double_click,
            commands::window::sync_native_window_chrome,
            commands::appearance::get_system_accent_color,
            commands::haptics::perform_haptic_feedback,
            commands::sound::play_system_sound,
            // Engine: Sessions
            commands::engine_commands::engine_startup,
            commands::engine_commands::engine_has_existing_user_data,
            commands::engine_commands::get_all_sessions,
            commands::engine_commands::create_session,
            commands::engine_commands::update_session,
            commands::engine_commands::remove_session,
            commands::engine_commands::check_session_resumable,
            commands::engine_commands::rename_session,
            commands::engine_commands::archive_session,
            commands::engine_commands::clear_session_cache,
            commands::engine_commands::reset_everything,
            // Engine: Repos
            commands::engine_commands::get_all_repos,
            commands::engine_commands::add_repo,
            commands::engine_commands::update_repo,
            commands::engine_commands::remove_repo,
            commands::engine_commands::reorder_repos,
            // Engine: Settings
            commands::engine_commands::update_setting,
            commands::engine_commands::get_engine_settings,
            // Engine: Workspace state
            commands::engine_commands::engine_save_workspace_state,
            commands::engine_commands::engine_load_workspace_state,
            // Engine: Sidebar tree (only pre-computed view actually used)
            commands::view_commands::get_sidebar_tree,
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pty.cleanup_all();
                }
                if let Some(sleep_state) = app_handle.try_state::<SleepPreventionState>() {
                    sleep_state.cleanup();
                }
                if let Some(engine) = app_handle.try_state::<Arc<engine::Engine>>() {
                    engine.sessions.shutdown();
                }
                if let Some(socket_path) = app_handle.try_state::<ControlSocketPath>() {
                    control_socket::cleanup(&socket_path.0);
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            // Reconcile the native NSToolbar on every window resize.
            // macOS fires `Resized` during fullscreen transitions and other
            // titlebar geometry changes; we keep the toolbar attached and let
            // AppKit remain the single owner of traffic-light/title/sidebar
            // layout instead of swapping to a web fallback titlebar.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Resized(_),
                ..
            } => {
                if let Some(window) = app_handle.get_webview_window(&label) {
                    commands::window::sync_toolbar_for_fullscreen(&window);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = commands::window::main_window_ready(app_handle.clone());
            }
            _ => {}
        }),
        Err(err) => eprintln!("[app] Failed to build Tauri application: {err}"),
    }
}
