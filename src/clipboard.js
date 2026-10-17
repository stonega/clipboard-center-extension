import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { chooseFormat, History, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from './history.js';
import { HistoryStorage } from './storage.js';

const CLIPBOARD = Meta.SelectionType.SELECTION_CLIPBOARD;

export class ClipboardHistory {
    constructor(settings, onChanged) {
        this.settings = settings;
        this.history = new History(settings.get_int('history-limit'));
        this._onChanged = onChanged;
        this._selection = global.display.get_selection();
        this._generation = 0;
        this._destroyed = false;
        this._loading = true;
        this._storage = new HistoryStorage();
        this._selectionId = this._selection.connect('owner-changed', (_selection, type, owner) => {
            if (type !== CLIPBOARD) {
                return;
            }
            this._cancelRead();
            if (owner && owner !== this._ownSource) {
                this._capture();
            }
        });
        this._settingsId = settings.connect('changed', (_settings, key) => {
            this._cancelRead();
            if (key === 'history-limit') {
                this.history.limit = settings.get_int(key);
                this.history.trim();
                if (!this._loading) {
                    this._storage.save(this.history.items);
                }
            }
            this._onChanged();
        });
        this._storage.load().then((items) => {
            if (this._destroyed || !this._loading) {
                return;
            }
            this.history.items = items;
            this.history.trim();
            this._loading = false;
            this._changed();
            this._capture();
        });
    }

    _changed() {
        this._storage.save(this.history.items);
        this._onChanged();
    }

    _cancelRead() {
        this._generation++;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _capture() {
        if (this._destroyed || this._loading || this.settings.get_boolean('paused')) {
            return;
        }
        const format = chooseFormat(
            this._selection.get_mimetypes(CLIPBOARD) ?? [],
            this.settings.get_boolean('capture-images'),
        );
        if (!format) {
            return;
        }

        const generation = this._generation;
        const capturedAt = Date.now();
        const limit = format.kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
        const stream = Gio.MemoryOutputStream.new_resizable();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this._timeoutId = 0;
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });

        // Read one byte beyond the limit so truncated data never enters history.
        this._selection.transfer_async(
            CLIPBOARD,
            format.mime,
            limit + 1,
            stream,
            cancellable,
            (selection, result) => {
                try {
                    const transferred = selection.transfer_finish(result);
                    stream.close(null);
                    if (
                        !transferred ||
                        this._destroyed ||
                        generation !== this._generation ||
                        cancellable.is_cancelled()
                    ) {
                        return;
                    }
                    const bytes = stream.steal_as_bytes();
                    const size = bytes.get_size();
                    if (size === 0 || size > limit) {
                        return;
                    }
                    const data = bytes.get_data();
                    const id = `${format.kind}:${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}`;
                    const item = { ...format, id, bytes, size, capturedAt };
                    if (format.kind === 'text') {
                        item.text = new TextDecoder('utf-8', { fatal: true }).decode(data);
                    }
                    if (this.history.add(item)) {
                        this._changed();
                    }
                } catch (error) {
                    if (!cancellable.is_cancelled() && !this._destroyed) {
                        console.warn(
                            `Clipboard Center: could not read ${format.kind} (${error.name})`,
                        );
                    }
                } finally {
                    if (!stream.is_closed()) {
                        stream.close(null);
                    }
                    if (generation === this._generation) {
                        this._cancelRead();
                    }
                }
            },
        );
    }

    copy(item) {
        this._cancelRead();
        const mime = item.kind === 'text' ? 'text/plain;charset=utf-8' : item.mime;
        this._ownSource = Meta.SelectionSourceMemory.new(mime, item.bytes);
        this._selection.set_owner(CLIPBOARD, this._ownSource);
        this.history.add({ ...item, capturedAt: Date.now() });
        this._changed();
    }

    toggleFavorite(id) {
        if (this.history.toggleFavorite(id)) {
            this._changed();
        }
    }

    remove(id) {
        this.history.remove(id);
        this._changed();
    }

    clear() {
        this._cancelRead();
        // A clear during startup must also discard the pending disk restore.
        this._loading = false;
        this.history.clear();
        this._changed();
    }

    destroy() {
        this._destroyed = true;
        this._cancelRead();
        this._selection.disconnect(this._selectionId);
        this.settings.disconnect(this._settingsId);
        this._storage.destroy();
        this.history.clear();
        // Mutter retains the active selection so the last copied item remains pasteable.
        this._ownSource = null;
        this._onChanged = null;
    }
}
