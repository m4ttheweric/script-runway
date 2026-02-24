# Changelog

## [1.3.1] — 2026-02-23

Updated readme with full feature documentation, script icon reference table, and VS Code Marketplace badge.

## [1.3.0] — 2026-02-23

### New features

- **Stop button** — inline `$(debug-stop)` action replaces the play button while a script is running; click to send Ctrl+C and immediately update the UI
- **Amber running indicator** — label text is tinted `list.warningForeground` (amber/orange) via `FileDecorationProvider` while a script is active
- **Always-visible `▶` badge** — git-style badge appended to the label so the running state is visible without hovering
- **Shell integration detection** — scripts are now launched via VS Code shell integration's `executeCommand`, enabling automatic detection of process exits via `onDidEndTerminalShellExecution`; Ctrl+C in the terminal, crashes, and natural exits all correctly clear the running state
- **Fallback** — if shell integration is not available, `sendText` is used after a 3-second grace period

### Improvements

- Removed the red square `running-indicator.svg` item icon in favour of the cleaner badge + label tint approach
- Stop and play buttons are now mutually exclusive using `runnable-idle` / `runnable-active` context values, fixing an issue where both buttons appeared simultaneously while running

## [1.2.0] — 2026-02-23

### New features
- **Live file watching** — package.json scripts and directory sources update automatically when files change; no manual refresh needed
- **Double-click to run** — double-click any script to run it; double-click again to stop it
- **Single-click terminal focus** — single-clicking a script with an active terminal brings it into focus
- **Running indicator** — scripts with an active terminal show a red stop icon; tooltip updates to "Running — double-click to stop"
- **Open in System Terminal** — right-click any script to run it in your preferred native terminal app (Terminal, Warp, iTerm, iTerm2); configurable via `runway.systemTerminalApp` setting
- **Open Source File** — right-click to jump directly to the source file; npm scripts jump to their exact line in package.json
- **Script icons** — well-known script names (dev, build, test, lint, format, deploy, etc.) get distinct emoji icons
- **PM detection from scripts** — package manager is now also inferred from canonical lifecycle script commands when no lock file or `packageManager` field is present
- **Explorer panel support** — the view can be moved to the Explorer sidebar alongside Outline and Timeline

### Improvements
- Real package manager logos for npm, pnpm, yarn, and bun group headers
- Revamped shell script category icon
- `$(debug-stop)` replaced with a purpose-built red SVG running indicator that works across all themes
- Database icon for db/migrate/seed scripts
- Bumped minimum VS Code engine to `^1.100.0`

## [1.0.0] — 2026-02-22

Initial release.

### Features
- Sidebar panel with support for npm, pnpm, yarn, and bun package scripts
- Auto-detects package manager from lock files and `packageManager` field
- Groups package.json scripts under the project name from `pkg.name`
- Directory scanning for shell, Python, JavaScript, TypeScript, Swift, Go, Ruby, PHP, Perl, PowerShell, and Makefile scripts
- Add individual script files or entire directories as sources
- Makefile target parsing
- Per-script command overrides (persisted in workspace state)
- Per-script display name aliases
- Relative path display for in-workspace files, absolute for external
- Empty state with welcome message until sources are added
- Remove sources individually or in bulk
