use serde::Serialize;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const GIT_TIMEOUT: Duration = Duration::from_secs(10);

/// Run a git command with a timeout to prevent indefinite hangs
/// on corrupted repos or network-mounted filesystems.
fn git_output(repo_path: &str, args: &[&str]) -> Result<Output, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    let deadline = Instant::now() + GIT_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to read git output: {}", e));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git command timed out".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("Failed to wait for git: {}", e)),
        }
    }
}

#[derive(Serialize)]
pub(crate) struct RepoInfo {
    name: String,
    path: String,
    is_git: bool,
}

#[tauri::command]
pub(crate) fn validate_repository(path: String) -> Result<RepoInfo, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let name = dir_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let is_git = dir_path.join(".git").is_dir();

    Ok(RepoInfo { name, path, is_git })
}

#[tauri::command]
pub(crate) fn get_git_head_sha(repo_path: String) -> Result<Option<String>, String> {
    let path = Path::new(&repo_path);
    if !path.join(".git").is_dir() {
        return Ok(None);
    }

    let output = git_output(&repo_path, &["rev-parse", "HEAD"])?;

    if output.status.success() {
        let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if sha.is_empty() { None } else { Some(sha) })
    } else {
        Ok(None)
    }
}
