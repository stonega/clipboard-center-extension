# Clipboard Center

Native GNOME Shell 51 extension written in GJS. Use Shell's St and Clutter UI,
and reuse `MessageList.Message` for notification cards. Do not import GTK into
the Shell process; GTK/Adwaita belong in the preferences process only.

## Layout and commands

- `extension.js`, `prefs.js`: standard GNOME entry points.
- `src/`: clipboard monitoring, history model, native UI, preferences.
- `schemas/`, `stylesheet.css`, `metadata.json`: extension assets.
- `tests/`: deterministic model tests and isolated Shell integration tests.
- `scripts/`: build, install, and test automation.
- `docs/design/`, `docs/implementation/`, `docs/user/`: architecture, setup, usage.
- `examples/`, `postmortem/`: examples and incident notes when needed.
- `bun run check`: lint, model tests, schema validation.
- `bun run build`: create an installable extension ZIP in `dist/`.
- `bun run install:extension`: install for the current user.

Keep clipboard contents local and in memory. Do not log clipboard contents.
Respect sensitive MIME markers. Cancel outstanding reads and disconnect every
signal on disable. Test enable/disable cleanup in an isolated Shell session.

## CodeGraph

Prefer CodeGraph for structural questions when an index is available. Start
with `codegraph_context` or `codegraph_explore`; trust its parsed results and
do not repeat them with grep. Use `rg` for literal strings and specific files.
If the project is not initialized, ask before running `codegraph init -i`.

## Documentation and version control

Fetch current library documentation with Context7 when available: resolve the
library ID first, then query the specific concept. Use official GNOME docs and
the installed Shell source as fallback. Prefer `git` over `gh`.

Keep documentation aligned with behavior and run the checks before finishing.
