import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { MAX_TEXT_BYTES } from '../src/history.js';
import { HistoryStorage } from '../src/storage.js';

const [directory, action] = ARGV;
const file = Gio.File.new_for_path(directory).get_child('history.gv');
const text = 'Saved text\n世界 🐈';
const image = new Uint8Array([137, 80, 78, 71, 0, 255, 128, 13, 10]);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function item(kind, data, favorite = false, capturedAt = 10) {
    return {
        kind,
        mime: kind === 'text' ? 'text/plain;charset=utf-8' : 'image/png',
        bytes: new GLib.Bytes(data),
        favorite,
        capturedAt,
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

const store = new HistoryStorage(directory);
if (action === 'write') {
    assert((await store.load()).length === 0, 'Missing history starts empty');
    store.save([
        item('image', image, true, 20),
        item('text', new TextEncoder().encode(text), false),
    ]);
    // Disabling before the debounce fires must flush the latest snapshot.
    store.destroy();
    const mode = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    assert((mode.get_attribute_uint32('unix::mode') & 0o777) === 0o600, 'Private history file');
    const dirMode = file.get_parent().query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    assert((dirMode.get_attribute_uint32('unix::mode') & 0o777) === 0o700, 'Private directory');
} else if (action === 'read') {
    const items = await store.load();
    assert(items.length === 2, 'Both entries restored in a fresh process');
    assert(items[0].favorite && !items[1].favorite, 'Favorite flags preserved');
    assert(items[0].capturedAt === 20 && items[1].capturedAt === 10, 'Order and times preserved');
    assert(items[1].text === text, 'Unicode text restored exactly');
    assert(items[1].size === new TextEncoder().encode(text).length, 'UTF-8 byte size restored');
    assert(
        JSON.stringify(Array.from(items[0].bytes.get_data())) === JSON.stringify(Array.from(image)),
        'Image bytes restored including zero and non-UTF-8 bytes',
    );
    assert(items[0].id.startsWith('image:') && items[1].id.startsWith('text:'), 'IDs rebuilt');
    store.destroy();
} else if (action === 'update') {
    const items = await store.load();
    items[1].favorite = true;
    store.save([items[1]]);
    await delay(500);
    const reader = new HistoryStorage(directory);
    const saved = await reader.load();
    assert(saved.length === 1 && saved[0].favorite && saved[0].text === text, 'Async update saved');
    reader.destroy();
    store.destroy();
} else if (action === 'clear') {
    const abandoned = file.get_parent().get_child('.history-interrupted.tmp');
    abandoned.replace_contents(image, null, false, Gio.FileCreateFlags.PRIVATE, null);
    store.save([]);
    store.destroy();
    assert(!abandoned.query_exists(null), 'Abandoned snapshots are removed on clear');
} else if (action === 'empty') {
    assert((await store.load()).length === 0, 'Deleted entries do not return in a fresh process');
    store.destroy();
} else if (action === 'race') {
    // Leave an older asynchronous write in flight, then flush a newer empty snapshot.
    store.save([item('text', new Uint8Array(MAX_TEXT_BYTES).fill(120))]);
    await delay(151);
    store.save([]);
    store.destroy();
    await delay(300);
    const reader = new HistoryStorage(directory);
    assert((await reader.load()).length === 0, 'Older async write cannot resurrect cleared data');
    reader.destroy();
} else if (action === 'invalid') {
    const records = [
        ['text', 'application/x-1password', 10, false, new Uint8Array([120])],
        ['text', 'text/plain', 10, false, new Uint8Array([255])],
        ['text', 'text/plain', 10, false, new TextEncoder().encode('   ')],
        ['text', 'text/plain', 10, false, new Uint8Array(MAX_TEXT_BYTES + 1).fill(120)],
        ['text', 'text/plain', Number.NaN, false, new Uint8Array([120])],
        ['image', 'image/svg+xml', 10, false, image],
        ['text', 'text/plain', 10, true, new TextEncoder().encode(text)],
        ['text', 'text/plain', 5, false, new TextEncoder().encode(text)],
    ];
    const bytes = new GLib.Variant('(ua(ssdbay))', [1, records]).get_data_as_bytes();
    file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.PRIVATE, null);
    const items = await store.load();
    assert(
        items.length === 1 && items[0].favorite && items[0].text === text,
        'Invalid entries skipped and duplicates keep newest metadata',
    );
    store.destroy();
} else if (action === 'corrupt') {
    for (const data of [
        new Uint8Array([255, 0, 1]),
        new GLib.Variant('(ua(ssdbay))', [2, []]).get_data_as_bytes().get_data(),
    ]) {
        file.replace_contents(data, null, false, Gio.FileCreateFlags.PRIVATE, null);
        assert((await store.load()).length === 0, 'Corrupt or unsupported file starts empty');
    }
    store.destroy();
} else if (action === 'cancel') {
    const loading = store.load();
    store.destroy();
    assert((await loading).length === 0, 'Disable cancels pending disk reads');
} else {
    throw new Error('Unknown fixture action');
}
print(`PASS ${action}`);
