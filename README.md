# AgTower

[![CI](https://github.com/harflabs/agtower/actions/workflows/ci.yml/badge.svg)](https://github.com/harflabs/agtower/actions/workflows/ci.yml)

Mission control for your AI coding agents.

Monitor every agent across every repo. Respond the instant one needs you. Keyboard-first. Tauri-fast.

Built with Tauri v2 (Rust) + React 19. Supports Claude Code CLI and Codex.

## Why AgTower

Running agents in parallel is table stakes — every IDE does it now. The hard part is **knowing which agent needs you right now** across 10+ sessions and multiple repos. AgTower is the oversight layer: a triage queue, not a launcher.

## What it does

- **Attention triage** — Sessions that need you auto-surface in a dedicated sidebar section. `Cmd+J` cycles through them. `Cmd+E` marks done and advances. One keystroke to respond.
- **Zero-config session discovery** — Detects Claude Code and Codex sessions started anywhere (Terminal, tmux, other tools) using provider-specific discovery. No manual hooks or setup.
- **Dashboard + terminal duality** — Kanban overview of all sessions grouped by status, or deep-dive into any session's live terminal. Split-screen for side-by-side monitoring.
- **Keyboard-driven** — 25+ shortcuts, vim-style `j/k` navigation, leader sequences (`g+d`, `g+s`), command palette (`Cmd+K`). Everything reachable without a mouse.
- **Session lifecycle** — Sessions have meaningful states (Running, Idle, Needs Attention, Closed, Archived). Full metadata: tokens, model, duration, turns, git branch. SQLite-backed persistence across restarts.
- **Real-time streaming** — Live xterm.js terminals with scrollback, search, resize handling, and ANSI color support.
- **Desktop notifications** — System tray with attention count, sound alerts, and toasts when agents finish or need input.
- **Repo management** — Add and organize repos with color and emoji labels.

## Prerequisites

- **macOS 13 (Ventura) or later** — AgTower is a macOS-only desktop app (Apple Silicon and Intel); Windows and Linux are not supported.
- [Rust](https://rustup.rs/) (stable; see [`src-tauri/rust-toolchain.toml`](./src-tauri/rust-toolchain.toml))
- [Node.js](https://nodejs.org/) 22 (see [`.nvmrc`](./.nvmrc); Vite 8 requires 20.19+ / 22.12+)
- [pnpm](https://pnpm.io/) 11.0.8+
- At least one supported provider CLI installed and authenticated:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - Codex CLI

## Setup

```sh
pnpm install
pnpm tauri dev
```

Before opening a PR or cutting a release, run:

```sh
pnpm check
```

If you want to inspect Rust coverage locally with `cargo-llvm-cov` installed, run:

```sh
cargo llvm-cov --manifest-path src-tauri/Cargo.toml --all-features --html
```

To build a macOS bundle locally:

```sh
pnpm build:mac
```

That produces the release binary and a valid ad-hoc signed macOS `.app` bundle. To package an additional DMG on a local macOS GUI session, run:

```sh
pnpm build:dmg
```

These local macOS build scripts default `APPLE_SIGNING_IDENTITY` to `-`, which tells Tauri to ad-hoc sign the bundle when you have not configured an Apple certificate. That avoids the broken "app is damaged" bundle state on another Mac, but ad-hoc builds are still not notarized, so Gatekeeper may still require a manual approval step in Privacy & Security.

To distribute AgTower without Gatekeeper warnings, use a `Developer ID Application` certificate and notarization. The release workflow in `.github/workflows/release-macos.yml` runs on `v*` tags and expects these GitHub secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `TAURI_SIGNING_PRIVATE_KEY` — minisign private key for the auto-updater
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the key above

### Rotating the Tauri updater signing key

The auto-updater verifies release artifacts against the minisign public key embedded in `src-tauri/tauri.conf.json` (`updater.pubkey`). If you ever need to rotate the keypair:

```sh
mkdir -p ~/.tauri && chmod 700 ~/.tauri
PASS=$(openssl rand -base64 30 | tr -d '\n')
pnpm tauri signer generate -w ~/.tauri/agtower.key --password "$PASS" --ci -f
echo -n "$PASS" > ~/.tauri/agtower.key.password
chmod 600 ~/.tauri/agtower.key.password

# Set the GitHub secrets. ALWAYS use `gh secret set < file` — pasting
# multi-line minisign keys into the web UI strips newlines and produces
# a value Tauri can't parse ("Missing encoded key in secret key").
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/agtower.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/agtower.key.password

# Update the pubkey in tauri.conf.json with the contents of agtower.key.pub
# (the file is already in the base64 form tauri expects — just copy it in).
cat ~/.tauri/agtower.key.pub
```

Commit the new `pubkey` in `tauri.conf.json` before cutting the next release.

### Cutting a release

```sh
git tag v1.0.1 && git push origin v1.0.1
```

The `v*` tag triggers `release-macos.yml`, which builds, signs, notarizes, and uploads the `.app.tar.gz` + DMG to a draft GitHub release. Review the draft, then publish from the GitHub UI.

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

The Rust backend spawns supported agent CLIs via PTY and streams their output through Tauri channels to the React frontend. Each session is an independent process with its own xterm.js terminal. Sessions are persisted to SQLite so they survive restarts. External CLI sessions are discovered with provider-specific scanners and observers, including Claude session files under `~/.claude/projects/` and Codex state under `~/.codex/`.

## Privacy

AgTower runs entirely on your machine. It has **no telemetry, no analytics, and no crash reporting**, and makes no network requests except the GitHub-hosted update check (handled by the Tauri updater). Your data — agent transcripts, tokens, titles, repo paths — stays local in `~/Library/Application Support/com.harflabs.agtower`, and the contents of `~/.claude/projects/` and `~/.codex/` are read locally and never leave your device.

## License

MIT. See [LICENSE](./LICENSE).
