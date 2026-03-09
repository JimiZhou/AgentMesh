#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
mkdir -p "$ROOT/dist"
mkdir -p "$ROOT/dist/assets/xterm"
mkdir -p "$ROOT/dist/assets/ui"
cp "$ROOT/src/ui.html" "$ROOT/dist/ui.html"
cp "$ROOT/src/ui/"*.css "$ROOT/dist/assets/ui/"
cp "$ROOT/src/ui/"*.js "$ROOT/dist/assets/ui/"
cp "$ROOT/node_modules/xterm/lib/xterm.js" "$ROOT/dist/assets/xterm/xterm.js"
cp "$ROOT/node_modules/xterm/css/xterm.css" "$ROOT/dist/assets/xterm/xterm.css"
cp "$ROOT/node_modules/xterm-addon-fit/lib/xterm-addon-fit.js" "$ROOT/dist/assets/xterm/xterm-addon-fit.js"
echo "copied ui shell, ui assets, and xterm assets"
