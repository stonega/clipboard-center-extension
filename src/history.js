export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff'];
const SENSITIVE_MARKERS = [
    'x-kde-passwordmanagerhint',
    'application/x-kde-passwordmanagerhint',
    'application/x-keepassxc',
    'application/x-1password',
    'application/x-bitwarden',
];

export function chooseFormat(mimetypes, captureImages = true) {
    const normalized = mimetypes.map((mime) => mime.toLowerCase());
    if (normalized.some((mime) => SENSITIVE_MARKERS.some((marker) => mime.startsWith(marker)))) {
        return null;
    }

    if (captureImages) {
        const mime = IMAGE_MIMES.find((candidate) => normalized.includes(candidate));
        if (mime) {
            return { kind: 'image', mime: mimetypes[normalized.indexOf(mime)] };
        }
    }

    const mime = mimetypes.find((type) => /^text\/plain(?:;|$)/i.test(type));
    return mime ? { kind: 'text', mime } : null;
}

export function textPreview(text, hint = '') {
    const lines = text.trim().split(/\r?\n/);
    const title = lines.find((line) => line.trim())?.trim() || 'Text';
    const body = lines.slice(1).join('\n').trim();
    return {
        title: title.slice(0, 160),
        body:
            body.slice(0, 2048) ||
            [`${text.length.toLocaleString()} characters`, hint].filter(Boolean).join(' · '),
    };
}

export class History {
    constructor(limit = 50, byteLimit = MAX_HISTORY_BYTES) {
        this.items = [];
        this.limit = limit;
        this.byteLimit = byteLimit;
    }

    get bytes() {
        return this.items.reduce((total, item) => total + item.size, 0);
    }

    add(item) {
        if (
            !item.id ||
            !Number.isFinite(item.size) ||
            item.size <= 0 ||
            item.size > this.byteLimit
        ) {
            return false;
        }
        if (item.kind === 'text' && !item.text?.trim()) {
            return false;
        }
        const existing = this.items.find((entry) => entry.id === item.id);
        const stored = { ...item, favorite: existing?.favorite ?? false };
        const favoriteBytes = this.items.reduce(
            (total, entry) => total + (entry.favorite && entry.id !== item.id ? entry.size : 0),
            0,
        );
        if (favoriteBytes + stored.size > this.byteLimit) {
            return false;
        }
        this.remove(item.id);
        this.items.unshift(stored);
        this.trim();
        return true;
    }

    trim() {
        let regularCount = this.items.filter((item) => !item.favorite).length;
        let bytes = this.bytes;
        for (
            let index = this.items.length - 1;
            index >= 0 && (regularCount > this.limit || bytes > this.byteLimit);
            index--
        ) {
            const item = this.items[index];
            if (item.favorite) {
                continue;
            }
            this.items.splice(index, 1);
            regularCount--;
            bytes -= item.size;
        }
    }

    toggleFavorite(id) {
        const item = this.items.find((entry) => entry.id === id);
        if (!item) {
            return false;
        }
        item.favorite = !item.favorite;
        this.trim();
        return true;
    }

    remove(id) {
        this.items = this.items.filter((item) => item.id !== id);
    }

    clear() {
        this.items = [];
    }

    search(query) {
        const needle = query.trim().toLocaleLowerCase();
        return this.items.filter((item) => {
            const searchable = item.kind === 'text' ? item.text : `image ${item.mime}`;
            return searchable.toLocaleLowerCase().includes(needle);
        });
    }
}
