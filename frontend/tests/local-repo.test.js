// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LocalRepo } from '../js/local-repo.js';

/** In-memory persistence so tests never touch OPFS/IndexedDB. */
class MemoryPersistence {
    constructor() { this.blob = null; }
    async hasVault() { return this.blob != null; }
    async loadVault() { return this.blob; }
    async saveVault(s) { this.blob = s; }
    async clearVault() { this.blob = null; }
}

// Low KDF cost for fast tests; production uses DEFAULT_ITERATIONS.
const repoOver = (p) => new LocalRepo({ persistence: p, iterations: 1000 });

describe('LocalRepo (local-first, api-compatible adapter)', () => {
    it('creates a vault, returns a recovery code, and starts unlocked', async () => {
        const repo = repoOver(new MemoryPersistence());
        expect(await repo.hasVault()).toBe(false);
        const recovery = await repo.createVault('a good passphrase');
        expect(recovery).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
        expect(repo.isUnlocked()).toBe(true);
        expect(await repo.hasVault()).toBe(true);
        expect((await repo.get('/check')).authenticated).toBe(true);
    });

    it('persists CRUD across a fresh repo + unlock (the export/import-anywhere property)', async () => {
        const p = new MemoryPersistence();
        const repo = repoOver(p);
        await repo.createVault('passphrase');
        const node = await repo.post('/node', { node_type: 'event', title: 'a memory' });
        await repo.put('/settings', { theme: 'soft' });
        expect(node.id).toBe(1);

        const reopened = repoOver(p);
        expect(reopened.isUnlocked()).toBe(false);
        await reopened.unlock('passphrase');
        expect((await reopened.get('/mindmap')).nodes[0].title).toBe('a memory');
        expect((await reopened.get('/settings')).settings.theme).toBe('soft');
    });

    it('rejects the wrong password and stays locked', async () => {
        const p = new MemoryPersistence();
        await repoOver(p).createVault('right');
        const repo = repoOver(p);
        await expect(repo.unlock('wrong')).rejects.toThrow(/Incorrect password/);
        expect(repo.isUnlocked()).toBe(false);
        await expect(repo.get('/mindmap')).rejects.toThrow(/locked/);
    });

    it('unlocks with the recovery code', async () => {
        const p = new MemoryPersistence();
        const recovery = await repoOver(p).createVault('passphrase');
        const repo = repoOver(p);
        await repo.unlock(recovery, 'recovery');
        expect(repo.isUnlocked()).toBe(true);
    });

    it('updates and deletes nodes/edges via the api surface', async () => {
        const repo = repoOver(new MemoryPersistence());
        await repo.createVault('pw');
        const a = await repo.post('/node', { node_type: 'event', title: 'A' });
        const b = await repo.post('/node', { node_type: 'emotion', title: 'B' });
        const e = await repo.post('/edge', { from_node_id: a.id, to_node_id: b.id });

        await repo.put(`/node/${a.id}`, { title: 'A renamed' });
        expect((await repo.get('/mindmap')).nodes.find((n) => n.id === a.id).title).toBe('A renamed');

        await repo.delete(`/edge/${e.id}`);
        await repo.delete(`/node/${b.id}`);
        const map = await repo.get('/mindmap');
        expect(map.nodes.map((n) => n.id)).toEqual([a.id]);
        expect(map.edges).toHaveLength(0);
    });

    it('changes the password while keeping the data', async () => {
        const p = new MemoryPersistence();
        const repo = repoOver(p);
        await repo.createVault('old-pw');
        await repo.post('/node', { node_type: 'event', title: 'kept' });
        await repo.changePassword('old-pw', 'new-pw');

        const reopened = repoOver(p);
        await expect(reopened.unlock('old-pw')).rejects.toThrow();
        await reopened.unlock('new-pw');
        expect((await reopened.get('/mindmap')).nodes[0].title).toBe('kept');
    });

    it('deletes the whole vault ("delete everything")', async () => {
        const p = new MemoryPersistence();
        const repo = repoOver(p);
        await repo.createVault('pw');
        await repo.delete('/account');
        expect(repo.isUnlocked()).toBe(false);
        expect(await repo.hasVault()).toBe(false);
    });
});

describe('encrypted .wymber export / import', () => {
    it('round-trips the map to a fresh device, and the file is ciphertext', async () => {
        const repo1 = repoOver(new MemoryPersistence());
        await repo1.createVault('CorrectHorseBattery9!');
        await repo1.post('/node', { node_type: 'event', title: 'Moving away from home' });

        const exported = await repo1.exportVault();
        expect(typeof exported).toBe('string');
        // The sealed file must not leak the plaintext title.
        expect(exported).not.toContain('Moving away from home');

        // Import into a brand-new "device" and unlock.
        const repo2 = repoOver(new MemoryPersistence());
        await repo2.importVault(exported);
        expect(repo2.isUnlocked()).toBe(false); // import leaves it locked
        await repo2.unlock('CorrectHorseBattery9!');
        expect((await repo2.get('/mindmap')).nodes.map((n) => n.title)).toContain('Moving away from home');
    });

    it('rejects a file that is not a Wymber vault', async () => {
        const repo = repoOver(new MemoryPersistence());
        await expect(repo.importVault('{"definitely":"not a vault"}')).rejects.toThrow();
    });

    it('refuses to export when there is no vault yet', async () => {
        const repo = repoOver(new MemoryPersistence());
        await expect(repo.exportVault()).rejects.toThrow();
    });
});
