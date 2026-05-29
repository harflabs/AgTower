use parking_lot::Mutex;
use std::process::{Child, Command, Stdio};

pub(crate) struct SleepPreventionState {
    process: Mutex<Option<Child>>,
}

impl SleepPreventionState {
    pub(crate) fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    pub(crate) fn cleanup(&self) {
        if let Some(mut child) = self.process.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SleepPreventionState {
    fn drop(&mut self) {
        if let Some(mut child) = self.process.lock().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub(crate) fn prevent_sleep(state: tauri::State<'_, SleepPreventionState>) -> Result<(), String> {
    let mut guard = state.process.lock();
    if guard.is_some() {
        return Ok(()); // Already preventing sleep
    }
    #[cfg(target_os = "macos")]
    {
        // caffeinate -i: prevent idle sleep (doesn't prevent display sleep)
        let child = Command::new("caffeinate")
            .arg("-i")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn caffeinate: {}", e))?;
        *guard = Some(child);
    }
    #[cfg(target_os = "linux")]
    {
        let child = Command::new("systemd-inhibit")
            .args([
                "--what=idle",
                "--who=AgTower",
                "--why=Agent sessions running",
                "sleep",
                "infinity",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn systemd-inhibit: {}", e))?;
        *guard = Some(child);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn allow_sleep(state: tauri::State<'_, SleepPreventionState>) -> Result<(), String> {
    let mut guard = state.process.lock();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
