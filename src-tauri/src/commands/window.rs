#[cfg(target_os = "macos")]
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_window_state::{StateFlags, WindowExt};

pub(crate) const APP_COMMAND_EVENT: &str = "agtower://app-command";

#[cfg(target_os = "macos")]
static NATIVE_CHROME_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
#[cfg(target_os = "macos")]
static WINDOW_SIDEBAR_TOGGLE_VISIBILITY: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

#[cfg(target_os = "macos")]
mod native_window_chrome {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ptr;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{define_class, msg_send, sel, MainThreadOnly};
    use objc2_app_kit::{
        NSBezelStyle, NSButton, NSCellImagePosition, NSImage, NSImageNameTouchBarSidebarTemplate,
        NSLayoutAttribute, NSTitlebarAccessoryViewController, NSWindow,
    };
    use objc2_foundation::{
        MainThreadMarker, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
    };
    use tauri::AppHandle;

    use super::{emit_command, CMD_VIEW_TOGGLE_SIDEBAR, NATIVE_CHROME_APP_HANDLE};

    thread_local! {
        static SIDEBAR_ACCESSORY_ACTION_TARGET: RefCell<Option<Retained<SidebarAccessoryActionTarget>>> =
            const { RefCell::new(None) };
        static SIDEBAR_ACCESSORY_CONTROLLERS: RefCell<HashMap<String, Retained<NSTitlebarAccessoryViewController>>> =
            RefCell::new(HashMap::new());
    }

    pub(super) fn remember_app_handle(app: &AppHandle) {
        let _ = NATIVE_CHROME_APP_HANDLE.set(app.clone());
    }

    fn sidebar_toggle_image(accessibility_description: &NSString) -> Option<Retained<NSImage>> {
        let symbol_name = NSString::from_str("sidebar.left");
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &symbol_name,
            Some(accessibility_description),
        )
        .or_else(|| NSImage::imageNamed(unsafe { NSImageNameTouchBarSidebarTemplate }))?;
        image.setTemplate(true);
        Some(image)
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[name = "AgTowerSidebarAccessoryActionTarget"]
        pub(super) struct SidebarAccessoryActionTarget;

        unsafe impl NSObjectProtocol for SidebarAccessoryActionTarget {}

        impl SidebarAccessoryActionTarget {
            #[unsafe(method(toggleSidebar:))]
            fn toggle_sidebar(&self, _sender: Option<&AnyObject>) {
                if let Some(app) = NATIVE_CHROME_APP_HANDLE.get() {
                    emit_command(app, CMD_VIEW_TOGGLE_SIDEBAR);
                }
            }
        }
    );

    impl SidebarAccessoryActionTarget {
        pub(super) fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    fn accessory_action_target(mtm: MainThreadMarker) -> Retained<SidebarAccessoryActionTarget> {
        SIDEBAR_ACCESSORY_ACTION_TARGET.with(|slot| {
            let mut slot = slot.borrow_mut();
            slot.get_or_insert_with(|| SidebarAccessoryActionTarget::new(mtm))
                .clone()
        })
    }

    fn build_sidebar_toggle_button(
        mtm: MainThreadMarker,
        target: &SidebarAccessoryActionTarget,
    ) -> Option<Retained<NSButton>> {
        let accessibility_description = NSString::from_str("Toggle Sidebar");
        let image = sidebar_toggle_image(&accessibility_description)?;
        let button = unsafe {
            NSButton::buttonWithImage_target_action(
                &image,
                Some(target),
                Some(sel!(toggleSidebar:)),
                mtm,
            )
        };
        button.setTitle(&NSString::from_str(""));
        button.setToolTip(Some(&accessibility_description));
        button.setBezelStyle(NSBezelStyle::Toolbar);
        button.setImagePosition(NSCellImagePosition::ImageOnly);
        button.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(28.0, 28.0)));
        Some(button)
    }

    fn remove_titlebar_accessory_controller(
        ns_window: &NSWindow,
        controller: &NSTitlebarAccessoryViewController,
    ) {
        let accessory_controllers = ns_window.titlebarAccessoryViewControllers();
        for index in (0..accessory_controllers.count()).rev() {
            let candidate = unsafe { accessory_controllers.objectAtIndex_unchecked(index) };
            if ptr::eq(candidate, controller) {
                ns_window.removeTitlebarAccessoryViewControllerAtIndex(index as isize);
            }
        }
    }

    pub(super) fn sync_sidebar_toggle_accessory(
        ns_window: &NSWindow,
        window_label: &str,
        shows_sidebar_toggle: bool,
        mtm: MainThreadMarker,
    ) {
        SIDEBAR_ACCESSORY_CONTROLLERS.with(|controllers| {
            let mut controllers = controllers.borrow_mut();

            // AppKit may rebuild the titlebar accessory stack during fullscreen
            // and other chrome transitions. Remove only AgTower's controller,
            // then reinsert it so unrelated native accessories are preserved.
            if let Some(existing) = controllers.get(window_label) {
                remove_titlebar_accessory_controller(ns_window, existing);
            }

            if !shows_sidebar_toggle {
                controllers.remove(window_label);
                return;
            }

            let controller = if let Some(existing) = controllers.get(window_label) {
                existing.clone()
            } else {
                let target = accessory_action_target(mtm);
                let Some(button) = build_sidebar_toggle_button(mtm, &target) else {
                    return;
                };

                let controller = NSTitlebarAccessoryViewController::new(mtm);
                controller.setView(&button);
                controllers.insert(window_label.to_string(), controller.clone());
                controller
            };

            controller.setHidden(false);
            controller.setAutomaticallyAdjustsSize(false);
            controller.setLayoutAttribute(NSLayoutAttribute::Left);
            controller.setFullScreenMinHeight(28.0);
            ns_window.insertTitlebarAccessoryViewController_atIndex(&controller, 0);
        });
    }
}

#[cfg(target_os = "macos")]
fn sidebar_toggle_visibility_map() -> &'static Mutex<HashMap<String, bool>> {
    WINDOW_SIDEBAR_TOGGLE_VISIBILITY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "macos")]
fn remember_sidebar_toggle_visibility(window_label: &str, shows_sidebar_toggle: bool) {
    if let Ok(mut visibility) = sidebar_toggle_visibility_map().lock() {
        visibility.insert(window_label.to_string(), shows_sidebar_toggle);
    }
}

#[cfg(target_os = "macos")]
fn sidebar_toggle_visibility_for_window(window_label: &str) -> bool {
    sidebar_toggle_visibility_map()
        .lock()
        .ok()
        .and_then(|visibility| visibility.get(window_label).copied())
        .unwrap_or(window_label == "main")
}

#[cfg(target_os = "macos")]
fn sync_native_sidebar_titlebar_accessory(
    ns_window: &objc2_app_kit::NSWindow,
    window_label: &str,
    shows_sidebar_toggle: bool,
    mtm: objc2_foundation::MainThreadMarker,
) {
    remember_sidebar_toggle_visibility(window_label, shows_sidebar_toggle);
    native_window_chrome::sync_sidebar_toggle_accessory(
        ns_window,
        window_label,
        shows_sidebar_toggle,
        mtm,
    );
}

#[cfg(target_os = "macos")]
fn ensure_toolbar_for_window(window: &WebviewWindow, shows_sidebar_toggle: bool) {
    use objc2::MainThreadOnly;
    use objc2_app_kit::{NSToolbar, NSToolbarDisplayMode, NSWindow};
    use objc2_foundation::{MainThreadMarker, NSArray, NSString};

    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    if ns_window_ptr.is_null() {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let toolbar_identifier = NSString::from_str(&format!(
        "com.harflabs.agtower.native-toolbar.{}",
        window.label()
    ));

    unsafe {
        let ns_window = &*(ns_window_ptr as *mut NSWindow);
        let toolbar = match ns_window.toolbar() {
            Some(existing) if existing.identifier().isEqualToString(&toolbar_identifier) => {
                existing
            }
            _ => {
                let toolbar =
                    NSToolbar::initWithIdentifier(NSToolbar::alloc(mtm), &toolbar_identifier);
                ns_window.setToolbar(Some(&toolbar));
                toolbar
            }
        };

        #[allow(deprecated)]
        toolbar.setShowsBaselineSeparator(false);
        toolbar.setDisplayMode(NSToolbarDisplayMode::IconOnly);
        toolbar.setAllowsUserCustomization(false);
        toolbar.setAllowsDisplayModeCustomization(false);
        toolbar.setAutosavesConfiguration(false);
        toolbar.setVisible(true);
        toolbar.setItemIdentifiers(&NSArray::<NSString>::from_slice(&[]));
        sync_native_sidebar_titlebar_accessory(
            ns_window,
            window.label(),
            shows_sidebar_toggle,
            mtm,
        );
        ns_window.displayIfNeeded();
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn apply_window_vibrancy(window: &WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
    let _ = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    );
}

/// Attach an invisible NSToolbar to the window so AppKit positions the traffic
/// lights using its unified-toolbar layout logic (Safari/Mail/Xcode behavior).
///
/// This is MORE reliable than `trafficLightPosition` because:
/// - Manual positioning resets on theme/title/resize/fullscreen (Tauri issues
///   #13044, #14072, #14477).
/// - AppKit draws traffic lights in the natural y-center of the toolbar row,
///   so toolbar HTML content laid out via `flex items-center` aligns perfectly
///   with them by construction.
///
/// Reference: Spacedrive's `apps/tauri/crates/macos/src-swift/window.swift`.
#[cfg(target_os = "macos")]
pub(crate) fn attach_invisible_toolbar(window: &WebviewWindow) {
    attach_invisible_toolbar_with_sidebar_toggle(
        window,
        sidebar_toggle_visibility_for_window(window.label()),
    );
}

#[cfg(target_os = "macos")]
fn attach_invisible_toolbar_with_sidebar_toggle(
    window: &WebviewWindow,
    shows_sidebar_toggle: bool,
) {
    ensure_toolbar_for_window(window, shows_sidebar_toggle);
}

/// Reconcile native toolbar state after window geometry changes.
/// We keep the toolbar attached in both windowed and fullscreen modes so AppKit
/// remains the single owner of traffic-light/title/sidebar-toggle layout.
#[cfg(target_os = "macos")]
pub(crate) fn sync_toolbar_for_fullscreen(window: &WebviewWindow) {
    attach_invisible_toolbar_with_sidebar_toggle(
        window,
        sidebar_toggle_visibility_for_window(window.label()),
    );
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct NativeWindowChromePayload {
    pub title: String,
    pub subtitle: Option<String>,
    pub shows_sidebar_toggle: bool,
    /// When true, NSWindow.title stays set (so Cmd+Tab / Mission Control / Dock
    /// still display the page name) but the visual title in the toolbar is
    /// suppressed via NSWindowTitleVisibility::Hidden so the React-rendered
    /// toolbar (e.g. session breadcrumb) can own the space without
    /// duplication. Traffic lights are unaffected — they're positioned by the
    /// invisible NSToolbar, independent of title visibility.
    #[serde(default)]
    pub hide_title: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeWindowChromeState {
    pub content_inset_top: f64,
    pub is_fullscreen: bool,
}

#[cfg(target_os = "macos")]
fn sync_native_window_chrome_inner(
    window: &WebviewWindow,
    payload: &NativeWindowChromePayload,
) -> Result<NativeWindowChromeState, String> {
    use objc2_app_kit::{NSWindow, NSWindowTitleVisibility, NSWindowToolbarStyle};
    use objc2_foundation::{MainThreadMarker, NSString};

    let Ok(ns_window_ptr) = window.ns_window() else {
        return Ok(NativeWindowChromeState {
            content_inset_top: 0.0,
            is_fullscreen: false,
        });
    };
    if ns_window_ptr.is_null() {
        return Ok(NativeWindowChromeState {
            content_inset_top: 0.0,
            is_fullscreen: false,
        });
    }

    let Some(_mtm) = MainThreadMarker::new() else {
        return Ok(NativeWindowChromeState {
            content_inset_top: 0.0,
            is_fullscreen: false,
        });
    };

    native_window_chrome::remember_app_handle(window.app_handle());
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    attach_invisible_toolbar_with_sidebar_toggle(window, payload.shows_sidebar_toggle);

    let title = NSString::from_str(&payload.title);
    // When hiding the title, also blank the subtitle so AppKit doesn't draw a
    // lonely subtitle row under an invisible title in unified-toolbar style.
    let subtitle_str = if payload.hide_title {
        ""
    } else {
        payload.subtitle.as_deref().unwrap_or("")
    };
    let subtitle = NSString::from_str(subtitle_str);
    let title_visibility = if payload.hide_title {
        NSWindowTitleVisibility::Hidden
    } else {
        NSWindowTitleVisibility::Visible
    };

    // SAFETY: Tauri gives us a valid NSWindow pointer, we're on the AppKit
    // thread, and the Objective-C messages below map directly to generated
    // AppKit bindings for NSWindow.
    unsafe {
        let ns_window = &*(ns_window_ptr as *mut NSWindow);
        ns_window.setTitle(&title);
        ns_window.setSubtitle(&subtitle);
        ns_window.setTitleVisibility(title_visibility);
        ns_window.setToolbarStyle(NSWindowToolbarStyle::Unified);

        ns_window.displayIfNeeded();

        let frame = ns_window.frame();
        let content_layout_rect = ns_window.contentLayoutRect();
        let content_inset_top = (frame.size.height
            - (content_layout_rect.origin.y + content_layout_rect.size.height))
            .max(0.0);

        Ok(NativeWindowChromeState {
            content_inset_top,
            is_fullscreen,
        })
    }
}

#[tauri::command]
pub(crate) fn sync_native_window_chrome(
    window: WebviewWindow,
    payload: NativeWindowChromePayload,
) -> Result<NativeWindowChromeState, String> {
    #[cfg(target_os = "macos")]
    {
        let app = window.app_handle();
        let app_for_main = app.clone();
        let window_label = window.label().to_string();
        let (tx, rx) = std::sync::mpsc::channel();

        app.run_on_main_thread(move || {
            let result = app_for_main
                .get_webview_window(&window_label)
                .ok_or_else(|| format!("Window '{window_label}' not found"))
                .and_then(|current_window| {
                    sync_native_window_chrome_inner(&current_window, &payload)
                });
            let _ = tx.send(result);
        })
        .map_err(|err| err.to_string())?;

        rx.recv().map_err(|err| err.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, payload);
        Ok(NativeWindowChromeState {
            content_inset_top: 0.0,
            is_fullscreen: false,
        })
    }
}

pub(crate) const CMD_APP_COMMAND_PALETTE: &str = "app.command-palette";
pub(crate) const CMD_APP_PREFERENCES: &str = "app.preferences";
pub(crate) const CMD_APP_KEYBOARD_SHORTCUTS: &str = "app.keyboard-shortcuts";
pub(crate) const CMD_APP_HELP_DOCS: &str = "app.help.docs";
pub(crate) const CMD_SESSION_NEW: &str = "session.new";
pub(crate) const CMD_SESSION_NEW_TERMINAL: &str = "session.new-terminal";
pub(crate) const CMD_SESSION_CLOSE_CONTEXT: &str = "session.close-context";
pub(crate) const CMD_SESSION_ARCHIVE_AND_ADVANCE: &str = "session.archive-and-advance";
pub(crate) const CMD_VIEW_TOGGLE_SIDEBAR: &str = "view.toggle-sidebar";
pub(crate) const CMD_VIEW_SEARCH: &str = "view.search";
pub(crate) const CMD_VIEW_SYNC_CLI_SESSIONS: &str = "view.sync-cli-sessions";

pub(crate) struct NativeMenuState {
    pub archive_and_advance: MenuItem<tauri::Wry>,
    pub close_context: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub(crate) struct MainWindowReadyState {
    shown_once: AtomicBool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeMenuContext {
    pub can_archive_and_advance: bool,
    pub close_menu_text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuCommandPayload {
    command_id: String,
}

#[cfg(target_os = "macos")]
enum TitleBarDoubleClickAction {
    Minimize,
    Zoom,
    None,
}

#[cfg(target_os = "macos")]
fn read_defaults_value(key: &str) -> Option<String> {
    let output = Command::new("defaults")
        .args(["read", "-g", key])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(target_os = "macos")]
fn title_bar_double_click_action() -> TitleBarDoubleClickAction {
    if let Some(action) = read_defaults_value("AppleActionOnDoubleClick") {
        return match action.to_ascii_lowercase().as_str() {
            "minimize" => TitleBarDoubleClickAction::Minimize,
            "none" => TitleBarDoubleClickAction::None,
            "fill" | "zoom" | "maximize" => TitleBarDoubleClickAction::Zoom,
            _ => TitleBarDoubleClickAction::Zoom,
        };
    }

    if let Some(miniaturize) = read_defaults_value("AppleMiniaturizeOnDoubleClick") {
        if matches!(miniaturize.as_str(), "1" | "true" | "YES" | "yes") {
            return TitleBarDoubleClickAction::Minimize;
        }
    }

    TitleBarDoubleClickAction::Zoom
}

fn main_window_command(command_id: &str) -> bool {
    matches!(
        command_id,
        CMD_APP_COMMAND_PALETTE
            | CMD_APP_PREFERENCES
            | CMD_APP_KEYBOARD_SHORTCUTS
            | CMD_SESSION_NEW
            | CMD_SESSION_NEW_TERMINAL
            | CMD_VIEW_TOGGLE_SIDEBAR
            | CMD_VIEW_SYNC_CLI_SESSIONS
    )
}

fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .cloned()
}

fn show_and_focus(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    // On macOS, `set_focus()` makes the window key but doesn't activate the
    // application itself. Without this, the window appears but stays behind
    // other apps until the user clicks it a second time.
    // `run_on_main_thread` is required because this function is often called
    // from Tauri command handlers which run on a thread pool — objc2's
    // MainThreadMarker::new() returns None off the main thread.
    #[cfg(target_os = "macos")]
    {
        let _ = window.app_handle().run_on_main_thread(|| {
            use objc2_app_kit::NSApplication;
            use objc2_foundation::MainThreadMarker;
            if let Some(mtm) = MainThreadMarker::new() {
                #[allow(deprecated)]
                NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            }
        });
    }
}

fn emit_command(app: &AppHandle, command_id: &str) {
    let target = if main_window_command(command_id) {
        app.get_webview_window("main")
    } else {
        focused_window(app).or_else(|| app.get_webview_window("main"))
    };

    if let Some(window) = target {
        if window.label() == "main" && main_window_command(command_id) {
            show_and_focus(&window);
        }

        let _ = window.emit(
            APP_COMMAND_EVENT,
            NativeMenuCommandPayload {
                command_id: command_id.to_string(),
            },
        );
    }
}

pub(crate) fn setup_native_menu(app: &tauri::App) -> tauri::Result<()> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About AgTower"),
        Some(
            AboutMetadataBuilder::new()
                .name(Some("AgTower"))
                .version(Some(env!("CARGO_PKG_VERSION")))
                .website(Some("https://github.com/harflabs/agtower"))
                .website_label(Some("GitHub"))
                .copyright(Some("Copyright © Harf Labs"))
                .build(),
        ),
    )?;
    let preferences = MenuItem::with_id(
        app,
        CMD_APP_PREFERENCES,
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let services = PredefinedMenuItem::services(app, None)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
    let quit = MenuItem::with_id(app, "app.quit", "Quit AgTower", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = SubmenuBuilder::new(app, "AgTower")
        .item(&about)
        .separator()
        .item(&preferences)
        .separator()
        .item(&services)
        .separator()
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .separator()
        .item(&quit)
        .build()?;

    let new_session = MenuItem::with_id(
        app,
        CMD_SESSION_NEW,
        "New Session",
        true,
        Some("CmdOrCtrl+T"),
    )?;
    let new_terminal = MenuItem::with_id(
        app,
        CMD_SESSION_NEW_TERMINAL,
        "New Terminal",
        true,
        Some("Shift+CmdOrCtrl+T"),
    )?;
    let close_context = MenuItem::with_id(
        app,
        CMD_SESSION_CLOSE_CONTEXT,
        "Close Window",
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let archive_and_advance = MenuItem::with_id(
        app,
        CMD_SESSION_ARCHIVE_AND_ADVANCE,
        "Archive and Advance",
        false,
        Some("CmdOrCtrl+E"),
    )?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_session)
        .item(&new_terminal)
        .separator()
        .item(&close_context)
        .item(&archive_and_advance)
        .build()?;

    let undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
    let redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .separator()
        .item(&select_all)
        .build()?;

    let command_palette = MenuItem::with_id(
        app,
        CMD_APP_COMMAND_PALETTE,
        "Command Palette",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let toggle_sidebar = MenuItem::with_id(
        app,
        CMD_VIEW_TOGGLE_SIDEBAR,
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let search = MenuItem::with_id(app, CMD_VIEW_SEARCH, "Search", true, Some("CmdOrCtrl+F"))?;
    let sync_cli_sessions = MenuItem::with_id(
        app,
        CMD_VIEW_SYNC_CLI_SESSIONS,
        "Sync CLI Sessions",
        true,
        Some("Shift+CmdOrCtrl+S"),
    )?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .item(&toggle_sidebar)
        .item(&search)
        .separator()
        .item(&sync_cli_sessions)
        .build()?;

    let minimize = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
    let zoom = PredefinedMenuItem::maximize(app, Some("Zoom"))?;
    let bring_all_to_front = PredefinedMenuItem::show_all(app, Some("Bring All to Front"))?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&minimize)
        .item(&zoom)
        .separator()
        .item(&bring_all_to_front)
        .build()?;

    let keyboard_shortcuts = MenuItem::with_id(
        app,
        CMD_APP_KEYBOARD_SHORTCUTS,
        "Keyboard Shortcuts",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    let help_docs = MenuItem::with_id(app, CMD_APP_HELP_DOCS, "AgTower Help", true, None::<&str>)?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&keyboard_shortcuts)
        .item(&help_docs)
        .build()?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    menu.set_as_app_menu()?;

    #[cfg(target_os = "macos")]
    {
        let _ = window_menu.set_as_windows_menu_for_nsapp();
        let _ = help_menu.set_as_help_menu_for_nsapp();
    }

    app.manage(NativeMenuState {
        archive_and_advance,
        close_context,
    });
    app.manage(MainWindowReadyState::default());

    app.on_menu_event(|app, event| match event.id.as_ref() {
        "app.quit" => {
            app.exit(0);
        }
        CMD_APP_COMMAND_PALETTE
        | CMD_APP_PREFERENCES
        | CMD_APP_KEYBOARD_SHORTCUTS
        | CMD_APP_HELP_DOCS
        | CMD_SESSION_NEW
        | CMD_SESSION_NEW_TERMINAL
        | CMD_SESSION_CLOSE_CONTEXT
        | CMD_SESSION_ARCHIVE_AND_ADVANCE
        | CMD_VIEW_TOGGLE_SIDEBAR
        | CMD_VIEW_SEARCH
        | CMD_VIEW_SYNC_CLI_SESSIONS => emit_command(app, event.id.as_ref()),
        _ => {}
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn sync_native_menu_context(
    app: AppHandle,
    context: NativeMenuContext,
) -> Result<(), String> {
    let Some(menu_state) = app.try_state::<NativeMenuState>() else {
        return Ok(());
    };

    menu_state
        .close_context
        .set_text(&context.close_menu_text)
        .map_err(|err| err.to_string())?;
    menu_state
        .archive_and_advance
        .set_enabled(context.can_archive_and_advance)
        .map_err(|err| err.to_string())?;

    Ok(())
}

/// Toggle the main window's visibility in response to the global summon
/// shortcut. If the window is already the key window, hide the whole app
/// via NSApp.hide (standard Raycast/Alfred "summon-to-hide" pattern). If
/// the window is not focused — whether it's in the background, hidden, or
/// the user is in another app — surface + focus it.
pub(crate) fn toggle_main_window_visibility(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let Some(main_window) = app.get_webview_window("main") else {
            return;
        };
        let is_focused = main_window.is_focused().unwrap_or(false);
        let is_visible = main_window.is_visible().unwrap_or(false);
        if is_focused && is_visible {
            // NSApplication.hide(_:) hides every window owned by the app and
            // returns focus to the previous app — matches Cmd+H and what every
            // summon-style launcher (Raycast, Alfred, 1Password) does.
            let _ = app.hide();
            return;
        }
    }
    let _ = main_window_ready(app.clone());
}

#[tauri::command]
pub(crate) fn main_window_ready(app: AppHandle) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    if let Some(ready_state) = app.try_state::<MainWindowReadyState>() {
        if ready_state.shown_once.swap(true, Ordering::SeqCst) {
            show_and_focus(&main_window);
            return Ok(());
        }
    }

    main_window
        .restore_state(StateFlags::all())
        .map_err(|err| err.to_string())?;
    show_and_focus(&main_window);

    Ok(())
}

#[tauri::command]
pub(crate) fn perform_native_title_bar_double_click(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match title_bar_double_click_action() {
            TitleBarDoubleClickAction::Minimize => window.minimize().map_err(|err| err.to_string()),
            TitleBarDoubleClickAction::Zoom => {
                match window.is_maximized().map_err(|err| err.to_string())? {
                    true => window.unmaximize().map_err(|err| err.to_string()),
                    false => window.maximize().map_err(|err| err.to_string()),
                }
            }
            TitleBarDoubleClickAction::None => Ok(()),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        match window.is_maximized().map_err(|err| err.to_string())? {
            true => window.unmaximize().map_err(|err| err.to_string()),
            false => window.maximize().map_err(|err| err.to_string()),
        }
    }
}
