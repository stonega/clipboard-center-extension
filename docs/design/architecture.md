# Architecture

Clipboard Center is a GNOME Shell 51 extension. It uses the same St/Clutter
stack as the date menu and subclasses `MessageList.Message` for history cards.
GTK and Adwaita are used only in the separate preferences process.

## Components

- `src/extension.js` wraps the existing calendar message list in a vertical
  column. The clipboard section comes first, followed by the original notification
  actor. Disable restores that actor to its original parent and position.
- `src/clipboard.js` listens to Mutter's `Meta.Selection::owner-changed` for
  the regular clipboard only. It reads a supported MIME type into a bounded
  memory stream, hashes the bytes, and updates history. No polling is used.
- `src/history.js` provides the GNOME-independent model: MIME selection,
  sensitive markers, deduplication, ordering, favorites, searching, and memory
  eviction. Favorite status survives recapture and copying the same item.
- `src/section.js` builds the native message cards and a collapsed visual stack.
  A focusable cover expands the stack on activation, keeping the collapsed cards
  from copying or handling their controls. The cover forwards hover to the top
  card so the whole stack uses Shell's native card highlight. Card controls are
  ordered preview arrow, favorite star, then close. Expanded history shows a
  Clipboard title and Shell's native group collapse button above search. The button
  collapses history, clears search, and returns focus to the stack while keeping
  the menu open. Escape or closing the menu also collapses history and clears
  search. The scroll view uses the external scrollbar policy to hide its
  scrollbar while preserving scrolling. Favorites appear once as standalone
  message cards above the regular stack, and can be copied, unfavorited, or
  removed while the stack is collapsed. A shared scroll view bounds both
  favorites and regular history. Search filters both groups.
  Image thumbnails use `Gio.BytesIcon`; original bytes are retained for copying.
- `src/expander.js` interpolates card positions and preferred heights with an
  animatable layout property, following Shell 51's `NotificationMessageGroup`
  and `MessageGroupExpanderLayout`. Expansion and collapse use the same 200 ms
  `EASE_OUT_QUAD` timing. Cards survive toggles so their previews can collapse
  with Shell's own animation. Search and the header reveal with the stack;
  favorites stay outside it. Reversing a transition starts at its current
  progress. Closing the menu resets immediately, and disable cancels transitions.
  Shell's easing helpers respect the desktop animation setting.
- `src/preferences.js` binds the three settings to Adwaita controls.

## Clipboard lifecycle

Image formats are preferred over an accompanying plain-text representation.
Supported image formats are PNG, JPEG, WebP, BMP, and TIFF. Plain text must be
UTF-8. HTML-only, SVG-only, file-list-only, and primary selections are ignored.

Every new selection cancels the previous transfer. Requests time out after five
seconds. The reader requests one byte beyond the item limit and rejects any
oversized result, so content is never stored or restored in truncated form.
Text is limited to 1 MiB and images to 16 MiB. History evicts its oldest regular
entries when the regular item count or 64 MiB payload budget is exceeded.
Favorites are excluded from count eviction but share the payload budget. A new
capture is rejected without modifying history if it cannot fit alongside
favorites. Unfavoriting applies regular eviction immediately.

Restoring an item creates a `Meta.SelectionSourceMemory` using its original
bytes. The monitor recognizes its own source and avoids duplicate captures.
Mutter retains the active selection so it remains pasteable after disable.

All history, including favorite status, is held in process memory. Disabling disconnects signals, cancels
transfers, clears history, destroys extension actors, and restores notifications.
The extension uses the default user session mode; locking disables it and clears
history. No clipboard data is written to disk, logged, or sent to a service.

## Compatibility

Only Shell 51 is declared. The extension uses private date-menu/message-card
members for native integration; these must be checked when porting to another
Shell major version. It does not replace or patch notification methods.

References: [Shell 51 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html),
[Shell 51 notification layout](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/51.1/js/ui/messageList.js),
[Meta.Selection](https://gnome.pages.gitlab.gnome.org/mutter/meta/class.Selection.html),
[St.Clipboard](https://gnome.pages.gitlab.gnome.org/gnome-shell/st/class.Clipboard.html).
