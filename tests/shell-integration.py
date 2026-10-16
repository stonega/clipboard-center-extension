"""Exercise the real extension in an isolated headless GNOME Shell."""
import json
import glob
import os
import subprocess
import struct
import time
import zlib
from pathlib import Path

from gi.repository import Gio, GLib

PREFIX = "const Main = (await import('resource:///org/gnome/shell/ui/main.js')); const GLib = (await import('gi://GLib')).default; const ext = Main.extensionManager.lookup('clipboard-center@stone.dev').stateObj; "
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def evaluate(code, prefix=True):
    reply = connection.call_sync(
        'org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
        GLib.Variant('(s)', [f'(async () => {{ {PREFIX if prefix else ""}{code} }})()']),
        GLib.VariantType.new('(bs)'), Gio.DBusCallFlags.NONE, 15000, None,
    )
    success, value = reply.unpack()
    if not success:
        raise AssertionError(value or 'Shell is not ready for evaluation')
    return json.loads(value) if value else None


def wait_for(code):
    deadline = time.monotonic() + 25
    error = None
    while time.monotonic() < deadline:
        try:
            if evaluate(code):
                return
        except (AssertionError, GLib.Error) as caught:
            error = caught
        time.sleep(0.2)
    raise AssertionError(f'Timed out: {code}: {error}')


def check(name, code):
    assert evaluate(code), name
    print(f'PASS {name}', flush=True)


def set_text(text):
    evaluate(f"const St = (await import('gi://St')).default; St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, {json.dumps(text)});")


def point_at(actor, bottom_edge=False):
    # Allow the virtual seat to update both axes before delivering button events.
    for _ in range(2):
        evaluate(f'const actor = {actor}; const [x, y] = actor.get_transformed_position(); const [width, height] = actor.get_transformed_size(); global.clipboardCenterTestPointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + {"height - 2" if bottom_edge else "height / 2"});')
        time.sleep(0.1)


def click(actor, bottom_edge=False):
    point_at(actor, bottom_edge)
    evaluate('const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestPointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);')
    time.sleep(0.05)
    evaluate('const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestPointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);')
    time.sleep(0.2)
    wait_for('return !ext._section?._animating;')


def press_key(key):
    evaluate(f'const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestKeyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_{key}, Clutter.KeyState.PRESSED);')
    time.sleep(0.05)
    evaluate(f'const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestKeyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_{key}, Clutter.KeyState.RELEASED);')
    time.sleep(0.2)
    wait_for('return !ext._section?._animating;')


wait_for('return !!ext?._section;')
evaluate('const Clutter = (await import("gi://Clutter")).default; const seat = global.stage.context.get_backend().get_default_seat(); global.clipboardCenterTestKeyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE); global.clipboardCenterTestPointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE); Main.overview.hide(); ext._controller.clear(); Main.messageTray.getSources().forEach(source => source.destroy());')
wait_for('return !Main.layoutManager._startingUp && !Main.overview.animationInProgress;')
evaluate('await Main.extensionManager.disableExtension("clipboard-center@stone.dev"); console.log("CLIPBOARD_TEST_BASELINE_OPEN"); Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.5)
evaluate('Main.panel.statusArea.dateMenu.menu.close(); console.log("CLIPBOARD_TEST_BASELINE_CLOSE");')
time.sleep(0.3)
evaluate('await Main.extensionManager.enableExtension("clipboard-center@stone.dev");')
check('native placement above original notifications', 'return ext._column.get_child_at_index(0) === ext._section.actor && ext._column.get_child_at_index(1) === Main.panel.statusArea.dateMenu._messageList;')

set_text('Clipboard Center integration test\nSecond line 世界')
wait_for('return ext._controller.history.items.length === 1;')
check('captures multiline Unicode text', "return ext._controller.history.items[0].text.endsWith('Second line 世界');")
set_text('Another clipboard item')
wait_for('return ext._controller.history.items.length === 2;')
set_text('Clipboard Center integration test\nSecond line 世界')
wait_for("return ext._controller.history.items[0].text.startsWith('Clipboard Center');")
check('deduplicates and reorders', 'return ext._controller.history.items.length === 2;')

evaluate("ext._settings.set_boolean('paused', true);")
set_text('Must not enter history')
time.sleep(0.3)
check('pause skips copies', 'return ext._controller.history.items.length === 2;')
evaluate("ext._settings.set_boolean('paused', false);")

evaluate("const Meta = (await import('gi://Meta')).default; const source = Meta.SelectionSourceMemory.new('x-kde-passwordManagerHint', new GLib.Bytes(new TextEncoder().encode('secret'))); global.display.get_selection().set_owner(Meta.SelectionType.SELECTION_CLIPBOARD, source);")
time.sleep(0.3)
check('ignores sensitive formats', 'return ext._controller.history.items.length === 2;')

# A real, valid PNG is provided to Mutter rather than inserted into the model.
def png_chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))


width, height = 440, 220
rows = bytearray()
for y in range(height):
    rows.append(0)
    for x in range(width):
        if 60 < x < 380 and 45 < y < 175:
            rows.extend((75, 145, 230))
        else:
            rows.extend((25, 38, 62))
png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress(bytes(rows))) + png_chunk(b'IEND', b'')
artifacts = Path(os.environ['CLIPBOARD_CENTER_TEST_DIR'])
fixture = artifacts / 'fixture.png'
fixture.write_bytes(png)
evaluate(f"const St = (await import('gi://St')).default; const Gio = (await import('gi://Gio')).default; const [, data] = Gio.File.new_for_path({json.dumps(str(fixture))}).load_contents(null); St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(data));")
wait_for("return ext._controller.history.items[0]?.kind === 'image';")
check('captures exact PNG bytes', f'return ext._controller.history.items[0].bytes.get_size() === {len(png)};')
evaluate('Main.messageTray.getSources().forEach(source => source.destroy()); Main.notify("Example notification", "Clipboard history appears above your notifications.");')
time.sleep(0.3)
evaluate('console.log("CLIPBOARD_TEST_EXTENSION_OPEN"); Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.7)
check('collapsed stack has valid on-screen geometry', 'return [Main.panel.statusArea.dateMenu.menu.actor, ext._column, ext._section.actor].every(actor => { const [, min, , nat] = actor.get_preferred_size(); return min >= 0 && nat < global.stage.height; });')
check('collapsed stack stays compact', 'return ext._section._stack.height <= ext._section._items.get_first_child().height + 16;')
evaluate(f"const Shell = (await import('gi://Shell')).default; const Gio = (await import('gi://Gio')).default; const file = Gio.File.new_for_path({json.dumps(str(artifacts / 'collapsed.png'))}); const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null); await new Shell.Screenshot().screenshot(false, stream); stream.close(null);")
check('collapsed clipboard stack uses real native message cards', 'return ext._section._items.get_n_children() === 1 && ext._section._items.get_first_child().has_style_class_name("message") && ext._section._backCards.every(card => card.visible);')
check('collapsed history hides its header and search', 'return !ext._section._header.visible && !ext._section._search.visible;')

# Observe rendered geometry, rather than merely checking that a transition exists.
def sample_expansion(expanded):
    return evaluate(f'''
        const section = ext._section;
        const before = section.actor.height;
        const frames = [];
        const signal = global.stage.connect('after-paint', () => {{
            frames.push([section._items.layout_manager.expansion, section.actor.height]);
        }});
        section._setExpanded({str(expanded).lower()});
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {{
            resolve(); return GLib.SOURCE_REMOVE;
        }}));
        const Shell = (await import('gi://Shell')).default;
        const Gio = (await import('gi://Gio')).default;
        const file = Gio.File.new_for_path({json.dumps(str(artifacts / ('expanding.png' if expanded else 'collapsing.png')))});
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {{
            global.stage.disconnect(signal);
            resolve();
            return GLib.SOURCE_REMOVE;
        }}));
        return {{before, after: section.actor.height, frames}};
    ''')


expansion = sample_expansion(True)
assert expansion['before'] < expansion['after'], expansion
assert any(0 < progress < 1 and expansion['before'] < height < expansion['after']
           for progress, height in expansion['frames']), expansion
print('PASS expansion renders intermediate heights between the stack and list', flush=True)
collapse = sample_expansion(False)
assert collapse['before'] > collapse['after'], collapse
assert any(0 < progress < 1 and collapse['after'] < height < collapse['before']
           for progress, height in collapse['frames']), collapse
print('PASS collapse renders intermediate heights before restoring the compact stack', flush=True)
check('rapid reversal keeps the current layout and settles expanded', '''
    const section = ext._section;
    section._setExpanded(true);
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
    const progress = section._items.layout_manager.expansion;
    section._setExpanded(false);
    const collapseStart = section._items.layout_manager.expansion;
    section._setExpanded(true);
    const expandStart = section._items.layout_manager.expansion;
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
    return progress > 0 && progress < 1 && progress === collapseStart &&
        progress === expandStart && section._expanded && !section._animating &&
        section._items.layout_manager.expansion === 1 && section._header.visible;
''')
evaluate('ext._section._setExpanded(false);')
wait_for('return !ext._section._animating;')
check('closing the menu during expansion cancels animation and resets immediately', '''
    const section = ext._section;
    section._setExpanded(true);
    Main.panel.statusArea.dateMenu.menu.close();
    return !section._expanded && !section._animating && !section._controls.visible &&
        section._items.layout_manager.expansion === 0 &&
        !section._items.get_transition('@layout.expansion') &&
        !section._controls.get_transition('@layout.expansion');
''')
evaluate('Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
check('disabled desktop animations settle both directions immediately', '''
    const Gio = (await import('gi://Gio')).default;
    const St = (await import('gi://St')).default;
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    settings.set_boolean('enable-animations', false);
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
    const section = ext._section;
    section._setExpanded(true);
    const expanded = !St.Settings.get().enable_animations && !section._animating &&
        section._items.layout_manager.expansion === 1;
    section._setExpanded(false);
    const collapsed = !section._animating && !section._controls.visible &&
        section._items.layout_manager.expansion === 0;
    settings.set_boolean('enable-animations', true);
    return expanded && collapsed;
''')
time.sleep(0.1)
check('collapsing an open card preview reuses the native card animation', '''
    const section = ext._section;
    section._setExpanded(true, false);
    const card = section._items.get_first_child();
    card.expand(false);
    section._setExpanded(false);
    const reused = section._items.get_first_child() === card;
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
    return reused && section._items.get_first_child() === card && !card.expanded &&
        !section._animating && section._items.get_n_children() === 1;
''')
evaluate('global.clipboardCenterOriginalSelection = ext._controller._ownSource;')
click('ext._section._stack')
check('clicking the stack expands all items without copying or closing', 'return ext._section._items.get_n_children() === 3 && ext._section._search.visible && Main.panel.statusArea.dateMenu.menu.isOpen && ext._controller._ownSource === global.clipboardCenterOriginalSelection;')
check('expanded history shows a native title and accessible collapse button above search', 'const section = ext._section; return section._header.visible && section.actor.get_first_child() === section._controls && section._controls.get_first_child() === section._header && section._controls.get_child_at_index(1) === section._search && section._header.get_first_child().text === "Clipboard" && section._collapseButton.has_style_class_name("message-collapse-button") && section._collapseButton.accessible_name === "Collapse clipboard history";')
evaluate('ext._section._search.set_text("no matching clipboard item");')
click('ext._section._collapseButton')
check('collapse button clears a search with no matches and returns to the stack without copying or closing', 'const section = ext._section; return !section._expanded && !section._header.visible && !section._search.visible && section._search.get_text() === "" && section._items.get_n_children() === 1 && section._backCards.every(card => card.visible) && section._expandCover.has_key_focus() && Main.panel.statusArea.dateMenu.menu.isOpen && ext._controller._ownSource === global.clipboardCenterOriginalSelection && ext._controller.history.items.length === 3;')
press_key('Return')
check('focused stack reopens after collapsing', 'return ext._section._expanded && ext._section._header.visible && ext._section._search.clutter_text.has_key_focus();')
evaluate('ext._section._search.set_text("世界");')
press_key('Escape')
check('Escape closes the menu, collapses history, and clears search', 'return !ext._section._expanded && ext._section._search.get_text() === "" && ext._section._items.get_n_children() === 1 && !Main.panel.statusArea.dateMenu.menu.isOpen;')
evaluate('Main.panel.statusArea.dateMenu.menu.open(); ext._section._expandCover.grab_key_focus();')
time.sleep(0.3)
press_key('Return')
check('keyboard activation expands the stack', 'return ext._section._expanded && ext._section._search.clutter_text.has_key_focus();')
evaluate('ext._section._collapseButton.grab_key_focus();')
press_key('space')
check('keyboard activation collapses history and restores stack focus', 'return !ext._section._expanded && !ext._section._header.visible && ext._section._expandCover.has_key_focus() && Main.panel.statusArea.dateMenu.menu.isOpen;')
press_key('Return')
press_key('Escape')
evaluate('Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
click('ext._section._stack', bottom_edge=True)
check('clicking exposed stack edges expands history', 'return ext._section._expanded && ext._section._items.get_n_children() === 3;')
evaluate('ext._section._search.set_text("世界");')
check('search filters clipboard history', 'return ext._section._items.get_n_children() === 1 && ext._section._items.get_first_child().title.startsWith("Clipboard Center");')
evaluate('ext._section._search.set_text(""); ext._section._items.get_first_child().expand(false);')
time.sleep(0.5)
check('expanded history overflows without a visible scrollbar', 'const scroll = ext._section._scroll; return scroll.vadjustment.upper > scroll.vadjustment.page_size && !scroll.get_vscrollbar_visible() && !scroll.get_hscrollbar_visible();')
point_at('ext._section._scroll')
evaluate('const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestPointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);')
wait_for('return ext._section._scroll.vadjustment.value > 0;')
check('mouse wheel scrolls history while the scrollbar stays hidden', 'return !ext._section._scroll.get_vscrollbar_visible();')
evaluate('ext._section._scroll.vadjustment.value = 0;')

evaluate('Main.notify("Notifications stay here", "Clipboard history appears above the notification stack.");')
time.sleep(0.5)
evaluate(f"const Shell = (await import('gi://Shell')).default; const Gio = (await import('gi://Gio')).default; const file = Gio.File.new_for_path({json.dumps(str(artifacts / 'expanded.png'))}); const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null); await new Shell.Screenshot().screenshot(false, stream); stream.close(null);")
click('ext._section._items.get_first_child().titleLabel')
check('click copies image and closes menu', 'return !Main.panel.statusArea.dateMenu.menu.isOpen && ext._controller.history.items[0].kind === "image";')
check('closing the menu resets the stack', 'return !ext._section._expanded && !ext._section._header.visible && !ext._section._search.visible;')
check('copy does not duplicate own selection', 'return ext._controller.history.items.length === 3;')

# Read back the image through the same public clipboard API a consumer uses.
check('restored image has identical bytes', f"const St = (await import('gi://St')).default; const data = await new Promise(resolve => {{ St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, 'image/png', (_c, bytes) => {{ resolve(Array.from(bytes.get_data())); }}); }}); return JSON.stringify(data) === JSON.stringify({list(png)});")
assert subprocess.check_output(['wl-paste', '--type', 'image/png'], timeout=5) == png
print('PASS image pastes into an external Wayland client', flush=True)
evaluate('ext._controller.copy(ext._controller.history.items.find(item => item.kind === "text"));')
assert subprocess.check_output(['wl-paste', '--no-newline'], timeout=5).decode().endswith('Second line 世界')
print('PASS text pastes into an external Wayland client', flush=True)
evaluate('ext._section._items.get_first_child().emit("close");')
check('delete removes an item', 'return ext._controller.history.items.length === 2;')
evaluate('ext._controller.clear();')
check('clear empties history', 'return ext._controller.history.items.length === 0;')

# Favorites are standalone native cards, separate from the regular history stack.
set_text('Favorite text 世界')
wait_for('return ext._controller.history.items.length === 1;')
evaluate('global.clipboardCenterFavoriteTextId = ext._controller.history.items[0].id;')
set_text('Regular clipboard item')
wait_for('return ext._controller.history.items.length === 2;')
evaluate(f"const St = (await import('gi://St')).default; const Gio = (await import('gi://Gio')).default; const [, data] = Gio.File.new_for_path({json.dumps(str(fixture))}).load_contents(null); St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(data));")
wait_for('return ext._controller.history.items.length === 3;')
evaluate('global.clipboardCenterBeforeFavoriteSelection = ext._controller._ownSource; Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
click('ext._section._expandCover')
evaluate('ext._section._search.set_text("Favorite text");')
click('ext._section._items.get_first_child().favoriteButton')
check('star adds a standalone native favorite without copying or closing', 'const section = ext._section; const card = section._favorites.get_first_child(); return section._favorites.get_n_children() === 1 && card.has_style_class_name("message") && card.favoriteButton.checked && card.favoriteButton.accessible_name === "Remove from favorites" && section._items.get_n_children() === 0 && !section._stack.visible && ext._controller.history.items.find(item => item.id === global.clipboardCenterFavoriteTextId).favorite && ext._controller._ownSource === global.clipboardCenterBeforeFavoriteSelection && Main.panel.statusArea.dateMenu.menu.isOpen;')
press_key('space')
check('keyboard can unfavorite and follows the card back to regular history', 'return ext._section._favorites.get_n_children() === 0 && ext._section._items.get_first_child().favoriteButton.has_key_focus() && !ext._section._items.get_first_child().favoriteButton.checked;')
press_key('space')
evaluate('ext._section._search.set_text("");')
check('favorites appear once above regular history', 'const section = ext._section; return section._favorites.get_n_children() === 1 && section._items.get_n_children() === 2 && section._content.get_first_child() === section._favorites && section._items.get_children().every(card => card.clipboardItemId !== global.clipboardCenterFavoriteTextId);')
click('ext._section._collapseButton')
check('collapsed history keeps favorites interactive and outside the covered stack', 'const section = ext._section; const card = section._favorites.get_first_child(); return !section._expanded && card.mapped && card.can_focus && card.favoriteButton.can_focus && section._items.get_n_children() === 1 && section._expandCover.visible && section._backCards[1].visible && section._favorites.get_parent() !== section._stack;')
evaluate('Main.notify("Example notification", "Favorites stay above your clipboard history stack.");')
time.sleep(0.5)
evaluate(f"const Shell = (await import('gi://Shell')).default; const Gio = (await import('gi://Gio')).default; const file = Gio.File.new_for_path({json.dumps(str(artifacts / 'favorites.png'))}); const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null); await new Shell.Screenshot().screenshot(false, stream); stream.close(null);")
click('ext._section._favorites.get_first_child().titleLabel')
check('clicking a collapsed favorite copies directly and preserves its star without duplication', 'return !Main.panel.statusArea.dateMenu.menu.isOpen && !ext._section._expanded && ext._controller.history.items.length === 3 && ext._controller.history.items[0].id === global.clipboardCenterFavoriteTextId && ext._controller.history.items[0].favorite;')
assert subprocess.check_output(['wl-paste', '--no-newline'], timeout=5).decode() == 'Favorite text 世界'
evaluate('global.clipboardCenterFavoriteCaptureTime = ext._controller.history.items[0].capturedAt;')
set_text('Favorite text 世界')
wait_for('return ext._controller.history.items[0].capturedAt > global.clipboardCenterFavoriteCaptureTime;')
check('recapturing a favorite preserves its star', 'return ext._controller.history.items.length === 3 && ext._controller.history.items[0].favorite;')
evaluate('Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
click('ext._section._expandCover')
click('ext._section._items.get_children().find(card => card.title === "PNG image").favoriteButton')
check('images can be favorites', 'return ext._section._favorites.get_n_children() === 2 && ext._controller.history.items.find(item => item.kind === "image").favorite;')
click('ext._section._collapseButton')
click('ext._section._favorites.get_children().find(card => card.title === "PNG image").titleLabel')
check('a collapsed image favorite copies directly and keeps its original bytes', f'return !Main.panel.statusArea.dateMenu.menu.isOpen && ext._controller.history.items[0].kind === "image" && ext._controller.history.items[0].favorite && ext._controller.history.items[0].bytes.get_size() === {len(png)};')
assert subprocess.check_output(['wl-paste', '--type', 'image/png'], timeout=5) == png
evaluate('Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
click('ext._section._expandCover')
evaluate('ext._section._search.set_text("PNG");')
check('search matches image favorites without an empty regular placeholder', 'return ext._section._favorites.get_n_children() === 1 && ext._section._favorites.get_first_child().title === "PNG image" && !ext._section._stack.visible;')
evaluate('ext._section._search.set_text("no matching favorite");')
check('unmatched search shows one empty state across favorites and regular items', 'return !ext._section._favorites.visible && ext._section._stack.visible && ext._section._items.get_n_children() === 1 && ext._section._items.get_first_child().text === "No matching items";')
evaluate('ext._section._search.set_text("");')
evaluate('const adjustment = ext._section._scroll.vadjustment; adjustment.value = adjustment.upper - adjustment.page_size;')
time.sleep(0.2)
click('ext._section._items.get_first_child().favoriteButton')
click('ext._section._collapseButton')
check('all-favorite history shows standalone cards without an empty stack and restores card focus', 'return ext._section._favorites.get_n_children() === 3 && !ext._section._stack.visible && !ext._section._expandCover.visible && !ext._section._header.visible && ext._section._favorites.get_first_child().has_key_focus();')
click('ext._section._favorites.get_children().find(card => card.title === "PNG image")._header.closeButton')
check('a collapsed favorite can be removed', 'return ext._controller.history.items.length === 2 && ext._section._favorites.get_n_children() === 2 && !ext._section._stack.visible;')
click('ext._section._favorites.get_children().find(card => card.clipboardItemId === global.clipboardCenterFavoriteTextId).favoriteButton')
check('unfavoriting a collapsed card restores the regular stack and its keyboard focus', 'return ext._section._favorites.get_n_children() === 1 && ext._section._items.get_n_children() === 1 && ext._section._expandCover.visible && ext._section._expandCover.has_key_focus() && !ext._controller.history.items.find(item => item.id === global.clipboardCenterFavoriteTextId).favorite;')
evaluate('for (let index = 0; index < 6; index++) { const text = `Favorite scroll fixture ${index}`; const bytes = new GLib.Bytes(new TextEncoder().encode(text)); const id = `favorite-scroll-${index}`; ext._controller.history.add({ id, kind: "text", mime: "text/plain", text, bytes, size: bytes.get_size(), capturedAt: Date.now() }); ext._controller.history.toggleFavorite(id); } ext._section.sync();')
time.sleep(0.3)
check('many standalone favorites remain inside a bounded scroll area', 'const section = ext._section; return section._scroll.height <= 340 && section._scroll.vadjustment.upper > section._scroll.vadjustment.page_size && !section._scroll.get_vscrollbar_visible() && section.actor.height < global.stage.height;')
point_at('ext._section._scroll')
evaluate('const Clutter = (await import("gi://Clutter")).default; global.clipboardCenterTestPointer.notify_discrete_scroll(GLib.get_monotonic_time(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);')
wait_for('return ext._section._scroll.vadjustment.value > 0;')
evaluate('ext._controller.clear(); Main.panel.statusArea.dateMenu.menu.close();')
check('clearing history also removes favorites and restores the empty state', 'return ext._controller.history.items.length === 0 && ext._section._favorites.get_n_children() === 0 && !ext._section._favorites.visible && ext._section._stack.visible && ext._section._items.get_n_children() === 1;')

subprocess.run(['wl-copy', '--type', 'text/plain;charset=utf-8'], input=b'Copied by a Wayland application', timeout=5, check=True)
wait_for('return ext._controller.history.items.length === 1;')
check('captures text from an external Wayland client', 'return ext._controller.history.items[0].text === "Copied by a Wayland application";')
evaluate('ext._controller.clear();')

# Test a copy that exceeds the text limit; it must not be silently truncated.
evaluate("const St = (await import('gi://St')).default; St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'x'.repeat(1024 * 1024 + 1));")
time.sleep(0.5)
check('oversized content is rejected', 'return ext._controller.history.items.length === 0;')

set_text('Favorite cleared on disable')
wait_for('return ext._controller.history.items.length === 1;')
evaluate('ext._controller.toggleFavorite(ext._controller.history.items[0].id);')
evaluate('Main.panel.statusArea.dateMenu.menu.open();')
time.sleep(0.3)
evaluate('global.clipboardCenterOriginalParent = ext._parent; global.clipboardCenterOriginalList = ext._messageList; global.clipboardCenterOldHistory = ext._controller.history; global.clipboardCenterOldSection = ext._section; ext._section._setExpanded(true); await Main.extensionManager.disableExtension("clipboard-center@stone.dev");')
check('disable during expansion stops animation, restores notifications, and clears favorites', 'return !global.clipboardCenterOldSection._animating && global.clipboardCenterOriginalList.get_parent() === global.clipboardCenterOriginalParent && !global.clipboardCenterOriginalList.has_style_class_name("clipboard-center-notifications") && ext._controller === null && global.clipboardCenterOldHistory.items.length === 0;')
evaluate('await Main.extensionManager.enableExtension("clipboard-center@stone.dev");')
wait_for('return ext._controller?.history.items.length === 1;')
check('extension can be enabled again without restoring favorite status from the clipboard', 'return !ext._controller.history.items[0].favorite && ext._section._favorites.get_n_children() === 0;')
shell_libs = glob.glob('/usr/lib*/gnome-shell') + glob.glob('/usr/lib/*/gnome-shell')
preferences_env = {**os.environ,
    'GI_TYPELIB_PATH': ':'.join(path + '/girepository-1.0' for path in shell_libs),
    'LD_LIBRARY_PATH': ':'.join(shell_libs),
}
preferences = subprocess.run(
    ['gjs', '-m', str(Path(os.environ['CLIPBOARD_CENTER_PROJECT']) / 'tests/preferences-smoke.js'),
     str(Path(os.environ['XDG_DATA_HOME']) / 'gnome-shell/extensions/clipboard-center@stone.dev')],
    capture_output=True, text=True, timeout=15, env=preferences_env,
)
assert preferences.returncode == 0, preferences.stderr
assert 'PASS native Adwaita preferences open' in preferences.stdout, preferences.stderr
print('PASS native Adwaita preferences open', flush=True)
print(f'Shell integration passed. Screenshot: {artifacts / "expanded.png"}', flush=True)
