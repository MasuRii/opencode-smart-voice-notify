# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-06-11

A compatibility and polish release. Adds full OpenCode SDK v1/v2 client shape support, voice caching, VS Code focus detection, config hot-reload, and brings all dependencies up to date.

### Added

- **Voice caching** — TTS audio can now be cached to disk (`enableVoiceCache`, `voiceCacheDir`, `voiceCacheMaxSizeMB`) to avoid redundant synthesis for repeated messages.
- **VS Code focus detection** — Focus detection now recognises VS Code, VS Code Insiders, and VSCodium across Windows, macOS, and Linux, suppressing notifications when the integrated terminal is focused.
- **Config hot-reload** — The plugin detects changes to `smart-voice-notify.jsonc` via file signature (mtime + size) and refreshes configuration without requiring a restart.
- **OpenCode SDK v2 client shape support** — `session.get` and `tui.showToast` now auto-detect v1/v2 API shapes and fall back gracefully, ensuring compatibility with both `@opencode-ai/plugin` v1.x and v2.x surfaces.
- **Expanded `Session` and `TUIToastPayload` types** — SDK types now cover `slug`, `workspaceID`, `path`, `agent`, `model`, `cost`, `tokens`, `share`, and toast `directory`/`workspace` fields present in newer SDK versions.

### Changed

- **Version bumped** from `1.3.3` to `1.4.0`.
- **Dependencies updated**:
  - `@elevenlabs/elevenlabs-js` → `^2.52.0`
  - `detect-terminal` → `^3.0.0`
  - `msedge-tts` → `^2.0.5`
  - `@types/node` → `^22.19.21`
  - `bun-types` → `^1.3.14`
  - `typescript` → `^6.0.3`
- **TypeScript 6 compatibility** — Added `"ignoreDeprecations": "6.0"` to `tsconfig.json` to silence the `baseUrl` deprecation introduced in TypeScript 6.0 without changing build behaviour.
- **`.gitignore` rewrite** — Comprehensive coverage for node_modules, OS artifacts, IDE/editor files, logs, caches, temp, coverage, build output, and local environment files. `bun.lock` is no longer ignored so lockfiles can be tracked for reproducible installs.
- **Permission/question batch windows** are now read dynamically from config (`getPermissionBatchWindowMs()` / `getQuestionBatchWindowMs()`) instead of captured once at startup.
- **README** — Added section clarifying OpenCode's built-in notifications vs. this plugin's capabilities; updated SDK version references to v1/v2 terminology.

### Housekeeping

- **Test files renamed** — Removed `issue-` prefixes from three test files: `voice-caching.test.ts`, `vscode-focus.test.ts`, `performance-regression.test.ts`. No functional changes; all 747 tests continue to pass.
- **Lockfile regenerated** with updated dependency versions.
