<div align="center">
  <img src="images/icon.png" width="128" alt="Runway icon" />

# Runway

**Run any script from a smart sidebar panel — npm, shell, Python, Swift, Go, and more.**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/m4ttheweric.runway?label=VS%20Code%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=m4ttheweric.runway)

</div>

Runway gives you a dedicated sidebar for all the scripts in your project. Add `package.json` files, directories, or individual script files and run them with a single click — no more digging through `package.json` or memorising long commands.

---

## Features

### One-click script running
Click any script to run it in a named terminal. Double-click a running script to stop it. Single-click a running script to bring its terminal into focus.

### Running state indicators
Active scripts are highlighted so you always know what's running:

- **Amber label** — the script name is tinted while the process is active
- **`▶` badge** — a persistent git-style badge appears to the right of the label
- **Stop button** — the inline play button swaps to a stop button on hover; click to send Ctrl+C

Runway uses VS Code's shell integration to detect when a process exits naturally, crashes, or is stopped via Ctrl+C in the terminal — not just when the terminal window is closed.

### Smart package.json support
Add any `package.json` and Runway automatically:

- Uses the project's **`name`** field as the group heading
- Shows the real **npm**, **pnpm**, **yarn**, or **bun** logo next to the group
- Detects the package manager from lock files, the `packageManager` field, or script command patterns
- Runs scripts with the correct command (`pnpm run dev`, `bun run build`, etc.)

### Script icons
Well-known script names get distinct icons so you can find what you need at a glance:

| Icon | Script names |
|---|---|
| ⚡ | `dev`, `start`, `serve`, `server` |
| 📦 | `build`, `compile`, `bundle` |
| 🧪 | `test`, `spec`, `e2e` |
| 💅 | `lint`, `eslint`, `format`, `prettier` |
| 🔍 | `typecheck`, `tsc`, `types` |
| 🧹 | `clean`, `reset` |
| 🚀 | `deploy`, `release`, `publish` |
| 👀 | `watch`, `preview` |
| 🗄️ | `db`, `migrate`, `seed` |
| ✨ | `generate`, `gen`, `scaffold` |
| 📚 | `docs`, `storybook` |
| 📥 | `install`, `setup`, `bootstrap` |

### Multi-language script detection
Add a directory and Runway finds and categorises scripts by type:

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
Right-click → **Set Display Name** to give any script a friendly label (e.g. rename `build:prod` to `Production Build`). The original name stays visible as secondary text.

### Open in system terminal
Right-click any script → **Open in [Terminal App]** to run it in your preferred native terminal. Configure the app under **Settings → runway.systemTerminalApp** — supports Terminal, Warp, iTerm, and iTerm2.

### Live file watching
Scripts update automatically when `package.json` files change or new files are added to watched directories — no manual refresh needed.

### Explicit, opt-in sources
Runway starts empty. You add exactly what you want — no surprise scripts from deep inside `node_modules`.

---

## Getting Started

1. Open the **Runway** panel from the activity bar
2. Click **+** and choose:
   - **Add package.json** — pick one or more `package.json` files
   - **Add Directory** — scan a folder for all supported script types
   - **Add Script File** — add a single script file
3. Click any script to run it

---

## Commands & interactions

| Action | How |
|---|---|
| Run a script | Click the row, or right-click → **Run Script** |
| Stop a running script | Click the **⏹** stop button (hover), or double-click the script |
| Focus a running terminal | Single-click a running script |
| Open in system terminal | Right-click → **Open in [App]** |
| Open source file | Right-click → **Open Source File** |
| Override the command | Right-click → **Set Command Override...** |
| Clear an override | Right-click → **Clear Override** |
| Set a display name | Right-click → **Set Display Name...** |
| Remove a source | Right-click a group header → **Remove** |
| Remove multiple sources | Click **+** → **Remove Sources...** |
| Refresh the list | Click the refresh button in the panel header |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `runway.systemTerminalApp` | `Terminal` | macOS terminal app to use for **Open in System Terminal** (`Terminal`, `Warp`, `iTerm`, `iTerm2`) |

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
