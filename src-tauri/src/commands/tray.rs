#[tauri::command]
pub(crate) fn update_tray_count(app: tauri::AppHandle, count: usize) {
    if let Some(tray) = app.tray_by_id("main") {
        #[cfg(target_os = "macos")]
        {
            let title: Option<String> = if count == 0 {
                None
            } else {
                Some(format!("{}", count))
            };
            let _ = tray.set_title(title);
        }
        let tooltip = if count == 0 {
            Some("AgTower — no sessions need attention".to_string())
        } else {
            Some(format!(
                "AgTower — {} session{} need attention",
                count,
                if count == 1 { "" } else { "s" }
            ))
        };
        let _ = tray.set_tooltip(tooltip);
    }
}
