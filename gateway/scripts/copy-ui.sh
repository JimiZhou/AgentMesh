#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
mkdir -p "$ROOT/dist"
cp "$ROOT/src/ui.html" "$ROOT/dist/ui.html"
echo "copied ui.html"
