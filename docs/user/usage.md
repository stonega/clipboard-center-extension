# Using Clipboard Center

Click the clock in the top bar. Clipboard appears above the notifications on
the left. Copy text or an image in an application to add an item.

The newest item is visible by default. The cards behind it indicate more history.
Hover over the stack to highlight it like an individual card.
Click anywhere on the stack to expand history, then scroll or use search.
The stack expands and collapses with the same smooth timing as GNOME's
notification groups, respecting your desktop animation setting.
Expanded history has a Clipboard title and a collapse button above the search.
The scrollbar stays hidden; use the mouse wheel or touchpad to scroll.
Expanded stacks show up to 10 regular items per page. When more than 10 match,
Previous and Next arrow buttons and a page count appear in the header, just
before the collapse button.
The buttons are hidden when the stack is collapsed. Searching or collapsing
returns to page 1. Favorites stay above the stack and do not count toward its pages.
Click the collapse button to return to the stack and clear the search while
keeping the menu open. Press Escape or close the menu to collapse it as well.
Keyboard users can focus the stack and press Enter or Space.
Search matches text and image format names such as `image`, `png`, or `jpeg`.

Click a card's star button in expanded history to add it to favorites. Favorites
appear as separate cards above the regular stack, including when history is
collapsed. Click a favorite to copy it directly, use its star to return it to
regular history, or use its close button to remove it. Search includes favorites.
Scroll to reach more cards when needed.

Once expanded, click a card to put its original text or image back on the clipboard. The menu
closes; return to the application and paste normally. Copying does not simulate
typing or automatically paste into an application.

The card's arrow, to the left of its favorite star, expands its preview.
An image has a larger preview that fills its frame without stretching, cropping
the edges when needed. Long text can expand to show additional lines.
The close button removes that item
from history. Removing an item does not erase the current system clipboard.

Open preferences from the Extensions app, or run
`gnome-extensions prefs clipboard-center@stone.dev`, to configure image capture,
recording, and maximum history size. Pause recording there to retain existing
history without recording new copies. The history size applies to regular items;
favorites stay until unfavorited or removed. All items share the 64 MiB memory
budget. If favorites leave too little room for a new copy, it is not recorded.

History, including favorites and original image bytes, survives screen lock,
logout, disable, and reboot. It is saved locally in
`~/.local/share/clipboard-center/history.gv` (or `$XDG_DATA_HOME/clipboard-center/history.gv`).
The directory and file are private to your account, but the data is not encrypted.
Removing an entry also removes it from the saved history. Password manager hints are respected, but applications that
do not mark secrets cannot be recognized automatically. Use pause for sensitive
work.

To disable: `gnome-extensions disable clipboard-center@stone.dev`.
To remove: `gnome-extensions uninstall clipboard-center@stone.dev`.
Uninstalling the extension leaves saved history in place. To erase it, disable
the extension and delete the `clipboard-center` directory from your user data directory.
