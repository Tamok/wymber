/**
 * Vault persistence — stores the single encrypted vault blob (a string) on the device.
 *
 * Prefers OPFS (Origin Private File System); falls back to IndexedDB. Browser-only:
 * the LocalRepo accepts an injected persistence object, so tests use an in-memory fake
 * and never touch this module. Only ciphertext is ever written here.
 */

const FILE = 'wymber.vault';
const DB_NAME = 'wymber';
const STORE = 'kv';
const KEY = 'vault';

export class VaultPersistence {
    async _opfsDir() {
        if (!globalThis.navigator?.storage?.getDirectory) return null;
        try {
            return await navigator.storage.getDirectory();
        } catch {
            return null;
        }
    }

    async hasVault() {
        return (await this.loadVault()) != null;
    }

    async loadVault() {
        const dir = await this._opfsDir();
        if (dir) {
            try {
                const fh = await dir.getFileHandle(FILE);
                return await (await fh.getFile()).text();
            } catch {
                return null; // not found
            }
        }
        return this._idb('readonly', (store) => store.get(KEY)).then((v) => v ?? null);
    }

    async saveVault(str) {
        const dir = await this._opfsDir();
        if (dir) {
            const fh = await dir.getFileHandle(FILE, { create: true });
            const w = await fh.createWritable();
            await w.write(str);
            await w.close();
            return;
        }
        await this._idb('readwrite', (store) => store.put(str, KEY));
    }

    async clearVault() {
        const dir = await this._opfsDir();
        if (dir) {
            try {
                await dir.removeEntry(FILE);
            } catch { /* already gone */ }
            return;
        }
        await this._idb('readwrite', (store) => store.delete(KEY));
    }

    _open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _idb(mode, op) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const req = op(db.transaction(STORE, mode).objectStore(STORE));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
}
