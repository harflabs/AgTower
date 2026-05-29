//! System sound playback (macOS NSSound).
//!
//! macOS ships a fixed set of named UI sounds (Basso, Blow, Funk, Glass,
//! Ping, …) that all system apps — Mail, Messages, Finder, Reminders —
//! pull from. Using one of these in place of Web-Audio-synthesized tones
//! makes our notifications feel native: users recognize the sound, and
//! they honor system-wide effect muting and Do Not Disturb the way a
//! synthesized oscillator does not.

use tauri::AppHandle;

/// The 14 named system sounds that ship in every supported macOS release.
/// `NSSound.soundNamed:` returns nil for anything else, so we validate the
/// input up-front to give the webview a clear error instead of a silent drop.
const VALID_SYSTEM_SOUNDS: &[&str] = &[
    "Basso",
    "Blow",
    "Bottle",
    "Frog",
    "Funk",
    "Glass",
    "Hero",
    "Morse",
    "Ping",
    "Pop",
    "Purr",
    "Sosumi",
    "Submarine",
    "Tink",
];

/// Play a named system sound. Must run on the main thread — NSSound is not
/// thread-safe. Errors are returned rather than swallowed so the caller can
/// log the actual reason (e.g. sound not found on this macOS release).
#[cfg(target_os = "macos")]
fn play_sound(name: &str) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{MainThreadMarker, NSString};

    if MainThreadMarker::new().is_none() {
        return Err("NSSound must be invoked on the main thread".to_string());
    }

    // SAFETY: `soundNamed:` and `play` are standard AppKit selectors; we
    // just confirmed we're on the main thread. The returned NSSound is
    // a shared, cached instance owned by AppKit — we don't retain it.
    unsafe {
        let ns_name = NSString::from_str(name);
        let sound: *mut AnyObject = msg_send![class!(NSSound), soundNamed: &*ns_name];
        if sound.is_null() {
            return Err(format!("System sound '{name}' not found"));
        }
        let _: bool = msg_send![sound, play];
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn play_system_sound(app: AppHandle, name: String) -> Result<(), String> {
    if !VALID_SYSTEM_SOUNDS.contains(&name.as_str()) {
        return Err(format!("Invalid system sound: {name}"));
    }

    #[cfg(target_os = "macos")]
    {
        // Fire-and-forget: schedule on the main thread and return. Sound
        // playback is async inside AppKit; blocking on it would add latency
        // to every notification path for no benefit. We log failures from
        // the main-thread hop so silent drops are still visible.
        app.run_on_main_thread(move || {
            if let Err(err) = play_sound(&name) {
                eprintln!("[sound] Failed to play '{name}': {err}");
            }
        })
        .map_err(|err| err.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, name);
    }

    Ok(())
}
