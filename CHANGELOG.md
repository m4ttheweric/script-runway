# Changelog

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
