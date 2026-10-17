import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('history persists across processes, updates atomically, and rejects invalid data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clipboard-center-storage-'));
    try {
        for (const action of [
            'write',
            'read',
            'update',
            'clear',
            'empty',
            'race',
            'invalid',
            'corrupt',
            'cancel',
        ]) {
            const result = spawnSync(
                'gjs',
                ['-m', join(import.meta.dir, 'storage-fixture.js'), directory, action],
                { encoding: 'utf8', timeout: 10000 },
            );
            expect(result.status, `${action}: ${result.error ?? result.stderr}`).toBe(0);
            expect(result.stdout).toContain(`PASS ${action}`);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}, 20000);
