#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
test_dir="$(mktemp -d /tmp/clipboard-center-test.XXXXXX)"
export CLIPBOARD_CENTER_PROJECT="$project_dir"
export CLIPBOARD_CENTER_TEST_DIR="$test_dir"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_CACHE_HOME="$test_dir/cache"
export XDG_STATE_HOME="$test_dir/state"
export XDG_RUNTIME_DIR="$test_dir/runtime"
export GSETTINGS_BACKEND=keyfile
mkdir -m 700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY GNOME_SETUP_DISPLAY
extension_dir="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extension_dir/clipboard-center@stone.dev" "$extension_dir/clipboard-center-test@stone.dev"
cp extension.js prefs.js metadata.json stylesheet.css "$extension_dir/clipboard-center@stone.dev/"
cp -r src schemas "$extension_dir/clipboard-center@stone.dev/"
glib-compile-schemas --strict "$extension_dir/clipboard-center@stone.dev/schemas"
cat > "$extension_dir/clipboard-center-test@stone.dev/metadata.json" <<'JSON'
{"uuid":"clipboard-center-test@stone.dev","name":"Isolated test driver","description":"Test only","shell-version":["51"]}
JSON
cat > "$extension_dir/clipboard-center-test@stone.dev/extension.js" <<'JS'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class TestDriver extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() { global.context.unsafe_mode = false; }
}
JS
echo "Isolated Shell test artifacts: $test_dir"
dbus-run-session -- bash -euo pipefail <<'SESSION'
gsettings set org.gnome.shell enabled-extensions "['clipboard-center-test@stone.dev', 'clipboard-center@stone.dev']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.desktop.interface enable-animations true
start_shell() {
    gnome-shell --headless --wayland --no-x11 --wayland-display clipboard-center-test --virtual-monitor 1280x1000 > "$CLIPBOARD_CENTER_TEST_DIR/$1" 2>&1 &
    shell_pid=$!
    timeout 40 gdbus wait --session org.gnome.Shell
}
cleanup() {
    kill "$shell_pid" 2>/dev/null || true
    wait "$shell_pid" 2>/dev/null || true
}
trap cleanup EXIT
start_shell shell.log
export WAYLAND_DISPLAY=clipboard-center-test
python3 "$CLIPBOARD_CENTER_PROJECT/tests/shell-integration.py"
# A fresh compositor has no clipboard owner or JavaScript state from the first.
kill "$shell_pid"
wait "$shell_pid" || true
start_shell shell-restart.log
python3 "$CLIPBOARD_CENTER_PROJECT/tests/shell-integration.py" --verify-persistence
SESSION
