# Development and verification

Runtime: GNOME Shell 51, GJS, Mutter, St. No npm packages are imported by the
extension. Development: Bun and the pinned Biome version in `bun.lock`.

Run `bun install --frozen-lockfile`, then `bun run check`. The check command
runs the linter, deterministic history tests, and strict GSettings schema
validation. St CSS has custom properties and pseudo-classes, so the browser-only
unknown-property and unknown-pseudo-class lint rules are disabled for that file.

`bun run test:shell` uses a temporary XDG data/config/cache/state directory, a
private D-Bus session, and a headless compositor. A test-only extension enables
Shell evaluation in that compositor. Neither the test driver nor test code is
included in the distributable ZIP. The caller's desktop debugging state and
enabled extensions are unaffected.

The integration test requires Python with `gi`, GNOME Shell 51, `gdbus`, and
`wl-clipboard`. Artifacts, including `shell.log`, `collapsed.png`, and
`expanded.png`, `favorites.png`, and animation frame captures `expanding.png`
and `collapsing.png`, remain in the printed
temporary directory for inspection. Missing desktop services can produce
warnings in a headless session; extension errors and test failures must be fixed.
The test also checks intermediate animation frames, rapid direction changes,
menu closure during a transition, and the desktop's disabled-animation setting.
It disables the extension mid-transition before enabling it again.

Build using `bun run build` or `bash scripts/build.sh`. The build compiles the
schema and uses GNOME's own extension packer. Install using
`bash scripts/install.sh`. The first installation requires a new login on
Wayland because Shell discovers extension directories at startup. Updating an
already loaded JavaScript module also requires a new Shell session.

Inspect runtime state with `gnome-extensions info clipboard-center@stone.dev`.
Follow logs with `journalctl --user -f -o cat` and look for `Clipboard Center`.
The running Shell may be older than the installed binary until the next login.
