# Runway

**Run any script from a smart sidebar panel — npm, shell, Python, Swift, Go, and more.**

Runway gives you a dedicated sidebar for all the scripts in your project. Add package.json files, directories, or individual script files and run them with a single click. No more digging through package.json or remembering long commands.

---

## Features

### One-click script running
Click any script to open a named terminal and run it instantly.

### Smart package.json support
Add any `package.json` and Runway automatically:
- Uses the project's **`name`** field as the group heading
- Detects the right package manager — **npm**, **pnpm**, **yarn**, or **bun** — from lock files and the `packageManager` field
- Runs scripts with the correct command (`pnpm run dev`, `bun run build`, etc.)

### Multi-language script detection
Add a directory and Runway finds and categorizes scripts by type:

| Category | Extensions | Runner |
|---|---|---|
| Shell Scripts | `.sh` `.bash` `.zsh` | `bash` |
| Python Scripts | `.py` | `python3` |
| JavaScript Scripts | `.js` `.mjs` `.cjs` | `node` |
| TypeScript Scripts | `.ts` | `npx tsx` |
| Swift Scripts | `.swift` | `swift` |
| Go Scripts | `.go` | `go run` |
| Ruby Scripts | `.rb` | `ruby` |
| PHP Scripts | `.php` | `php` |
| Perl Scripts | `.pl` | `perl` |
| PowerShell Scripts | `.ps1` | `pwsh` |
| Makefile | `Makefile` | `make` |

### Command overrides
Right-click any script → **Set Command Override** to permanently replace the command. Add flags, env vars, or change the binary entirely. The original command is always shown in the tooltip.

### Display name aliases
Right-click → **Set Display Name** to give any script a friendly label (e.g. rename `build` to `Build & Install`). The original name stays visible as secondary text.

### Explicit, opt-in sources
Runway starts empty. You add exactly what you want — no surprise scripts from deep inside `node_modules`.

### Relative paths
Scripts inside your workspace show as short relative paths. Scripts added from outside show their full absolute path.

---

## Getting Started

1. Open the **Runway** panel from the activity bar (the sidebar icon)
2. Click **+** and choose:
   - **Add package.json** — pick one or more `package.json` files
   - **Add Directory** — scan a folder for all supported script types
   - **Add Script File** — add a single script file
3. Click any script to run it

---

## Commands

| Action | How |
|---|---|
| Run a script | Click the row, or right-click → Run Script |
| Override the command | Right-click → Set Command Override... |
| Clear an override | Right-click → Clear Override |
| Set a display name | Right-click → Set Display Name... |
| Remove a source | Right-click a group header → Remove |
| Remove multiple sources | Click **+** → Remove Sources... |
| Refresh the list | Click the refresh button in the panel header |

---

## Tips

- **Monorepos**: add each sub-package's `package.json` separately — each gets its own named group
- **Override + display name together**: set a custom command *and* a friendly label to fully control how a script appears and runs
- **External scripts**: add script files from outside your workspace — they show their full path so you always know where they live
- All overrides and display names are saved per-workspace and persist across reloads

---

## Requirements

The relevant runtime must be available in your `PATH`:
- Python scripts require `python3`
- TypeScript scripts require `npx tsx` (or install `tsx` globally)
- Swift scripts require the Swift toolchain
- Go scripts require the Go toolchain
- PowerShell scripts require `pwsh`

---

## License

MIT
