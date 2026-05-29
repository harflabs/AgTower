<div align="center">

# AgTower

**Mission control for your AI coding agents.**

Monitor every agent across every repo. Respond the instant one needs you.
Keyboard-first. Tauri-fast.

[![Download for macOS](https://img.shields.io/badge/Download_for_macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/harflabs/AgTower/releases/latest)

[![CI](https://github.com/harflabs/AgTower/actions/workflows/ci.yml/badge.svg)](https://github.com/harflabs/AgTower/actions/workflows/ci.yml)

</div>

AgTower is a macOS desktop app for running and watching AI coding agents — Claude Code and Codex — across all your repos from one window. Built with Tauri v2 (Rust) + React 19.

> **Requires macOS 13+ (Apple Silicon)** and at least one agent CLI installed and authenticated: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or Codex. Intel Macs can [build from source](#build-from-source).

## Why AgTower

Running agents in parallel is table stakes — every IDE does it now. The hard part is **knowing which agent needs you right now** across 10+ sessions and multiple repos. AgTower is the oversight layer: a triage queue, not a launcher.

## What it does

- **Attention triage** — Sessions that need you auto-surface in their own sidebar section. `Cmd+J` cycles through them, `Cmd+E` marks done and advances.
- **Zero-config discovery** — Detects Claude Code and Codex sessions started anywhere (Terminal, tmux, other tools). No manual hooks or setup.
- **Dashboard + terminal** — Kanban overview grouped by status, or deep-dive into any session's live terminal. Split-screen for side-by-side monitoring.
- **Keyboard-driven** — 25+ shortcuts, vim-style `j/k` navigation, leader sequences (`g+d`, `g+s`), and a command palette (`Cmd+K`).
- **Session lifecycle** — Meaningful states (Running, Idle, Needs Attention, Closed, Archived) with full metadata — tokens, model, duration, turns, git branch — persisted to SQLite across restarts.
- **Notifications** — System tray with attention count, sound alerts, and toasts when agents finish or need input.

## Build from source

```sh
pnpm install
pnpm tauri dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, the `pnpm check` pipeline, and local packaging (`pnpm build:mac` / `pnpm build:dmg`).

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Tailwind v4, shadcn/ui |
| Terminal | xterm.js v6 (WebGL) |
| State | Zustand v5 |
| Backend | Tauri v2, Rust, tokio |
| Storage | SQLite |
| Agent | Claude Code CLI, Codex CLI |

## How it works

The Rust backend spawns agent CLIs via PTY and streams their output through Tauri channels to the React frontend. Each session is an independent process with its own xterm.js terminal, persisted to SQLite so it survives restarts. External CLI sessions are discovered with provider-specific scanners — Claude session files under `~/.claude/projects/` and Codex state under `~/.codex/`.

## Privacy

AgTower runs entirely on your machine. **No telemetry, no analytics, no crash reporting.** The only network request is the GitHub-hosted update check (handled by the Tauri updater). Your data — agent transcripts, tokens, titles, repo paths — stays local in `~/Library/Application Support/com.harflabs.agtower`, and the contents of `~/.claude/projects/` and `~/.codex/` are read locally and never leave your device.

<details>
<summary><strong>Releasing & signing (maintainers)</strong></summary>

Push a `v*` tag to trigger `.github/workflows/release-macos.yml`, which builds, signs, notarizes, and uploads the `.app.tar.gz` + DMG to a draft GitHub release. Review the draft, then publish from the GitHub UI.

```sh
git tag v1.0.1 && git push origin v1.0.1
```

The workflow expects these GitHub secrets:

- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- `TAURI_SIGNING_PRIVATE_KEY` — minisign private key for the auto-updater
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the key above

### Rotating the updater signing key

The auto-updater verifies release artifacts against the minisign public key in `src-tauri/tauri.conf.json` (`updater.pubkey`). To rotate the keypair:

```sh
mkdir -p ~/.tauri && chmod 700 ~/.tauri
PASS=$(openssl rand -base64 30 | tr -d '\n')
pnpm tauri signer generate -w ~/.tauri/agtower.key --password "$PASS" --ci -f
echo -n "$PASS" > ~/.tauri/agtower.key.password
chmod 600 ~/.tauri/agtower.key.password

# ALWAYS use `gh secret set < file` — pasting multi-line minisign keys into
# the web UI strips newlines and produces a value Tauri can't parse
# ("Missing encoded key in secret key").
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/agtower.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/agtower.key.password

# Copy the contents of agtower.key.pub into `updater.pubkey` in tauri.conf.json
cat ~/.tauri/agtower.key.pub
```

Commit the new `pubkey` before cutting the next release.

</details>

## License

MIT. See [LICENSE](./LICENSE).
