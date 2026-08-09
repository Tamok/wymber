// @vitest-environment node
//
// NativePersistence error handling (#165): a read that fails for a reason other than "no vault
// yet" must never be reported as "no vault", and the write path must never clobber a vault that is
// present on disk but was unreadable this session. These tests mock the Capacitor Filesystem
// plugin (the same way the crypto tests mock platform APIs) and assert the failure chain the issue
// describes can no longer end in a create-flow overwrite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    NativePersistence, StorageUnavailableError, isNotFoundError, isStorageUnavailableError,
} from '../js/native-persistence.js';
import { LocalRepo } from '../js/local-repo.js';

const VAULT = 'wymber.vault';
const TMP = 'wymber.vault.tmp';

/** The exact "missing file" error Capacitor Filesystem throws (web shim + native plugins). */
function notFound() { return new Error('File does not exist.'); }

/**
 * A minimal in-memory stand-in for window.Capacitor.Plugins.Filesystem. Only the four methods
 * NativePersistence uses are implemented; each is a spy so tests can assert call args and ordering,
 * or override with mockRejected* to force a failure.
 */
function makeFs(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        _store: store,
        readFile: vi.fn(async ({ path }) => {
            if (!store.has(path)) throw notFound();
            return { data: store.get(path) };
        }),
        writeFile: vi.fn(async ({ path, data }) => { store.set(path, data); return { uri: path }; }),
        rename: vi.fn(async ({ from, to }) => {
            if (!store.has(from)) throw notFound();
            store.set(to, store.get(from));
            store.delete(from);
        }),
        deleteFile: vi.fn(async ({ path }) => {
            if (!store.has(path)) throw notFound();
            store.delete(path);
        }),
    };
}

function installNativeShell(fs) {
    globalThis.Capacitor = { Plugins: { Filesystem: fs }, isNativePlatform: () => true };
}

afterEach(() => { delete globalThis.Capacitor; });

describe('NativePersistence read path (#165: distinguish not-found from I/O failure)', () => {
    it('returns null only for a genuine not-found (a truly fresh device)', async () => {
        installNativeShell(makeFs()); // empty store
        const p = new NativePersistence();
        expect(await p.loadVault()).toBeNull();
        expect(await p.hasVault()).toBe(false);
    });

    it('returns the stored blob when the vault is present', async () => {
        installNativeShell(makeFs({ [VAULT]: 'SEALED' }));
        const p = new NativePersistence();
        expect(await p.loadVault()).toBe('SEALED');
        expect(await p.hasVault()).toBe(true);
    });

    it('surfaces a non-not-found read error as StorageUnavailableError, never as null', async () => {
        const fs = makeFs();
        fs.readFile.mockRejectedValue(new Error('The database connection is closing.'));
        installNativeShell(fs);
        const p = new NativePersistence();
        await expect(p.loadVault()).rejects.toBeInstanceOf(StorageUnavailableError);
    });

    it('hasVault rejects on an I/O error (does NOT collapse to false / "no vault")', async () => {
        const fs = makeFs();
        fs.readFile.mockRejectedValue(new Error('EIO: i/o error, read'));
        installNativeShell(fs);
        const p = new NativePersistence();
        await expect(p.hasVault()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    });
});

describe('NativePersistence write path (#165: never clobber; #145: atomic)', () => {
    it('writes atomically: temp file first, then rename over the target', async () => {
        const fs = makeFs();
        installNativeShell(fs);
        const p = new NativePersistence();

        await p.saveVault('SEALED');

        expect(fs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: TMP, data: 'SEALED' }));
        expect(fs.rename).toHaveBeenCalledWith(expect.objectContaining({ from: TMP, to: VAULT }));
        // temp must be renamed away before writeFile ever touches the real path directly.
        expect(fs.writeFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: VAULT }));
        expect(fs.writeFile.mock.invocationCallOrder[0]).toBeLessThan(fs.rename.mock.invocationCallOrder[0]);
        // end state: only the real file remains, with the new content.
        expect(fs._store.get(VAULT)).toBe('SEALED');
        expect(fs._store.has(TMP)).toBe(false);
    });

    it('round-trips a sealed blob and overwrites cleanly on a second save', async () => {
        installNativeShell(makeFs());
        const p = new NativePersistence();
        await p.saveVault('SEALED-1');
        expect(await p.loadVault()).toBe('SEALED-1');
        await p.saveVault('SEALED-2');
        expect(await p.loadVault()).toBe('SEALED-2');
    });

    it('still allows the very first save on a genuinely fresh device (guard does not over-block)', async () => {
        installNativeShell(makeFs()); // empty
        const p = new NativePersistence();
        expect(await p.hasVault()).toBe(false); // not-found leaves writes permitted
        await p.saveVault('FIRST-VAULT');
        expect(await p.loadVault()).toBe('FIRST-VAULT');
    });
});

describe('the #165 chain: a transient read error can no longer overwrite a real vault', () => {
    it('refuses to write (and never calls writeFile) after an unreadable read this session', async () => {
        const fs = makeFs({ [VAULT]: 'REAL-SEALED-VAULT' }); // a real vault IS on disk
        fs.readFile.mockRejectedValueOnce(new Error('disk I/O error')); // ...but this read fails
        installNativeShell(fs);
        const p = new NativePersistence();

        // 1) The app asks "is there a vault?" and must NOT get a false (which would open Create).
        await expect(p.hasVault()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });

        // 2) Belt-and-suspenders: even if the create flow were somehow reached, the write is
        //    refused, so the real vault on disk is never overwritten.
        await expect(p.saveVault('NEW-EMPTY-VAULT')).rejects.toBeInstanceOf(StorageUnavailableError);
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs.rename).not.toHaveBeenCalled();
        expect(fs._store.get(VAULT)).toBe('REAL-SEALED-VAULT'); // untouched
    });

    it('clears the refuse-to-write guard once a later read succeeds (retry recovery)', async () => {
        const fs = makeFs({ [VAULT]: 'REAL' });
        fs.readFile.mockRejectedValueOnce(new Error('disk I/O error')); // first read only
        installNativeShell(fs);
        const p = new NativePersistence();

        await expect(p.hasVault()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
        await expect(p.saveVault('X')).rejects.toBeInstanceOf(StorageUnavailableError); // refused

        // User taps "Try again"; the read now succeeds -> guard clears -> writes allowed again.
        expect(await p.hasVault()).toBe(true);
        await p.saveVault('UPDATED');
        expect(fs._store.get(VAULT)).toBe('UPDATED');
    });

    it('LocalRepo.hasVault propagates storage-unavailable (so app boot shows retry, not create)', async () => {
        const fs = makeFs({ [VAULT]: 'REAL' });
        fs.readFile.mockRejectedValue(new Error('EIO: i/o error'));
        installNativeShell(fs);
        const repo = new LocalRepo({ persistence: new NativePersistence() });
        await expect(repo.hasVault()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    });
});

describe('error classification helpers (narrow by design)', () => {
    it('treats the Capacitor "File does not exist." message as not-found', () => {
        expect(isNotFoundError(new Error('File does not exist.'))).toBe(true);
    });

    it('treats ENOENT-class / POSIX spellings as not-found', () => {
        expect(isNotFoundError({ code: 'ENOENT' })).toBe(true);
        expect(isNotFoundError(new Error('ENOENT: no such file or directory'))).toBe(true);
    });

    it('does NOT treat an I/O or permission error as not-found', () => {
        expect(isNotFoundError(new Error('disk I/O error'))).toBe(false);
        expect(isNotFoundError(new Error('Permission denied'))).toBe(false);
        expect(isNotFoundError(undefined)).toBe(false);
    });

    it('detects StorageUnavailableError by code across the module boundary', () => {
        expect(isStorageUnavailableError(new StorageUnavailableError('x'))).toBe(true);
        expect(isStorageUnavailableError({ code: 'STORAGE_UNAVAILABLE' })).toBe(true);
        expect(isStorageUnavailableError(new Error('nope'))).toBe(false);
        expect(isStorageUnavailableError(null)).toBe(false);
    });
});

describe('web build stays inert (no Capacitor global)', () => {
    beforeEach(() => { delete globalThis.Capacitor; });

    it('off-shell, loadVault rejects loudly instead of silently reporting "no vault"', async () => {
        const p = new NativePersistence();
        // No window.Capacitor -> filesystem() throws before any read is attempted. The important
        // property is that this never RESOLVES to null (a false "no vault" that would open Create):
        // it rejects with the storage-unavailable signal, wrapping the plugin-unavailable cause.
        // The web build never constructs NativePersistence (isNativeShell() is false) regardless.
        const outcome = await p.loadVault().then(() => 'resolved', (e) => e);
        expect(outcome).toBeInstanceOf(StorageUnavailableError);
        expect(String(outcome.cause?.message ?? '')).toMatch(/unavailable/);
    });

    it('off-shell, saveVault throws before attempting any write (no data path touched)', async () => {
        const p = new NativePersistence();
        await expect(p.saveVault('anything')).rejects.toThrow(/Filesystem plugin is unavailable/);
    });
});
