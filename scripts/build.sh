#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
glib-compile-schemas --strict schemas
gnome-extensions pack --force --out-dir=dist --extra-source=src .
echo "Built dist/clipboard-center@stone.dev.shell-extension.zip"
