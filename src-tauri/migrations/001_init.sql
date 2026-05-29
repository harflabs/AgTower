-- Sessions table — mirrors Session TypeScript interface
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed',
  pid INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  result TEXT,
  duration_ms INTEGER,
  num_turns INTEGER,
  exit_code INTEGER,
  error TEXT,
  base_commit_sha TEXT,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cache_read_tokens INTEGER,
  total_cache_write_tokens INTEGER,
  git_branch TEXT,
  stop_reason TEXT,
  provider TEXT NOT NULL DEFAULT 'claude-code',
  provider_data TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);

-- Workspace state — simple key/value store for UI state restoration
CREATE TABLE IF NOT EXISTS workspace_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Repos. The UNIQUE constraint on `path` already creates an implicit index.
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  is_git INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  added_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
