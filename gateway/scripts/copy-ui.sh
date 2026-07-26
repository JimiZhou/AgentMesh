#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
mkdir -p "$ROOT/dist"
mkdir -p "$ROOT/dist/assets/ui"
cp "$ROOT/src/ui.html" "$ROOT/dist/ui.html"
cp "$ROOT/src/ui/"*.css "$ROOT/dist/assets/ui/"
cp "$ROOT/src/ui/"*.js "$ROOT/dist/assets/ui/"
cp "$ROOT/src/ui/"*.svg "$ROOT/dist/assets/ui/" 2>/dev/null || true
echo "copied ui shell and ui assets"
