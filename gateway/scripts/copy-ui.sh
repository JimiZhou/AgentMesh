#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
mkdir -p "$ROOT/dist"
mkdir -p "$ROOT/dist/assets/xterm"
cp "$ROOT/src/ui.html" "$ROOT/dist/ui.html"
cp "$ROOT/node_modules/xterm/lib/xterm.js" "$ROOT/dist/assets/xterm/xterm.js"
cp "$ROOT/node_modules/xterm/css/xterm.css" "$ROOT/dist/assets/xterm/xterm.css"
cp "$ROOT/node_modules/xterm-addon-fit/lib/xterm-addon-fit.js" "$ROOT/dist/assets/xterm/xterm-addon-fit.js"
echo "copied ui.html and xterm assets"
