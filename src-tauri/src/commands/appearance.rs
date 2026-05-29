//! System appearance helpers (macOS accent color).
//!
//! macOS users pick an accent color in System Settings → Appearance.
//! Real native apps (Finder, Mail, Messages, Xcode) use that color for
//! selected rows and focus rings. We read `NSColor.controlAccentColor`,
//! resolve it through sRGB, and expose the result to the webview as a
//! hex string. A small React hook writes it into the `--macos-accent`
//! CSS var so selection backgrounds and focus rings tint to match the
//! user's Mac.

use tauri::AppHandle;

/// macOS "default blue" sRGB accent (0, 122, 255) — returned when we can't
/// resolve the live system accent (non-macOS, early startup, odd KVO races).
const DEFAULT_MACOS_ACCENT: &str = "#007aff";

/// Read `NSColor.controlAccentColor`, resolve it into sRGB, and format as
/// `#rrggbb`. Must run on the main thread — AppKit color APIs require it.
#[cfg(target_os = "macos")]
fn read_system_accent_color() -> Option<String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::MainThreadMarker;

    // MainThreadMarker::new() returns None off-main-thread. Bail rather than
    // invoke AppKit from a worker — doing so is undefined behavior.
    let _mtm = MainThreadMarker::new()?;

    // SAFETY: All selectors are standard AppKit; we hold a MainThreadMarker;
    // we check pointers for null before dereferencing. CGFloat on every macOS
    // target we ship to (arm64, x86_64) is 64-bit, so the `f64` return type
    // matches the ABI. The resolved sRGB color is autoreleased — it stays
    // valid through this scope because we're in an autorelease pool (every
    // main-thread Tauri callback runs inside one).
    unsafe {
        let accent: *mut AnyObject = msg_send![class!(NSColor), controlAccentColor];
        if accent.is_null() {
            return None;
        }

        let srgb: *mut AnyObject = msg_send![class!(NSColorSpace), sRGBColorSpace];
        if srgb.is_null() {
            return None;
        }

        let rgb: *mut AnyObject = msg_send![accent, colorUsingColorSpace: srgb];
        if rgb.is_null() {
            return None;
        }

        let r: f64 = msg_send![rgb, redComponent];
        let g: f64 = msg_send![rgb, greenComponent];
        let b: f64 = msg_send![rgb, blueComponent];

        let to_byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        Some(format!(
            "#{:02x}{:02x}{:02x}",
            to_byte(r),
            to_byte(g),
            to_byte(b)
        ))
    }
}

#[tauri::command]
pub(crate) fn get_system_accent_color(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Tauri commands run on a worker thread pool; AppKit color APIs
        // must run on the main thread. Hop there via run_on_main_thread
        // and wait on a oneshot channel — the read itself is a few hundred
        // nanoseconds, so blocking is fine.
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(read_system_accent_color());
        })
        .map_err(|err| err.to_string())?;

        let color = rx
            .recv()
            .map_err(|err| err.to_string())?
            .unwrap_or_else(|| DEFAULT_MACOS_ACCENT.to_string());
        Ok(color)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(DEFAULT_MACOS_ACCENT.to_string())
    }
}
