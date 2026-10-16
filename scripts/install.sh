#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build.sh
gnome-extensions install --force dist/clipboard-center@stone.dev.shell-extension.zip
if gnome-extensions info clipboard-center@stone.dev >/dev/null 2>&1; then
    gnome-extensions enable clipboard-center@stone.dev
    gnome-extensions info clipboard-center@stone.dev
else
    # GNOME discovers newly installed extensions on the next Shell startup.
    gsettings set org.gnome.shell enabled-extensions "$(python3 - <<'PY'
import ast
import subprocess
value = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions'], text=True)
extensions = ast.literal_eval(value.removeprefix('@as '))
uuid = 'clipboard-center@stone.dev'
if uuid not in extensions:
    extensions.append(uuid)
print(repr(extensions))
PY
)"
    echo "Installed. Log out and back in to load Clipboard Center."
fi
