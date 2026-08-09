// @vitest-environment node
//
// Native export cache cleanup (#167): nativeSaveFile() stages every export (including
// plaintext JSON/text, not just the encrypted .wymber vault) into the app cache for the OS
// share sheet. Deleting it the moment share() resolves would race the receiving app actually
// reading it (Android resolves the share promise when the chooser dismisses, not when the
// target app finishes reading — see the module doc comment in native-share.js), so cleanup is
// sweep-based instead: delete-on-cancel/error immediately (nothing else could be reading an
// unaccepted share), and delete-on-success lazily via a sweep before the next export or at
// module init. These tests mock the Capacitor Filesystem + Share plugins (the same house style
// as native-persistence.test.js / native-biometric.test.js) and assert nothing plaintext
// lingers indefinitely.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { isNativeShell, nativeSaveFile, sweepStagedExports } from '../js/native-share.js';

/** The exact "missing" error Capacitor Filesystem throws (mirrors native-persistence.test.js). */
function notFound() { return new Error('File does not exist.'); }

/**
 * A minimal in-memory stand-in for window.Capacitor.Plugins.Filesystem, tracking directory
 * existence separately from file contents so rmdir/readdir on a directory that was never
 * created behaves like the real plugin (throws not-found) rather than silently succeeding.
 */
function makeFs() {
    const store = new Map(); // path -> data
    const dirs = new Set(); // directories known to exist (created via a recursive writeFile)
    return {
        _store: store,
        _dirs: dirs,
        writeFile: vi.fn(async ({ path, data, recursive }) => {
            if (recursive) {
                const parts = path.split('/');
                parts.pop();
                if (parts.length) dirs.add(parts.join('/'));
            }
            store.set(path, data);
            return { uri: `mock://${path}` };
        }),
        deleteFile: vi.fn(async ({ path }) => {
            if (!store.has(path)) throw notFound();
            store.delete(path);
        }),
        readdir: vi.fn(async ({ path }) => {
            if (!dirs.has(path)) throw notFound();
            const prefix = `${path}/`;
            const files = [...store.keys()]
                .filter((p) => p.startsWith(prefix))
                .map((p) => ({ name: p.slice(prefix.length), type: 'file', size: 0, mtime: 0, uri: `mock://${p}` }));
            return { files };
        }),
        rmdir: vi.fn(async ({ path }) => {
            if (!dirs.has(path)) throw notFound();
            const prefix = `${path}/`;
            for (const p of [...store.keys()]) {
                if (p.startsWith(prefix)) store.delete(p);
            }
            dirs.delete(path);
        }),
    };
}

function makeShare(overrides = {}) {
    return { share: vi.fn(async () => ({ activityType: '' })), ...overrides };
}

function installNativeShell(fs, share) {
    globalThis.Capacitor = { Plugins: { Filesystem: fs, Share: share }, isNativePlatform: () => true };
}

function cancelError() {
    return new Error('User canceled the share sheet.');
}

/** Every file (recursively) currently staged under the exports/ cache dir, as a flat array. */
function stagedFiles(fs) {
    return [...fs._store.keys()].filter((p) => p.startsWith('exports/'));
}

afterEach(() => { delete globalThis.Capacitor; });

describe('successful share (#167: swept lazily, not deleted on resolve)', () => {
    it('leaves exactly the just-shared file staged right after a successful share', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare());

        const result = await nativeSaveFile('wymber-export-2026-08-09.json', '{"nodes":[]}');

        expect(result).toBe(true);
        expect(stagedFiles(fs)).toEqual(['exports/wymber-export-2026-08-09.json']);
    });

    it('sweeps the previous successful share away before staging the next export', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare());

        await nativeSaveFile('wymber-export-2026-08-09.json', '{"nodes":[]}');
        expect(stagedFiles(fs)).toEqual(['exports/wymber-export-2026-08-09.json']);

        await nativeSaveFile('wymber-vault-2026-08-09.wymber', 'CIPHERTEXT');

        // The first export is gone; only the new one remains. At no point did both coexist
        // beyond the single successful-share window the design allows.
        expect(stagedFiles(fs)).toEqual(['exports/wymber-vault-2026-08-09.wymber']);
    });
});

describe('cancelled share: delete immediately, resolve false (not a throw)', () => {
    it('removes the staged file right away and resolves false', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare({ share: vi.fn(async () => { throw cancelError(); }) }));

        const result = await nativeSaveFile('wymber-export-2026-08-09.txt', 'plain text summary');

        expect(result).toBe(false);
        expect(stagedFiles(fs)).toEqual([]);
    });
});

describe('a real share failure: delete the staged file, still propagate the error', () => {
    it('removes the staged file and rethrows', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare({ share: vi.fn(async () => { throw new Error('Share target crashed'); }) }));

        await expect(nativeSaveFile('wymber-export-2026-08-09.txt', 'plain text summary'))
            .rejects.toThrow(/crashed/);

        expect(stagedFiles(fs)).toEqual([]);
    });
});

describe('sweepStagedExports()', () => {
    it('empties the whole exports/ staging directory, whatever is in it', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare());
        // Stage a few files directly, as if left over from prior sessions / unrelated names.
        await fs.writeFile({ path: 'exports/a.json', data: 'A', directory: 'CACHE', recursive: true });
        await fs.writeFile({ path: 'exports/b.wymber', data: 'B', directory: 'CACHE', recursive: true });
        expect(stagedFiles(fs).length).toBe(2);

        await sweepStagedExports();

        expect(stagedFiles(fs)).toEqual([]);
    });

    it('is a no-op (does not throw) when the staging directory was never created', async () => {
        const fs = makeFs(); // fresh: exports/ never created
        installNativeShell(fs, makeShare());

        await expect(sweepStagedExports()).resolves.toBeUndefined();
        expect(fs.rmdir).toHaveBeenCalled();
    });

    it('never throws when the plugin misbehaves with a non-not-found error', async () => {
        const fs = makeFs();
        fs.rmdir = vi.fn(async () => { throw new Error('EIO: i/o error'); });
        installNativeShell(fs, makeShare());

        await expect(sweepStagedExports()).resolves.toBeUndefined();
    });

    it('never throws even off the native shell (no Filesystem plugin at all)', async () => {
        // No globalThis.Capacitor installed at all.
        await expect(sweepStagedExports()).resolves.toBeUndefined();
    });
});

describe('#167: a plaintext export does not survive indefinitely (would fail against the pre-fix code)', () => {
    it('the plaintext content is gone from the mocked filesystem after the lifecycle completes', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare());
        const marker = 'MY_VERY_PRIVATE_TRAUMA_MAP_CONTENT_9f3c';

        const result = await nativeSaveFile('wymber-export-2026-08-09.txt', marker);
        expect(result).toBe(true);
        // Immediately after a successful share, the plaintext is still present (by design —
        // the receiving app may still be reading it). This is the moment the pre-fix code
        // would leave it in forever.
        expect([...fs._store.values()]).toContain(marker);

        // Simulate the next app launch / next export sweeping it away.
        await sweepStagedExports();

        expect([...fs._store.values()]).not.toContain(marker);
        expect(stagedFiles(fs)).toEqual([]);
    });
});

describe('the module is inert off the native shell', () => {
    beforeEach(() => { delete globalThis.Capacitor; });

    it('re-importing the module with no Capacitor global present never throws or hangs', async () => {
        vi.resetModules();
        await expect(import('../js/native-share.js')).resolves.toBeDefined();
    });

    it('isNativeShell() is false and nativeSaveFile rejects with a clear error, not a raw TypeError', async () => {
        expect(isNativeShell()).toBe(false);
        await expect(nativeSaveFile('x.json', 'y')).rejects.toThrow(/Filesystem plugin unavailable/);
    });

    it('sweepStagedExports() called directly off-shell still resolves cleanly (belt-and-suspenders)', async () => {
        await expect(sweepStagedExports()).resolves.toBeUndefined();
    });
});
