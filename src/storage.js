import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { chooseFormat, MAX_HISTORY_BYTES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from './history.js';

Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

// Version, then (kind, MIME type, capture time, favorite, original bytes).
const STORAGE_TYPE = '(ua(ssdbay))';
const MAX_STORAGE_BYTES = MAX_HISTORY_BYTES + 1024 * 1024;
const PRIVATE_REPLACE = Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION;

function encode(items) {
    return new GLib.Variant(STORAGE_TYPE, [
        1,
        items.map((item) => [
            item.kind,
            item.mime,
            item.capturedAt,
            item.favorite,
            item.bytes.get_data(),
        ]),
    ]).get_data_as_bytes();
}

function decode(bytes) {
    const variant = GLib.Variant.new_from_bytes(new GLib.VariantType(STORAGE_TYPE), bytes, false);
    if (!variant.is_normal_form()) {
        throw new Error('Invalid history file');
    }
    const [version, records] = variant.deepUnpack();
    if (version !== 1) {
        throw new Error('Unsupported history version');
    }
    const items = [];
    const ids = new Set();
    let total = 0;
    for (const [kind, mime, capturedAt, favorite, data] of records) {
        const size = data.length;
        const limit = kind === 'text' ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES;
        if (
            chooseFormat([mime])?.kind !== kind ||
            !Number.isFinite(capturedAt) ||
            capturedAt < 0 ||
            size === 0 ||
            size > limit ||
            total + size > MAX_HISTORY_BYTES
        ) {
            continue;
        }
        const content = new GLib.Bytes(data);
        const id = `${kind}:${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, content)}`;
        if (ids.has(id)) {
            continue;
        }
        const item = { kind, mime, capturedAt, favorite, bytes: content, id, size };
        if (kind === 'text') {
            try {
                item.text = new TextDecoder('utf-8', { fatal: true }).decode(data);
            } catch {
                continue;
            }
            if (!item.text.trim()) {
                continue;
            }
        }
        items.push(item);
        ids.add(id);
        total += size;
    }
    return items;
}

export class HistoryStorage {
    constructor(directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'clipboard-center'])) {
        this._directory = Gio.File.new_for_path(directory);
        this._file = this._directory.get_child('history.gv');
        this._readCancellable = new Gio.Cancellable();
        this._revision = 0;
        this._dirty = false;
        this._destroyed = false;
    }

    async load() {
        let stream;
        try {
            stream = await this._file.read_async(GLib.PRIORITY_DEFAULT, this._readCancellable);
            const chunks = [];
            let size = 0;
            while (true) {
                const chunk = await stream.read_bytes_async(
                    Math.min(1024 * 1024, MAX_STORAGE_BYTES + 1 - size),
                    GLib.PRIORITY_DEFAULT,
                    this._readCancellable,
                );
                if (!chunk.get_size()) {
                    break;
                }
                size += chunk.get_size();
                if (size > MAX_STORAGE_BYTES) {
                    throw new Error('History file exceeds storage limit');
                }
                chunks.push(chunk.get_data());
            }
            const data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }
            return this._destroyed ? [] : decode(new GLib.Bytes(data));
        } catch (error) {
            if (!this._destroyed && !error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                // Never include exception messages: they may contain clipboard data.
                console.warn(`Clipboard Center: could not load saved history (${error.name})`);
            }
            return [];
        } finally {
            stream?.close(null);
        }
    }

    save(items) {
        if (this._destroyed) {
            return;
        }
        this._items = items.map((item) => ({ ...item }));
        this._revision++;
        this._dirty = true;
        this._schedule();
    }

    _schedule() {
        if (this._destroyed || this._writing || this._timeoutId || !this._dirty) {
            return;
        }
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._timeoutId = 0;
            this._write();
            return GLib.SOURCE_REMOVE;
        });
    }

    _prepareDirectory() {
        const path = this._directory.get_path();
        if (GLib.mkdir_with_parents(path, 0o700) !== 0 || GLib.chmod(path, 0o700) !== 0) {
            throw new Error('Could not create private history directory');
        }
        // Remove snapshots left by an interrupted process, including after a clear.
        const files = this._directory.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        try {
            for (let info = files.next_file(null); info; info = files.next_file(null)) {
                const name = info.get_name();
                if (
                    (name.startsWith('.history-') && name.endsWith('.tmp')) ||
                    name.startsWith('.goutputstream-')
                ) {
                    try {
                        this._directory.get_child(name).delete(null);
                    } catch (error) {
                        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                            throw error;
                        }
                    }
                }
            }
        } finally {
            files.close(null);
        }
    }

    async _write() {
        this._writing = true;
        const revision = this._revision;
        const cancellable = new Gio.Cancellable();
        this._writeCancellable = cancellable;
        const temporary = this._directory.get_child(`.history-${GLib.uuid_string_random()}.tmp`);
        try {
            this._prepareDirectory();
            await temporary.replace_contents_bytes_async(
                encode(this._items),
                null,
                false,
                PRIVATE_REPLACE,
                cancellable,
            );
            if (!this._destroyed && !cancellable.is_cancelled() && revision === this._revision) {
                // Commit only a current snapshot. A cancelled older write can never
                // replace a newer snapshot flushed synchronously during disable.
                temporary.move(this._file, Gio.FileCopyFlags.OVERWRITE, null, null);
                this._dirty = false;
            }
        } catch (error) {
            if (!this._destroyed && !cancellable.is_cancelled()) {
                console.warn(`Clipboard Center: could not save history (${error.name})`);
                // Retry on the next change or flush, rather than spinning on an I/O error.
                return;
            }
        } finally {
            try {
                temporary.delete(null);
            } catch {
                // The commit already moved the file, or the cancelled write never created it.
            }
            this._writing = false;
            this._writeCancellable = null;
        }
        this._schedule();
    }

    destroy() {
        this._destroyed = true;
        this._readCancellable.cancel();
        this._writeCancellable?.cancel();
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._dirty) {
            try {
                this._prepareDirectory();
                this._file.replace_contents(
                    encode(this._items).get_data(),
                    null,
                    false,
                    PRIVATE_REPLACE,
                    null,
                );
                this._dirty = false;
            } catch (error) {
                console.warn(`Clipboard Center: could not flush saved history (${error.name})`);
            }
        }
        this._items = null;
    }
}
