import { describe, expect, test } from 'bun:test';

import { chooseFormat, History, textPreview } from '../src/history.js';

function text(id, value = id, size = value.length) {
    return { id, kind: 'text', text: value, size, capturedAt: 1 };
}

describe('clipboard format selection', () => {
    test('prefers image bytes over an accompanying text representation', () => {
        expect(chooseFormat(['text/plain', 'image/jpeg', 'image/png'])).toEqual({
            kind: 'image',
            mime: 'image/png',
        });
    });
    test('handles text parameters, disabled images, and unsupported formats', () => {
        expect(chooseFormat(['text/plain;charset=utf-8'])).toEqual({
            kind: 'text',
            mime: 'text/plain;charset=utf-8',
        });
        expect(chooseFormat(['image/png'], false)).toBeNull();
        expect(chooseFormat(['text/html'])).toBeNull();
        expect(chooseFormat(['image/svg+xml'])).toBeNull();
        expect(chooseFormat([])).toBeNull();
    });
    test('never records entries with password manager MIME hints', () => {
        for (const marker of [
            'x-kde-passwordManagerHint',
            'application/x-kde-passwordmanagerhint',
            'application/x-keepassxc-autotype',
            'application/x-1password',
            'application/x-bitwarden',
        ]) {
            expect(chooseFormat(['text/plain', 'image/png', marker])).toBeNull();
        }
    });
});

describe('history', () => {
    test('moves duplicate items to the front without losing their content', () => {
        const history = new History();
        history.add(text('a'));
        history.add(text('b'));
        history.add({ ...text('a'), capturedAt: 2 });
        expect(history.items.map((item) => item.id)).toEqual(['a', 'b']);
        expect(history.items[0].capturedAt).toBe(2);
    });
    test('evicts oldest items by count and total byte budget', () => {
        const history = new History(3, 10);
        for (const id of ['a', 'b', 'c', 'd']) history.add(text(id, id, 3));
        expect(history.items.map((item) => item.id)).toEqual(['d', 'c', 'b']);
        history.add(text('e', 'e', 8));
        expect(history.items.map((item) => item.id)).toEqual(['e']);
        expect(history.bytes).toBe(8);
    });
    test('rejects empty, whitespace-only, invalid-sized and oversized content', () => {
        const history = new History(10, 20);
        for (const item of [
            text('empty', ''),
            text('space', '  '),
            text('big', 'x', 21),
            text('nan', 'x', Number.NaN),
        ]) {
            expect(history.add(item)).toBe(false);
        }
        expect(history.items).toEqual([]);
    });
    test('searches text and image formats case-insensitively', () => {
        const history = new History();
        history.add(text('a', 'Hello 世界'));
        history.add({ id: 'b', kind: 'image', mime: 'image/png', size: 10 });
        expect(history.search('HELLO').map((item) => item.id)).toEqual(['a']);
        expect(history.search('世界')).toHaveLength(1);
        expect(history.search('png').map((item) => item.id)).toEqual(['b']);
        expect(history.search('image')).toHaveLength(1);
        expect(history.search('missing')).toEqual([]);
    });
    test('removes one item and clears all history', () => {
        const history = new History();
        history.add(text('a'));
        history.add(text('b'));
        history.remove('a');
        expect(history.items.map((item) => item.id)).toEqual(['b']);
        history.clear();
        expect(history.bytes).toBe(0);
        expect(history.items).toEqual([]);
    });
    test('applies a smaller limit immediately', () => {
        const history = new History();
        for (const id of ['a', 'b', 'c']) history.add(text(id));
        history.limit = 1;
        history.trim();
        expect(history.items.map((item) => item.id)).toEqual(['c']);
    });
    test('keeps favorites outside the regular history limit', () => {
        const history = new History(2);
        history.add(text('a'));
        expect(history.toggleFavorite('a')).toBe(true);
        for (const id of ['b', 'c', 'd']) history.add(text(id));
        expect(history.items.map((item) => item.id)).toEqual(['d', 'c', 'a']);
        history.limit = 1;
        history.trim();
        expect(history.items.map((item) => item.id)).toEqual(['d', 'a']);
        expect(history.items[1].favorite).toBe(true);
    });
    test('preserves favorites when the same text or image is captured again', () => {
        const history = new History();
        const image = { id: 'image', kind: 'image', mime: 'image/png', size: 5 };
        history.add(text('a', 'Favorite 世界'));
        history.add(image);
        history.toggleFavorite('a');
        history.toggleFavorite('image');
        history.add({ ...text('a', 'Favorite 世界'), capturedAt: 2 });
        history.add({ ...image, capturedAt: 3 });
        expect(history.items).toHaveLength(2);
        expect(history.items.every((item) => item.favorite)).toBe(true);
        expect(history.items.map((item) => item.capturedAt)).toEqual([3, 2]);
        expect(history.search('世界')[0].favorite).toBe(true);
        expect(history.search('PNG')[0].favorite).toBe(true);
    });
    test('shares the memory budget without evicting favorites or losing rejected history', () => {
        const history = new History(10, 10);
        history.add(text('a', 'a', 8));
        history.toggleFavorite('a');
        history.add(text('b'));
        history.add(text('c'));
        expect(history.add(text('too-big', 'x', 3))).toBe(false);
        expect(history.items.map((item) => item.id)).toEqual(['c', 'b', 'a']);
        expect(history.add(text('fits', 'x', 2))).toBe(true);
        expect(history.items.map((item) => item.id)).toEqual(['fits', 'a']);
        expect(history.bytes).toBe(10);
        history.toggleFavorite('fits');
        expect(history.add(text('full'))).toBe(false);
        expect(history.items.every((item) => item.favorite)).toBe(true);
    });
    test('unfavoriting restores regular eviction and favorites can be removed or cleared', () => {
        const history = new History(1);
        expect(history.toggleFavorite('missing')).toBe(false);
        history.add(text('a'));
        history.toggleFavorite('a');
        history.add(text('b'));
        history.toggleFavorite('a');
        expect(history.items.map((item) => item.id)).toEqual(['b']);
        expect(history.items[0].favorite).toBe(false);
        history.toggleFavorite('b');
        history.remove('b');
        expect(history.items).toEqual([]);
        history.add(text('c'));
        history.toggleFavorite('c');
        history.clear();
        expect(history.items).toEqual([]);
        expect(history.bytes).toBe(0);
    });
});

test('text preview preserves multiline and Unicode content without interpreting markup', () => {
    expect(textPreview('  <hello> 世界\nsecond line\nthird line')).toEqual({
        title: '<hello> 世界',
        body: 'second line\nthird line',
    });
    expect(textPreview('x'.repeat(500)).title).toHaveLength(160);
});
