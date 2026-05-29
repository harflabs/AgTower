# Contributing

## Development

```sh
pnpm install
pnpm tauri dev
```

## Verification

Run the full repository check before opening a PR or cutting a release:

```sh
pnpm check
```

This runs the frontend lint, dead-code scan, tests, production build, and the Rust formatting, clippy, and test suite.

For macOS packaging, use the ad-hoc signing wrapper so local bundles are valid on other Macs even before you have an Apple certificate:

```sh
pnpm build:mac
```

DMG packaging is opt-in because it depends on the local Finder/AppleScript environment:

```sh
pnpm build:dmg
```

These local scripts fall back to `APPLE_SIGNING_IDENTITY=-` when no signing identity is configured. That is fine for testing, but shipping outside your own machine still requires a `Developer ID Application` certificate plus notarization.

## Project Layout

- `src/`: React app, UI, provider integrations, and client-side state
- `src-tauri/`: Rust engine, PTY management, provider observers, and Tauri commands
- `public/`: static assets shipped with the frontend

## Style

- Keep provider-specific logic inside the provider modules rather than the shared UI layer.
- Prefer shared utilities when a setting or workflow is persisted in more than one place.
- Run `pnpm format` for frontend formatting changes. Rust formatting is handled by `cargo fmt`.
