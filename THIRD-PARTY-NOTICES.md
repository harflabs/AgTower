# Third-Party Notices

AgTower bundles or depends on third-party software and assets. This file
summarizes notable items; it is not an exhaustive listing of the full dependency
tree (see [`pnpm-lock.yaml`](./pnpm-lock.yaml) and
[`src-tauri/Cargo.lock`](./src-tauri/Cargo.lock) for that).

## Fonts

- **Inter** — SIL Open Font License 1.1 — https://github.com/rsms/inter
- **JetBrains Mono** — SIL Open Font License 1.1 — https://github.com/JetBrains/JetBrainsMono

Bundled via the `@fontsource-variable/*` packages.

## Provider brand assets

`public/providers/` contains logos used solely to identify the supported agent
providers within the UI:

- **Claude / Claude Code** marks are trademarks of **Anthropic**.
- **Codex / OpenAI** marks are trademarks of **OpenAI**.

These marks are the property of their respective owners and are used for
identification only; their inclusion does not imply endorsement or affiliation.

> **Maintainer note:** before distribution, confirm this usage complies with each
> owner's brand/trademark guidelines.

## Audio

- `public/welcome.mp3` — first-run welcome sound.

> **Maintainer note:** confirm the source and license of this asset and that it
> may be redistributed under this repository's MIT license — or document its
> separate license here.

## Notable dependencies

- **fix-path-env** (`src-tauri/Cargo.toml`) is pinned to a specific git revision
  of the official `tauri-apps/fix-path-env-rs` repository rather than a crates.io
  release. The pin is intentional for reproducible builds; update it deliberately.

## License

AgTower itself is released under the MIT License — see [LICENSE](./LICENSE).
