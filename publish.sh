#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_FILE="$SCRIPT_DIR/token"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "❌ No 'token' file found. Create one containing your VS Code Marketplace PAT."
  exit 1
fi

PAT="$(tr -d '[:space:]' < "$TOKEN_FILE")"

if [[ -z "$PAT" ]]; then
  echo "❌ 'token' file is empty."
  exit 1
fi

cd "$SCRIPT_DIR"

echo "🔨 Compiling..."
npm run compile

echo "📦 Publishing to VS Code Marketplace..."
npx @vscode/vsce publish --pat "$PAT"

echo "✅ Done!"
