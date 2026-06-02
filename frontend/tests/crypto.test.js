// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    createVault, unlockVault, sealDocument, changePassword,
    serializeVault, parseVault, generateRecoveryCode, normalizeRecoveryCode,
} from '../js/crypto.js';

// Low iteration count keeps tests fast; production uses DEFAULT_ITERATIONS (600k).
const FAST = { iterations: 1000 };
const doc = () => ({
    schemaVersion: 1,
    nodes: [{ id: 1, title: 'a private memory', node_type: 'event' }],
    edges: [],
    settings: { theme: 'soft' },
});

describe('vault crypto', () => {
    it('round-trips a document through password unlock', async () => {
        const { vault } = await createVault(doc(), 'correct horse battery', FAST);
        const { document } = await unlockVault(vault, 'correct horse battery');
        expect(document.nodes[0].title).toBe('a private memory');
    });

    it('rejects the wrong password', async () => {
        const { vault } = await createVault(doc(), 'right-pass', FAST);
        await expect(unlockVault(vault, 'wrong-pass')).rejects.toThrow(/Incorrect password/);
    });

    it('unlocks with the recovery code too', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'pw', FAST);
        const { document } = await unlockVault(vault, recoveryCode, 'recovery');
        expect(document.nodes[0].title).toBe('a private memory');
    });

    it('recovery code tolerates messy formatting (case/spaces/separators)', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'pw', FAST);
        const messy = `  ${recoveryCode.toLowerCase().replace(/-/g, ' ')}  `;
        const { document } = await unlockVault(vault, messy, 'recovery');
        expect(document.nodes).toHaveLength(1);
    });

    it('changing the password re-locks the old one but keeps recovery working', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'old-pw', FAST);
        const rewrapped = await changePassword(vault, 'old-pw', 'new-pw');
        await expect(unlockVault(rewrapped, 'old-pw')).rejects.toThrow();
        const reopened = await unlockVault(rewrapped, 'new-pw');
        expect(reopened.document.nodes).toHaveLength(1);
        const viaRecovery = await unlockVault(rewrapped, recoveryCode, 'recovery');
        expect(viaRecovery.document.nodes[0].title).toBe('a private memory');
    });

    it('seals edits without re-deriving the key from the password', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const { document, dekKey } = await unlockVault(vault, 'pw');
        document.nodes.push({ id: 2, title: 'added later', node_type: 'growth' });
        const sealed = await sealDocument(vault, dekKey, document);
        const reopened = await unlockVault(sealed, 'pw');
        expect(reopened.document.nodes.map((n) => n.title)).toContain('added later');
    });

    it('survives export → import (serialize / parse)', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const loaded = parseVault(serializeVault(vault));
        const { document } = await unlockVault(loaded, 'pw');
        expect(document.nodes[0].title).toBe('a private memory');
    });

    it('rejects a file that is not a Wymber vault', () => {
        expect(() => parseVault(JSON.stringify({ hello: 'world' }))).toThrow(/not a Wymber vault/);
    });

    it('detects tampering via authenticated encryption', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const ct = vault.payload.ct;
        vault.payload.ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1); // flip a ciphertext byte
        await expect(unlockVault(vault, 'pw')).rejects.toThrow();
    });

    it('generates distinct 120-bit recovery codes', () => {
        const a = generateRecoveryCode();
        const b = generateRecoveryCode();
        expect(a).not.toBe(b);
        expect(normalizeRecoveryCode(a)).toHaveLength(24);
    });
});
