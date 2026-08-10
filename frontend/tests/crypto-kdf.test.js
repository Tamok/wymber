// @vitest-environment node
//
// Self-describing per-entry KDF (#100, step 1 of the Argon2id migration): a vault must be able
// to carry mixed-KDF key entries (`entry.kdf ?? vault.kdf`) so a lazy upgrade can re-wrap the
// entry whose secret is in hand without touching the other one, and an old build must refuse a
// vault it can't fully read *loudly* (VAULT_VERSION_KDF_MIX + parseVault) rather than silently
// misderiving and reporting "Incorrect password". See frontend/js/crypto.js's top-of-file comment
// and frontend/tests/native-crypto-parity.test.js for the frozen-fixture backward-compat proof
// this file complements (this file must never touch that one).
import { describe, it, expect } from 'vitest';
import {
    createVault, unlockVault, changePassword, resetPassword, parseVault, serializeVault,
    registerKdf, upgradeVaultKdfEntry, UnsupportedKdfError,
    VAULT_FORMAT, VAULT_VERSION, VAULT_VERSION_KDF_MIX,
} from '../js/crypto.js';

const FAST = { iterations: 1000 };
const doc = () => ({
    schemaVersion: 1,
    nodes: [{ id: 1, title: 'a private memory', node_type: 'event' }],
    edges: [],
    settings: { theme: 'soft' },
});

// A stand-in KDF for tests: deterministic, fast, and distinguishable from PBKDF2-SHA256 so
// mixed-KDF unlock can be proven without waiting on real Argon2id (out of scope for this PR).
// Deriving via HMAC keeps it real WebCrypto (not a fake), just a different `algo` name/shape.
registerKdf('TEST-KDF', {
    async deriveBits(secret, saltBytes, descriptor) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', enc.encode(`test-kdf:${descriptor.pepper}:${secret}`), { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, saltBytes);
        return sig.slice(0, 32);
    },
});

describe('vaults created by this build (unchanged shape for the common case)', () => {
    it('a fresh vault with only PBKDF2 entries is stamped version 1, no per-entry kdf field', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        expect(vault.version).toBe(VAULT_VERSION);
        expect(vault.version).toBe(1);
        expect(vault.keys.password.kdf).toBeUndefined();
        expect(vault.keys.recovery.kdf).toBeUndefined();
        // still unlocks normally
        const { document } = await unlockVault(vault, 'pw');
        expect(document.nodes[0].title).toBe('a private memory');
    });
});

describe('mixed-KDF vaults (one entry upgraded, the other left on the old KDF)', () => {
    it('unlocks by password (new KDF) and by recovery (still PBKDF2) from the same vault', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'pw', FAST);
        const target = { algo: 'TEST-KDF', pepper: 'p1' };
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'pw', target);

        expect(upgraded.keys.password.kdf).toEqual(target);
        expect(upgraded.keys.recovery.kdf).toBeUndefined(); // untouched, still inherits vault.kdf

        const byPassword = await unlockVault(upgraded, 'pw');
        expect(byPassword.document.nodes[0].title).toBe('a private memory');

        const byRecovery = await unlockVault(upgraded, recoveryCode, 'recovery');
        expect(byRecovery.document.nodes[0].title).toBe('a private memory');
    });

    it('upgradeVaultKdfEntry never mutates the input vault', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const before = JSON.parse(JSON.stringify(vault));
        await upgradeVaultKdfEntry(vault, 'password', 'pw', { algo: 'TEST-KDF', pepper: 'p1' });
        expect(vault).toEqual(before);
    });

    it('verifies the secret before replacing anything (wrong secret leaves the entry untouched)', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        await expect(
            upgradeVaultKdfEntry(vault, 'password', 'wrong-pw', { algo: 'TEST-KDF', pepper: 'p1' })
        ).rejects.toThrow(/Incorrect password/);
    });

    it('is stamped version 2, and an old build (version ceiling 1) refuses it loudly, not as "Incorrect password"', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'pw', { algo: 'TEST-KDF', pepper: 'p1' });
        expect(upgraded.version).toBe(VAULT_VERSION_KDF_MIX);
        expect(upgraded.version).toBe(2);

        // Simulate an old build's parseVault: same shape, ceiling frozen at version 1 (what
        // every build before this one hardcodes as its own VAULT_VERSION).
        function oldBuildParseVault(str) {
            const v = JSON.parse(str);
            if (v?.format !== VAULT_FORMAT) throw new Error('This file is not a Wymber vault.');
            if (v.version > 1) throw new Error('This vault was made by a newer version of Wymber. Please update.');
            return v;
        }
        expect(() => oldBuildParseVault(serializeVault(upgraded)))
            .toThrow('This vault was made by a newer version of Wymber. Please update.');
    });

    it('the current build\'s parseVault accepts both version 1 and the mixed-KDF version 2', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'pw', { algo: 'TEST-KDF', pepper: 'p1' });
        expect(() => parseVault(serializeVault(vault))).not.toThrow();
        expect(() => parseVault(serializeVault(upgraded))).not.toThrow();
    });
});

describe('the version gate also catches a non-baseline VAULT-LEVEL kdf (the likeliest Argon2id wiring)', () => {
    // Manager review: the stamp must not key off per-entry overrides alone. Whoever wires
    // Argon2id will most naturally switch the default in createVault, which leaves NO per-entry
    // override anywhere. If that vault were still stamped version 1, an old build would read
    // vault.kdf.iterations, run PBKDF2 against an Argon2id-wrapped entry, fail the GCM tag, and
    // report "Incorrect password" — telling a user their password is wrong when their data is
    // fine and the app is simply out of date. On a vault with no reset path that is the worst
    // failure this module can produce, so it gets its own test.
    it('re-stamps a vault-level non-baseline KDF to version 2 even with no per-entry override', async () => {
        // Build the envelope a "just change the default" build would write: both entries wrapped
        // under a vault-level TEST-KDF, and NO per-entry descriptors anywhere. Constructed through
        // the module's own exported surface, then the descriptors are promoted to the vault level.
        const { vault, recoveryCode } = await createVault(doc(), 'pw', FAST);
        const vaultKdf = { algo: 'TEST-KDF', pepper: 'vault-default' };
        let v = await upgradeVaultKdfEntry(vault, 'password', 'pw', vaultKdf);
        v = await upgradeVaultKdfEntry(v, 'recovery', recoveryCode, vaultKdf);
        const keys = Object.fromEntries(
            Object.entries(v.keys).map(([name, { kdf: _promoted, ...rest }]) => [name, rest])
        );
        // Deliberately mis-stamped as version 1 — this is exactly the state the old code would
        // have produced and happily left alone.
        const futureStyle = { ...v, kdf: vaultKdf, keys, version: VAULT_VERSION };

        expect(futureStyle.keys.password.kdf).toBeUndefined();
        expect(futureStyle.keys.recovery.kdf).toBeUndefined();
        expect((await unlockVault(futureStyle, 'pw')).document.nodes[0].title).toBe('a private memory');

        // Now drive a real keys-rewriting path and let the MODULE decide the stamp. It must
        // correct the version from the vault-level algo alone. Against the pre-review code this
        // assertion fails with 1, and that version-1 vault would reach an old build and be
        // reported to the user as "Incorrect password".
        const restamped = await changePassword(futureStyle, 'pw', 'new-pw');
        expect(restamped.version).toBe(VAULT_VERSION_KDF_MIX);
        expect(restamped.keys.password.kdf).toBeUndefined(); // still no per-entry override
        expect((await unlockVault(restamped, 'new-pw')).document.nodes[0].title).toBe('a private memory');
    });
});

describe('unsupported KDF', () => {
    it('unlocking an entry with an unregistered algo throws a distinct error, never "Incorrect password"', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const tampered = {
            ...vault,
            keys: { ...vault.keys, password: { ...vault.keys.password, kdf: { algo: 'ARGON2ID-FUTURE' } } },
        };
        await expect(unlockVault(tampered, 'pw')).rejects.toBeInstanceOf(UnsupportedKdfError);
        await expect(unlockVault(tampered, 'pw')).rejects.not.toThrow(/Incorrect password/);
        await expect(unlockVault(tampered, 'pw')).rejects.toThrow(/update Wymber/);
    });
});

describe('a genuinely wrong secret still says "Incorrect password" / "Incorrect recovery code" (fix #3 did not over-broaden)', () => {
    it('wrong password against an entry on a registered non-default KDF', async () => {
        const { vault } = await createVault(doc(), 'right-pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'right-pw', { algo: 'TEST-KDF', pepper: 'p2' });
        await expect(unlockVault(upgraded, 'wrong-pw')).rejects.toThrow('Incorrect password.');
    });

    it('wrong recovery code still says "Incorrect recovery code."', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        await expect(unlockVault(vault, 'TOTALLY-WRONG-CODE', 'recovery')).rejects.toThrow('Incorrect recovery code.');
    });
});

describe('changePassword / resetPassword preserve a per-entry KDF instead of downgrading it', () => {
    it('changePassword keeps the password entry on its upgraded KDF, and recovery still works', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'old-pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'old-pw', { algo: 'TEST-KDF', pepper: 'p3' });
        const changed = await changePassword(upgraded, 'old-pw', 'new-pw');

        expect(changed.keys.password.kdf).toEqual({ algo: 'TEST-KDF', pepper: 'p3' });
        const { document } = await unlockVault(changed, 'new-pw');
        expect(document.nodes[0].title).toBe('a private memory');
        const viaRecovery = await unlockVault(changed, recoveryCode, 'recovery');
        expect(viaRecovery.document.nodes[0].title).toBe('a private memory');
    });

    it('resetPassword (via recovery) keeps the old password entry\'s KDF rather than reverting to the vault default', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'old-pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'old-pw', { algo: 'TEST-KDF', pepper: 'p4' });
        const reset = await resetPassword(upgraded, recoveryCode, 'brand-new-pw');

        expect(reset.keys.password.kdf).toEqual({ algo: 'TEST-KDF', pepper: 'p4' });
        const { document } = await unlockVault(reset, 'brand-new-pw');
        expect(document.nodes[0].title).toBe('a private memory');
        // old password no longer works
        await expect(unlockVault(reset, 'old-pw')).rejects.toThrow();
    });

    it('changePassword still behaves exactly as before when no entry has been upgraded', async () => {
        const { vault } = await createVault(doc(), 'old-pw', FAST);
        const changed = await changePassword(vault, 'old-pw', 'new-pw');
        expect(changed.keys.password.kdf).toBeUndefined();
        expect(changed.version).toBe(VAULT_VERSION);
    });
});

describe('tampering is still detected on a mixed-KDF vault (authenticated encryption)', () => {
    it('flipping a ciphertext byte on an upgraded entry still fails to unlock', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const upgraded = await upgradeVaultKdfEntry(vault, 'password', 'pw', { algo: 'TEST-KDF', pepper: 'p5' });
        const ct = upgraded.keys.password.ct;
        upgraded.keys.password.ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
        await expect(unlockVault(upgraded, 'pw')).rejects.toThrow('Incorrect password.');
    });
});
