//! Haptic feedback helper (macOS NSHapticFeedbackPerformer).
//!
//! Force Touch trackpad users get a subtle bump on drop-confirmed,
//! section-boundary crossed, and archive actions — the same signal
//! Finder / Mail / Xcode produce. Non-trackpad hardware silently
//! no-ops. Respects the user's "Haptic Feedback" toggle in System
//! Settings → Trackpad — no opt-in needed from us.

use serde::Deserialize;
use tauri::AppHandle;

/// The three patterns defined by NSHapticFeedbackPerformer:
/// - `Generic`: all-purpose feedback (e.g. action complete)
/// - `Alignment`: snap/align confirmation (e.g. drop onto a target)
/// - `LevelChange`: stepwise change (e.g. crossing a section boundary)
///
/// These map to NSHapticFeedbackPattern raw values 0/1/2.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum HapticPattern {
    Generic,
    Alignment,
    LevelChange,
}

#[cfg(target_os = "macos")]
fn perform_haptic(pattern: HapticPattern) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::MainThreadMarker;

    if MainThreadMarker::new().is_none() {
        return Err("NSHapticFeedbackPerformer must be invoked on the main thread".to_string());
    }

    // NSHapticFeedbackPattern raw values — stable AppKit enum.
    let pattern_value: isize = match pattern {
        HapticPattern::Generic => 0,
        HapticPattern::Alignment => 1,
        HapticPattern::LevelChange => 2,
    };

    // Default: system picks the best performance time. We don't need
    // Now/Drawn — those are for syncing to animation frames, which is
    // irrelevant for our event-driven call sites.
    let performance_time: isize = 0;

    // SAFETY: `defaultPerformer` and `performFeedbackPattern:performanceTime:`
    // are standard AppKit selectors. We hold a MainThreadMarker and null-check
    // the returned performer (if somehow absent on a Mac without haptic HW).
    unsafe {
        let performer: *mut AnyObject =
            msg_send![class!(NSHapticFeedbackManager), defaultPerformer];
        if performer.is_null() {
            return Err("No haptic feedback performer available".to_string());
        }

        let _: () = msg_send![
            performer,
            performFeedbackPattern: pattern_value,
            performanceTime: performance_time
        ];
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn perform_haptic_feedback(
    app: AppHandle,
    pattern: HapticPattern,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Fire-and-forget on the main thread. Haptic calls are ~microsecond
        // latency and we don't care about the result, so blocking the worker
        // thread on a oneshot channel would be wasteful.
        app.run_on_main_thread(move || {
            if let Err(err) = perform_haptic(pattern) {
                eprintln!("[haptic] {err}");
            }
        })
        .map_err(|err| err.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, pattern);
    }

    Ok(())
}
