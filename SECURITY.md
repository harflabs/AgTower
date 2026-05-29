# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
open the **Security** tab of this repository and click **Report a vulnerability**.

Please do **not** open a public issue for security reports.

We aim to acknowledge reports within 3 business days and to share a remediation
timeline after triage.

## Supported versions

AgTower ships as an auto-updating desktop app; only the latest released version
is supported. Please update to the latest release before reporting.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Scope / threat model

AgTower runs locally and has a few trust boundaries worth understanding when
assessing a report:

- **PTY processes** — AgTower spawns agent CLIs (Claude Code, Codex) as child
  processes via a pseudo-terminal, running with the user's own privileges.
- **Unix control socket** — a per-user socket at
  `~/Library/Application Support/com.harflabs.agtower/control.sock` (mode `0600`,
  owner-only) receives newline-delimited JSON status pushes from the bundled
  `agtower-hook` helper. Input is length-bounded and validated, and concurrent
  connections are capped.
- **Auto-updater** — releases are verified against a minisign public key embedded
  in `src-tauri/tauri.conf.json`; updates are fetched over HTTPS from GitHub
  Releases.
- **No other network egress** — no telemetry or analytics (see the Privacy
  section of the README).

Local-only issues that require an already-compromised user account are generally
out of scope, but please report anything that crosses one of these boundaries.
