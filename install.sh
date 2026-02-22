#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="script-runner-local"

echo "→ Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent

echo "→ Compiling TypeScript..."
npm run compile

echo "→ Deploying extension..."

install_to() {
  local base="$1"
  local dest="$base/$EXT_ID"
  if [ ! -d "$base" ]; then
    return 0
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  # Copy only the runtime files — skip node_modules and source ts files
  cp package.json "$dest/"
  cp -r out "$dest/"
  cp -r images "$dest/"
  echo "  ✓ $dest"
}

install_to "$HOME/.vscode/extensions"
install_to "$HOME/.cursor/extensions"
install_to "$HOME/.cursor-personal/extensions"

echo ""
echo "Done!  Reload any open VS Code / Cursor windows to activate Script Runner."
echo "  Cmd+Shift+P → 'Developer: Reload Window'"
