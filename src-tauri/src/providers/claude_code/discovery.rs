use serde::Serialize;
use std::cmp::Reverse;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use crate::providers::types::SessionMetadata;

/// Humanize a hyphenated slug: "check-email-correspondence" → "Check Email Correspondence"
pub(crate) fn humanize_slug(slug: &str) -> String {
    slug.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(first) => {
                    let mut s = first.to_uppercase().to_string();
                    s.extend(c);
                    s
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extract a clean session title from raw prompt text.
///
/// Handles Claude CLI prompt formats:
/// - `<command-message>check-submissions</command-message>` → "Check Submissions"
/// - `<local-command-caveat>Caveat: ...</local-command-caveat>` → stripped entirely
/// - Terminal output with shell prompts (➜, ❯, $, etc.) → extracts the command
/// - npm/pnpm script output lines → stripped
/// - Any remaining XML/HTML tags → stripped, inner content kept
pub(crate) fn extract_clean_title(text: &str) -> String {
    // 1. Extract command name from <command-message>...</command-message>
    if let Some(start) = text.find("<command-message>") {
        let after = &text[start + "<command-message>".len()..];
        if let Some(end) = after.find("</command-message>") {
            let cmd_name = after[..end].trim();
            if !cmd_name.is_empty() {
                return humanize_slug(cmd_name);
            }
        }
    }

    // 2. Detect terminal output: extract the command from shell prompt lines
    if let Some(cmd) = detect_shell_command(text) {
        return cmd;
    }

    // 3. Pre-process: clean terminal noise line by line (before XML stripping)
    let preprocessed = clean_terminal_lines(text);

    // 4. Remove <local-command-caveat>...</local-command-caveat> blocks (skill preambles)
    let mut cleaned = preprocessed;
    while let Some(start) = cleaned.find("<local-command-caveat>") {
        if let Some(end) = cleaned[start..].find("</local-command-caveat>") {
            cleaned.replace_range(start..start + end + "</local-command-caveat>".len(), "");
        } else {
            // Unclosed tag — remove from start to end of string
            cleaned.truncate(start);
            break;
        }
    }

    // 5. Remove <command-name>...</command-name> blocks
    while let Some(start) = cleaned.find("<command-name>") {
        if let Some(end) = cleaned[start..].find("</command-name>") {
            cleaned.replace_range(start..start + end + "</command-name>".len(), "");
        } else {
            break;
        }
    }

    // 6. Strip any remaining XML/HTML tags
    let mut result = String::with_capacity(cleaned.len());
    let mut in_tag = false;
    for ch in cleaned.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }

    // 7. Clean up whitespace
    let trimmed = result.trim().replace('\n', " ");
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");

    // 8. Strip remaining terminal noise from the collapsed title
    strip_terminal_noise(&collapsed)
}

// ---------------------------------------------------------------------------
// Terminal output detection & cleaning
// ---------------------------------------------------------------------------

/// Shell prompt characters that are unambiguous (almost exclusively prompt markers).
const UNICODE_PROMPT_CHARS: &[char] = &['➜', '❯', '❮', 'λ', '›'];

/// Detect a shell command from terminal output.
/// Looks for lines starting with common shell prompt characters and extracts the command.
///
/// Examples:
/// - `"➜ pnpm tauri dev\n> agtower@0.1.0 ..."` → Some("pnpm tauri dev")
/// - `"$ git status\nOn branch main..."` → Some("git status")
/// - `"fix the bug in session names"` → None
fn detect_shell_command(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Check unicode prompt chars at start of line (unambiguous)
        for &ch in UNICODE_PROMPT_CHARS {
            if trimmed.starts_with(ch) {
                let cmd = trimmed[ch.len_utf8()..].trim();
                if !cmd.is_empty() {
                    return Some(cmd.to_string());
                }
            }
        }

        // Check "$ command" or "% command" at start of line
        if trimmed.starts_with("$ ") || trimmed.starts_with("% ") {
            let cmd = trimmed[2..].trim();
            if !cmd.is_empty() {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

/// Pre-process text line by line to remove terminal noise before XML stripping.
/// Strips prompt chars, npm script output lines, and bare file paths.
fn clean_terminal_lines(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Detect and skip npm/pnpm script output: "> package@version script /path"
        if trimmed.starts_with('>') {
            let after_gt = trimmed['>'.len_utf8()..].trim_start();
            if is_npm_script_output(after_gt) {
                continue;
            }
        }

        // Strip prompt characters from the beginning
        let cleaned = strip_leading_prompt(trimmed);

        // Skip bare absolute file paths
        if cleaned.starts_with('/') && !cleaned.contains(' ') {
            continue;
        }

        if !cleaned.is_empty() {
            lines.push(cleaned.to_string());
        }
    }

    if lines.is_empty() {
        text.to_string()
    } else {
        lines.join("\n")
    }
}

/// Strip shell prompt characters from the start of a line.
fn strip_leading_prompt(line: &str) -> &str {
    let trimmed = line.trim();

    // Unicode prompt chars at start of line
    for &ch in UNICODE_PROMPT_CHARS {
        if trimmed.starts_with(ch) {
            let rest = trimmed[ch.len_utf8()..].trim_start();
            if !rest.is_empty() {
                return rest;
            }
        }
    }

    // ASCII prompt chars at start of line: "$ cmd", "% cmd", "# cmd"
    for prefix in &["$ ", "% ", "# "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let cmd = rest.trim_start();
            if !cmd.is_empty() {
                return cmd;
            }
        }
    }

    trimmed
}

/// Check if text looks like npm/pnpm/yarn script output.
/// Pattern: "package@version scriptname /absolute/path"
/// e.g., "agtower@0.1.0 tauri /Users/dev/projects/..."
fn is_npm_script_output(text: &str) -> bool {
    if !text.contains('@') {
        return false;
    }
    match text.split_whitespace().next() {
        Some(first) => first.contains('@') && first.chars().any(|c| c.is_ascii_digit()),
        None => false,
    }
}

/// Remove remaining terminal noise from a collapsed single-line title.
/// Strips npm script patterns and bare absolute paths.
fn strip_terminal_noise(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut result: Vec<&str> = Vec::new();

    let mut i = 0;
    while i < words.len() {
        let word = words[i];

        // Skip npm script output: "package@version" possibly followed by scriptname and path
        if word.contains('@') && word.chars().any(|c| c.is_ascii_digit()) {
            // "pkg@ver /path" — skip both
            if i + 1 < words.len() && words[i + 1].starts_with('/') {
                i += 2;
                continue;
            }
            // "pkg@ver scriptname /path" — skip all three
            if i + 2 < words.len() && words[i + 2].starts_with('/') {
                i += 3;
                continue;
            }
            // Bare "pkg@ver" — skip
            i += 1;
            continue;
        }

        // Skip bare absolute paths
        if word.starts_with('/') && word.len() > 4 {
            i += 1;
            continue;
        }

        result.push(word);
        i += 1;
    }

    let joined = result.join(" ");
    if joined.is_empty() {
        text.to_string()
    } else {
        joined
    }
}

#[derive(Serialize, Clone)]
pub(crate) struct DiscoveredCliSession {
    pub session_id: String,
    pub project_path: String,
    pub title: String,
    pub git_branch: Option<String>,
    pub model: Option<String>,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub message_count: u32,
    pub provider_file_path: String,
    /// True if the JSONL file was modified within the last 60 seconds (session likely active).
    pub is_active: bool,
}

/// Scan ~/.claude/projects/ for CLI sessions.
/// Returns metadata extracted from the first few lines of each .jsonl file.
#[tauri::command]
pub(crate) async fn scan_cli_sessions() -> Result<Vec<DiscoveredCliSession>, String> {
    tauri::async_runtime::spawn_blocking(scan_cli_sessions_sync)
        .await
        .map_err(|e| format!("Scan task failed: {}", e))?
}

fn scan_cli_sessions_sync() -> Result<Vec<DiscoveredCliSession>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let projects_dir = home.join(".claude").join("projects");

    if !projects_dir.is_dir() {
        return Ok(vec![]);
    }

    // Collect all JSONL file paths with their modification times
    let mut jsonl_files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    let project_entries =
        fs::read_dir(&projects_dir).map_err(|e| format!("Failed to read projects dir: {}", e))?;

    for project_entry in project_entries.flatten() {
        let project_dir = project_entry.path();
        if !project_dir.is_dir() {
            continue;
        }

        let jsonl_entries = match fs::read_dir(&project_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in jsonl_entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if path.is_dir() {
                continue;
            }
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            jsonl_files.push((path, mtime));
        }
    }

    // Sort by modification time, most recent first
    jsonl_files.sort_by_key(|(_, mtime)| Reverse(*mtime));

    let mut discovered = Vec::new();
    for (path, _) in &jsonl_files {
        match parse_jsonl_metadata(path) {
            Ok(Some(session)) => discovered.push(session),
            Ok(None) => {}
            Err(e) => {
                eprintln!("[discovery] Failed to parse {}: {}", path.display(), e);
            }
        }
    }

    Ok(discovered)
}

fn parse_jsonl_metadata(path: &PathBuf) -> Result<Option<DiscoveredCliSession>, String> {
    let file =
        fs::File::open(path).map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;

    let reader = BufReader::new(&file);

    let mut session_id: Option<String> = None;
    let mut project_path: Option<String> = None;
    let mut title: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut model: Option<String> = None;
    let mut created_at: Option<i64> = None;
    let mut message_count: u32 = 0;

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match entry_type {
            "user" => {
                message_count += 1;

                // Extract metadata from first user message
                if session_id.is_none() {
                    session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    project_path = parsed.get("cwd").and_then(|v| v.as_str()).map(String::from);

                    git_branch = parsed
                        .get("gitBranch")
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    // Extract title from first user message content
                    let content = parsed.get("message").and_then(|m| m.get("content"));
                    if let Some(content_val) = content {
                        let text = if let Some(s) = content_val.as_str() {
                            s.to_string()
                        } else if let Some(arr) = content_val.as_array() {
                            // Content can be an array of content blocks
                            arr.iter()
                                .filter_map(|block| {
                                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        block.get("text").and_then(|t| t.as_str()).map(String::from)
                                    } else {
                                        None
                                    }
                                })
                                .collect::<Vec<_>>()
                                .join(" ")
                        } else {
                            String::new()
                        };

                        // Extract clean title (handles command-message, caveats, XML tags)
                        let cleaned = extract_clean_title(&text);
                        title = Some(if cleaned.len() <= 60 {
                            cleaned
                        } else {
                            let end = cleaned
                                .char_indices()
                                .map(|(i, _)| i)
                                .take_while(|&i| i <= 57)
                                .last()
                                .unwrap_or(0);
                            format!("{}...", &cleaned[..end])
                        });
                    }

                    // Parse timestamp
                    if let Some(ts_str) = parsed.get("timestamp").and_then(|v| v.as_str()) {
                        // ISO 8601 timestamp -> ms since epoch
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                            created_at = Some(dt.timestamp_millis());
                        }
                    }
                }
            }
            "assistant" => {
                message_count += 1;

                // Always capture latest model (handles fast-mode switching)
                if let Some(m) = parsed
                    .get("message")
                    .and_then(|m| m.get("model"))
                    .and_then(|v| v.as_str())
                {
                    model = Some(m.to_string());
                }
            }
            // Explicit rename via /rename command — overrides extracted title
            "custom-title" => {
                if let Some(t) = parsed.get("customTitle").and_then(|v| v.as_str()) {
                    title = Some(t.to_string());
                }
            }
            // AI-generated title — use as fallback when no custom title
            "ai-title" => {
                if let Some(t) = parsed.get("aiTitle").and_then(|v| v.as_str()) {
                    // Only override truncated first-prompt titles, never custom titles
                    if title.as_deref().is_some_and(|t| t.ends_with("...")) || title.is_none() {
                        title = Some(t.to_string());
                    }
                }
            }
            _ => {
                // progress, file-history-snapshot, system, etc. -- skip for metadata
            }
        }
    }

    // Must have at least session_id and project_path to be valid
    let session_id = match session_id {
        Some(id) => id,
        None => return Ok(None),
    };
    let project_path = match project_path {
        Some(p) => p,
        None => return Ok(None),
    };

    // Get file modification time for last_activity_at
    let last_activity_at = fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|| created_at.unwrap_or(0));

    Ok(Some(DiscoveredCliSession {
        session_id,
        project_path,
        title: title.unwrap_or_else(|| "Untitled CLI session".to_string()),
        git_branch,
        model,
        created_at: created_at.unwrap_or(0),
        last_activity_at,
        message_count,
        provider_file_path: path.to_string_lossy().to_string(),
        is_active: fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|elapsed| elapsed < std::time::Duration::from_secs(60)),
    }))
}

// ---------------------------------------------------------------------------
// Session metadata extraction from JSONL
// ---------------------------------------------------------------------------

/// Extract structured metadata from a Claude CLI session's JSONL file.
/// Matches by session ID, or by timestamp proximity to `session_created_at`.
#[tauri::command]
pub(crate) async fn extract_session_metadata(
    repo_path: String,
    provider_session_id: Option<String>,
    session_created_at: Option<i64>,
) -> Result<SessionMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_session_metadata_sync(
            &repo_path,
            provider_session_id.as_deref(),
            session_created_at,
        )
    })
    .await
    .map_err(|e| format!("Extract task failed: {}", e))?
}

/// Check whether a Claude CLI conversation file still exists for this session.
/// When `session_id` is provided, verify that exact JSONL exists (matches the
/// `--resume <id>` path). When it isn't, verify the project dir has *any*
/// JSONL — that's what `--continue` falls back to. Returns false only when we
/// know the resume target is gone.
pub(crate) fn claude_session_file_exists(repo_path: &str, session_id: Option<&str>) -> bool {
    let Some(home) = dirs::home_dir() else {
        return true; // can't verify → assume OK
    };
    let project_dir = home
        .join(".claude")
        .join("projects")
        .join(repo_path.replace('/', "-"));
    if !project_dir.is_dir() {
        return false;
    }
    if let Some(sid) = session_id {
        if !sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return true; // malformed id → don't delete on our account
        }
        if project_dir.join(format!("{}.jsonl", sid)).is_file() {
            return true;
        }
        return matches!(find_jsonl_by_session_id(&project_dir, sid), Ok(Some(_)));
    }
    // No session id → `--continue` path. Any JSONL in the project dir is a
    // resumable conversation.
    let Ok(entries) = fs::read_dir(&project_dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
}

pub(crate) fn extract_session_metadata_sync(
    repo_path: &str,
    provider_session_id: Option<&str>,
    session_created_at: Option<i64>,
) -> Result<SessionMetadata, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let projects_dir = home.join(".claude").join("projects");

    let encoded_path = repo_path.replace('/', "-");
    let project_dir = projects_dir.join(&encoded_path);

    if !project_dir.is_dir() {
        return Err("No matching project directory found".to_string());
    }

    // Find the target JSONL file
    let provider_file_path = if let Some(sid) = provider_session_id {
        // Validate session ID format (UUID: alphanumeric + hyphens only)
        if !sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid session ID format".to_string());
        }
        // Best case: direct filename match
        let direct = project_dir.join(format!("{}.jsonl", sid));
        if direct.is_file() {
            Some(direct)
        } else {
            find_jsonl_by_session_id(&project_dir, sid)?
        }
    } else if let Some(created_at) = session_created_at {
        // No session ID yet — match by timestamp proximity.
        // Find the JSONL whose file modification time is closest to
        // (and within 60s after) our session's creation time.
        find_jsonl_by_timestamp(&project_dir, created_at)?
    } else {
        find_most_recent_jsonl(&project_dir)?
    };

    let provider_file_path =
        provider_file_path.ok_or_else(|| "No JSONL file found for this session".to_string())?;

    parse_session_metadata(&provider_file_path)
}

/// Find the JSONL file whose creation/modification time is closest to the
/// given timestamp (epoch millis). Looks for files created within 60s after.
fn find_jsonl_by_timestamp(
    project_dir: &std::path::Path,
    target_ms: i64,
) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(project_dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    let mut best: Option<(PathBuf, i64)> = None; // (path, abs_diff)

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if path.is_dir() {
            continue;
        }

        // Get file modification time as epoch millis
        let file_ms = fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        // Also read the first entry's timestamp for more precise matching
        let first_entry_ms = read_first_timestamp(&path).unwrap_or(file_ms);

        // The JSONL should be created AFTER our session started (within 60s)
        let diff = first_entry_ms - target_ms;
        if (-5000..=60000).contains(&diff) {
            let abs_diff = diff.unsigned_abs() as i64;
            if best.as_ref().is_none_or(|(_, bd)| abs_diff < *bd) {
                best = Some((path, abs_diff));
            }
        }
    }

    Ok(best.map(|(p, _)| p))
}

/// Read the timestamp from the first entry in a JSONL file.
fn read_first_timestamp(path: &PathBuf) -> Option<i64> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(10).flatten() {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: serde_json::Value = serde_json::from_str(&line).ok()?;
        if let Some(ts_str) = parsed.get("timestamp").and_then(|v| v.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                return Some(dt.timestamp_millis());
            }
        }
    }
    None
}

fn find_jsonl_by_session_id(
    project_dir: &std::path::Path,
    session_id: &str,
) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(project_dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if path.is_dir() {
            continue;
        }
        // Quick check: read first few lines for matching sessionId
        if let Ok(file) = fs::File::open(&path) {
            let reader = BufReader::new(file);
            for line in reader.lines().take(5).flatten() {
                if line.contains(session_id) {
                    return Ok(Some(path));
                }
            }
        }
    }
    Ok(None)
}

fn find_most_recent_jsonl(project_dir: &std::path::Path) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(project_dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if path.is_dir() {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if newest.as_ref().is_none_or(|(_, t)| modified > *t) {
                    newest = Some((path, modified));
                }
            }
        }
    }

    Ok(newest.map(|(p, _)| p))
}

fn parse_session_metadata(path: &PathBuf) -> Result<SessionMetadata, String> {
    let file =
        fs::File::open(path).map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    let reader = BufReader::new(file);

    let mut model: Option<String> = None;
    let mut slug: Option<String> = None;
    // Exact title from an explicit `/rename` in the Claude CLI. Tracked
    // separately from `slug` so an explicit user rename can override even a
    // non-auto AgTower title (see engine::session_store auto-title block).
    let mut custom_title: Option<String> = None;
    // When that `/rename` happened (epoch ms), used to settle recency against
    // a sidebar rename. Captured alongside `custom_title` so the latest wins.
    let mut custom_title_at: Option<i64> = None;
    let mut num_turns: u32 = 0;
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut total_cache_read_tokens: u64 = 0;
    let mut total_cache_write_tokens: u64 = 0;
    let mut provider_session_id: Option<String> = None;

    // Claude Code writes multiple assistant JSONL entries per API call (one per
    // content block: thinking, text, tool_use).  Each carries the full
    // message-level usage, so naively summing every entry overcounts by ~1.5-2x.
    // We track a "pending" usage that gets REPLACED on each consecutive assistant
    // entry, and only commit (add) it to the totals when the run of assistant
    // entries is interrupted by a non-assistant entry or EOF.
    let mut pending_inp: u64 = 0;
    let mut pending_out: u64 = 0;
    let mut pending_cr: u64 = 0;
    let mut pending_cw: u64 = 0;
    let mut in_assistant_run = false;

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Flush pending usage when leaving an assistant run.
        if entry_type != "assistant" && in_assistant_run {
            total_input_tokens += pending_inp;
            total_output_tokens += pending_out;
            total_cache_read_tokens += pending_cr;
            total_cache_write_tokens += pending_cw;
            pending_inp = 0;
            pending_out = 0;
            pending_cr = 0;
            pending_cw = 0;
            in_assistant_run = false;
        }

        match entry_type {
            "user" => {
                num_turns += 1;
                if provider_session_id.is_none() {
                    provider_session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
            }
            "assistant" => {
                // Extract model
                if model.is_none() {
                    model = parsed
                        .get("message")
                        .and_then(|m| m.get("model"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
                // Track token usage — REPLACE pending (not accumulate) since
                // consecutive assistant entries are content blocks from the same
                // API call carrying duplicate message-level usage.
                if let Some(usage) = parsed.get("message").and_then(|m| m.get("usage")) {
                    pending_inp = usage
                        .get("input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    pending_out = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    pending_cr = usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    pending_cw = usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    in_assistant_run = true;
                }
                // Extract sessionId from assistant entries too
                if provider_session_id.is_none() {
                    provider_session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
                // Always update slug — /rename changes it, we want the latest
                if let Some(s) = parsed.get("slug").and_then(|v| v.as_str()) {
                    slug = Some(s.to_string());
                }
            }
            // Explicit rename via the `/rename` command. Mirrors the scan-path
            // parser (parse_jsonl_metadata) — last write wins, same as slug.
            "custom-title" => {
                if let Some(t) = parsed.get("customTitle").and_then(|v| v.as_str()) {
                    custom_title = Some(t.to_string());
                    // Capture the rename's timestamp (if any) so the auto-title
                    // logic can compare it against a sidebar rename's recency.
                    custom_title_at = parsed
                        .get("timestamp")
                        .and_then(|v| v.as_str())
                        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
                        .map(|dt| dt.timestamp_millis());
                }
            }
            _ => {
                // Always update slug from progress/system/any entries
                if let Some(s) = parsed.get("slug").and_then(|v| v.as_str()) {
                    slug = Some(s.to_string());
                }
                // Extract sessionId from any entry
                if provider_session_id.is_none() {
                    provider_session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
            }
        }
    }

    // Flush any remaining pending usage at EOF.
    if in_assistant_run {
        total_input_tokens += pending_inp;
        total_output_tokens += pending_out;
        total_cache_read_tokens += pending_cr;
        total_cache_write_tokens += pending_cw;
    }

    Ok(SessionMetadata {
        model,
        slug,
        custom_title,
        custom_title_at,
        num_turns,
        total_input_tokens,
        total_output_tokens,
        total_cache_read_tokens,
        total_cache_write_tokens,
        provider_session_id,
        provider_file_path: Some(path.to_string_lossy().to_string()),
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_shell_command_arrow() {
        let input = "➜ pnpm tauri dev\n> agtower@0.1.0 tauri /Users/dev/projects\n> tauri dev";
        assert_eq!(detect_shell_command(input), Some("pnpm tauri dev".into()));
    }

    #[test]
    fn test_detect_shell_command_dollar() {
        assert_eq!(
            detect_shell_command("$ git status\nOn branch main"),
            Some("git status".into())
        );
    }

    #[test]
    fn test_detect_shell_command_chevron() {
        assert_eq!(
            detect_shell_command("❯ cargo build"),
            Some("cargo build".into())
        );
    }

    #[test]
    fn test_detect_shell_command_none_for_normal_text() {
        assert_eq!(detect_shell_command("fix the bug in session names"), None);
    }

    #[test]
    fn test_is_npm_script_output() {
        assert!(is_npm_script_output(
            "agtower@0.1.0 tauri /Users/dev/projects"
        ));
        assert!(is_npm_script_output("vite@5.0.0 dev /home/user/project"));
        assert!(!is_npm_script_output("fix the bug"));
        assert!(!is_npm_script_output("user@host command"));
    }

    #[test]
    fn test_extract_clean_title_terminal_output() {
        let input =
            "➜ pnpm tauri dev\n> agtower@0.1.0 tauri /Users/dev/projects/agtower\n> tauri dev";
        assert_eq!(extract_clean_title(input), "pnpm tauri dev");
    }

    #[test]
    fn test_extract_clean_title_command_message() {
        let input = "<command-message>check-submissions</command-message>";
        assert_eq!(extract_clean_title(input), "Check Submissions");
    }

    #[test]
    fn test_extract_clean_title_normal_prompt() {
        let input = "add a dark mode toggle to the settings page";
        assert_eq!(
            extract_clean_title(input),
            "add a dark mode toggle to the settings page"
        );
    }

    #[test]
    fn test_strip_terminal_noise_removes_pkg_version_and_path() {
        // "agtower@0.1.0 tauri /Users/..." is a full npm script line: pkg@ver script /path
        assert_eq!(
            strip_terminal_noise("Running agtower@0.1.0 tauri /Users/dev/projects"),
            "Running"
        );
    }

    #[test]
    fn test_strip_terminal_noise_preserves_normal_text() {
        assert_eq!(
            strip_terminal_noise("fix the bug in session names"),
            "fix the bug in session names"
        );
    }

    #[test]
    fn test_strip_terminal_noise_removes_paths() {
        assert_eq!(
            strip_terminal_noise("error in /Users/dev/projects/project/file.ts"),
            "error in"
        );
    }

    #[test]
    fn test_clean_terminal_lines_skips_npm_output() {
        let input =
            "> agtower@0.1.0 tauri /Users/dev/projects\nRunning dev server\n> vite@5.0.0 dev /path";
        let result = clean_terminal_lines(input);
        assert_eq!(result, "Running dev server");
    }
}
