// @vitest-environment node
//
// Passkey unlock foundation (#113, ADR-0003 Layer 3): a passkey is an ADDITIONAL wrapped key
// under vault.keys.passkey, never a replacement for the password root, and its entry must never
// raise the vault version stamp (see crypto.js's `versionForVault` and its "passkey" module
// comment) — an old build that has never heard of `keys.passkey` still opens the vault by
// password exactly as before. This file has no UI and no navigator.credentials at module scope;
// the WebAuthn ceremony is stubbed per-test via a fake `navigator.credentials`.
import { describe, it, expect, afterEach } from 'vitest';
import {
    createVault, unlockVault, changePassword, resetPassword, parseVault, serializeVault,
    unwrapDekRaw, VAULT_FORMAT, VAULT_VERSION,
    wrapDekUnderRawSecret, unwrapDekWithRawSecret,
    passkeySupported, enrollPasskey, unlockVaultWithPasskey, PasskeyError,
} from '../js/crypto.js';

const FAST = { iterations: 1000 };
const doc = () => ({
    schemaVersion: 1,
    nodes: [{ id: 1, title: 'a private memory', node_type: 'event' }],
    edges: [],
    settings: { theme: 'soft' },
});

/**
 * A fake authenticator: simulates a real WebAuthn authenticator's PRF extension as a deterministic
 * function of a hardware-side secret (generated once, at `create()`, and never exposed) and the
 * salt the relying party asks to evaluate — the same shape a real PRF-capable key behaves as. Set
 * `supportsPrf: false` to simulate an authenticator that completes the ceremony but never returns
 * a PRF result, which is the case `enrollPasskey` must refuse rather than silently downgrade.
 *
 * `evaluateAtCreation: false` simulates what MOST real browsers actually do: `create()` reports
 * only `prf: { enabled: true }` and does not evaluate the requested salt, so the value can only be
 * obtained from a follow-up `get()`. Enrollment must succeed in that mode — treating the missing
 * creation-time result as "no PRF support" would refuse enrollment on precisely the hardware that
 * supports it. Both modes are exercised below.
 */
function createStubAuthenticator({ supportsPrf = true, evaluateAtCreation = true } = {}) {
    let secret;

    async function prfFor(saltBytes) {
        const key = await crypto.subtle.importKey(
            'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        return crypto.subtle.sign('HMAC', key, saltBytes);
    }

    return {
        credentials: {
            async create(options) {
                const credentialId = crypto.getRandomValues(new Uint8Array(16));
                secret = crypto.getRandomValues(new Uint8Array(32));
                const saltBytes = new Uint8Array(options.publicKey.extensions.prf.eval.first);
                const first = supportsPrf && evaluateAtCreation ? await prfFor(saltBytes) : undefined;
                return {
                    rawId: credentialId.buffer,
                    getClientExtensionResults: () => {
                        if (!supportsPrf) return {};
                        // The realistic case: PRF is supported and advertised, but not evaluated
                        // here — the relying party has to ask for it with a get().
                        return evaluateAtCreation
                            ? { prf: { enabled: true, results: { first } } }
                            : { prf: { enabled: true } };
                    },
                };
            },
            async get(options) {
                const saltBytes = new Uint8Array(options.publicKey.extensions.prf.eval.first);
                const first = supportsPrf ? await prfFor(saltBytes) : undefined;
                return {
                    getClientExtensionResults: () => (
                        supportsPrf ? { prf: { results: { first } } } : {}
                    ),
                };
            },
        },
    };
}

afterEach(() => {
    delete globalThis.navigator;
});

describe('the pure wrap/unwrap core (no WebAuthn ceremony, real WebCrypto)', () => {
    it('round-trips a DEK under a raw 32-byte secret', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const secret = crypto.getRandomValues(new Uint8Array(32));
        const wrapped = await wrapDekUnderRawSecret(dek, secret);
        const unwrapped = await unwrapDekWithRawSecret(wrapped, secret);
        expect(unwrapped).toEqual(dek);
    });

    it('a wrong raw secret fails via GCM authentication, not a silent wrong answer', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const secret = crypto.getRandomValues(new Uint8Array(32));
        const wrongSecret = crypto.getRandomValues(new Uint8Array(32));
        const wrapped = await wrapDekUnderRawSecret(dek, secret);
        await expect(unwrapDekWithRawSecret(wrapped, wrongSecret)).rejects.toThrow();
    });
});

describe('passkeySupported', () => {
    it('reflects whether navigator.credentials is actually usable', () => {
        expect(passkeySupported()).toBe(false);
        globalThis.navigator = createStubAuthenticator();
        expect(passkeySupported()).toBe(true);
    });
});

describe('a passkey entry is additive: password and recovery keep working, unchanged', () => {
    it('unlocks by password and by recovery after a passkey is enrolled', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator();
        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });

        expect(withPasskey.keys.passkey).toBeDefined();
        expect(withPasskey.keys.password).toEqual(vault.keys.password);
        expect(withPasskey.keys.recovery).toEqual(vault.keys.recovery);

        const byPassword = await unlockVault(withPasskey, 'pw');
        expect(byPassword.document.nodes[0].title).toBe('a private memory');
        const byRecovery = await unlockVault(withPasskey, recoveryCode, 'recovery');
        expect(byRecovery.document.nodes[0].title).toBe('a private memory');
    });
});

describe('the lockout guard: a passkey entry must never raise the vault version stamp', () => {
    it('stays version 1 after enrollment, and an old build (ceiling 1) still accepts the vault', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator();
        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });

        expect(withPasskey.version).toBe(VAULT_VERSION);
        expect(withPasskey.version).toBe(1);

        // Simulate an old build's parseVault: same shape, ceiling frozen at version 1 (what every
        // build before passkeys ever existed hardcodes as its own VAULT_VERSION) — it has never
        // heard of `keys.passkey` and never looks it up, so the vault must still parse cleanly.
        function oldBuildParseVault(str) {
            const v = JSON.parse(str);
            if (v?.format !== VAULT_FORMAT) throw new Error('This file is not a Wymber vault.');
            if (v.version > 1) throw new Error('This vault was made by a newer version of Wymber. Please update.');
            return v;
        }
        expect(() => oldBuildParseVault(serializeVault(withPasskey))).not.toThrow();

        // And the current build still opens it by password (the "old build, second device" case
        // this guard exists for: an old build ignores keys.passkey entirely and unlocks by password).
        expect(() => parseVault(serializeVault(withPasskey))).not.toThrow();
        const { document } = await unlockVault(withPasskey, 'pw');
        expect(document.nodes[0].title).toBe('a private memory');
    });
});

describe('enrollment refuses to produce a vault with no password entry', () => {
    it('rejects enrolling onto a vault whose password entry has been stripped', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        const noPasswordVault = { ...vault, keys: { recovery: vault.keys.recovery } };
        globalThis.navigator = createStubAuthenticator();

        await expect(enrollPasskey(noPasswordVault, dek, { rpId: 'localhost' }))
            .rejects.toMatchObject({ code: 'ERR_NO_PASSWORD_ENTRY' });
        expect(noPasswordVault.keys.passkey).toBeUndefined();
    });
});

describe('changePassword / resetPassword leave a passkey entry untouched', () => {
    it('the passkey entry survives changePassword and resetPassword byte-identical', async () => {
        const { vault, recoveryCode } = await createVault(doc(), 'old-pw', FAST);
        const dek = await unwrapDekRaw(vault, 'old-pw');
        globalThis.navigator = createStubAuthenticator();
        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });
        const passkeyBefore = JSON.parse(JSON.stringify(withPasskey.keys.passkey));

        const changed = await changePassword(withPasskey, 'old-pw', 'new-pw');
        expect(changed.keys.passkey).toEqual(passkeyBefore);
        expect(changed.version).toBe(VAULT_VERSION);

        const reset = await resetPassword(changed, recoveryCode, 'newer-pw');
        expect(reset.keys.passkey).toEqual(passkeyBefore);
        expect(reset.version).toBe(VAULT_VERSION);

        // and the passkey itself still unlocks after both password changes (it wraps the same DEK)
        const { document } = await unlockVaultWithPasskey(reset);
        expect(document.nodes[0].title).toBe('a private memory');
    });
});

describe('the WebAuthn PRF ceremony, stubbed', () => {
    it('enrolls and unlocks end to end through a fake navigator.credentials', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator();

        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });
        const { document, dekKey } = await unlockVaultWithPasskey(withPasskey);
        expect(document.nodes[0].title).toBe('a private memory');
        expect(dekKey).toBeDefined();
    });

    it('zeroes the caller-supplied DEK bytes after enrollment (radioactive-handling contract)', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator();

        await enrollPasskey(vault, dek, { rpId: 'localhost' });
        expect(dek).toEqual(new Uint8Array(32));
    });

    it('enrolls against a browser that only evaluates PRF on get(), not on create() — the real-hardware case', async () => {
        // Manager review: enrollment used to read the PRF result off create() alone. Most browsers
        // report only `prf: { enabled: true }` there and never evaluate the salt, so that shape
        // would have thrown PRF_UNSUPPORTED on exactly the authenticators that DO support PRF —
        // failing closed, but leaving the feature dead on arrival on real devices. The stub's
        // `evaluateAtCreation: false` mode is that browser.
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator({ evaluateAtCreation: false });

        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });
        expect(withPasskey.keys.passkey).toBeTruthy();

        // And the enrolled entry really is openable by the same authenticator afterwards: the
        // follow-up get() must have evaluated the SAME salt that was recorded on the entry.
        const { document } = await unlockVaultWithPasskey(withPasskey);
        expect(document.nodes[0].title).toBe('a private memory');

        // Still additive, and still not a version bump.
        expect((await unlockVault(withPasskey, 'pw')).document.nodes[0].title).toBe('a private memory');
        expect(withPasskey.version).toBe(VAULT_VERSION);
    });

    it('refuses to enroll when the authenticator reports no PRF support — never silently downgrading', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator({ supportsPrf: false });

        await expect(enrollPasskey(vault, dek, { rpId: 'localhost' }))
            .rejects.toMatchObject({ code: 'PRF_UNSUPPORTED' });
    });

    it('rejects enrollPasskey and unlockVaultWithPasskey when navigator.credentials is absent', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        // no globalThis.navigator set at all
        await expect(enrollPasskey(vault, dek, { rpId: 'localhost' }))
            .rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
        await expect(unlockVaultWithPasskey(vault)).rejects.toBeInstanceOf(PasskeyError);
    });

    it('unlockVaultWithPasskey reports NOT_ENROLLED for a vault with no passkey entry', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        globalThis.navigator = createStubAuthenticator();
        await expect(unlockVaultWithPasskey(vault)).rejects.toMatchObject({ code: 'NOT_ENROLLED' });
    });
});

describe('tampering is still detected on the passkey entry (authenticated encryption)', () => {
    it('flipping a ciphertext byte on the passkey entry fails to unlock', async () => {
        const { vault } = await createVault(doc(), 'pw', FAST);
        const dek = await unwrapDekRaw(vault, 'pw');
        globalThis.navigator = createStubAuthenticator();
        const withPasskey = await enrollPasskey(vault, dek, { rpId: 'localhost' });

        const ct = withPasskey.keys.passkey.ct;
        withPasskey.keys.passkey.ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
        await expect(unlockVaultWithPasskey(withPasskey)).rejects.toThrow();
    });
});
