// @vitest-environment node
//
// Biometric shim tests (#166): the JS-side face of BiometricVaultPlugin.java. These mock
// window.Capacitor.Plugins.BiometricVault (the same way native-persistence.test.js mocks the
// Filesystem plugin) and assert: off-native-shell inertness, a byte-exact base64 round trip of
// the DEK through enroll/unlock, the error-code contract app.js branches on (CANCELLED /
// INVALIDATED / NOT_ENROLLED / fallback ERROR), and the new biometricDisable() boolean contract.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    biometricAvailable, biometricEnrolled, biometricEnroll, biometricUnlock, biometricDisable,
} from '../js/native-biometric.js';

/** A minimal in-memory stand-in for window.Capacitor.Plugins.BiometricVault. */
function makePlugin(overrides = {}) {
    let stored = null; // last enrolled DEK, base64 (mirrors the native wrapped-DEK round trip)
    return {
        isAvailable: vi.fn(async () => ({ available: true, code: 0 })),
        isEnrolled: vi.fn(async () => ({ enrolled: stored !== null })),
        enroll: vi.fn(async ({ dek }) => { stored = dek; return { enrolled: true }; }),
        unlock: vi.fn(async () => {
            if (stored === null) {
                const e = new Error('Not enrolled');
                e.code = 'NOT_ENROLLED';
                throw e;
            }
            return { dek: stored };
        }),
        disable: vi.fn(async () => { stored = null; return { enrolled: false }; }),
        ...overrides,
    };
}

function installNativeShell(plugin) {
    globalThis.Capacitor = { Plugins: { BiometricVault: plugin }, isNativePlatform: () => true };
}

afterEach(() => { delete globalThis.Capacitor; });

describe('off the native shell (no Capacitor global): everything is inert, nothing throws a raw TypeError', () => {
    it('biometricAvailable / biometricEnrolled resolve false', async () => {
        expect(await biometricAvailable()).toBe(false);
        expect(await biometricEnrolled()).toBe(false);
    });

    it('biometricDisable resolves false (no-op, never throws)', async () => {
        expect(await biometricDisable()).toBe(false);
    });

    it('biometricEnroll rejects with a clear error, not a null-dereference TypeError', async () => {
        await expect(biometricEnroll(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not available/i);
    });

    it('biometricUnlock rejects with a clear error carrying the fallback ERROR code, not a TypeError', async () => {
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'ERROR' });
        await expect(biometricUnlock()).rejects.toThrow(/not available/i);
    });
});

describe('native shell present but the plugin never registered: same clear-error contract', () => {
    function installShellNoPlugin() {
        globalThis.Capacitor = { Plugins: {}, isNativePlatform: () => true };
    }

    it('biometricAvailable / biometricEnrolled resolve false', async () => {
        installShellNoPlugin();
        expect(await biometricAvailable()).toBe(false);
        expect(await biometricEnrolled()).toBe(false);
    });

    it('biometricDisable resolves false', async () => {
        installShellNoPlugin();
        expect(await biometricDisable()).toBe(false);
    });

    it('biometricEnroll / biometricUnlock reject with a clear error instead of a TypeError', async () => {
        installShellNoPlugin();
        await expect(biometricEnroll(new Uint8Array([1]))).rejects.toThrow(/not available/i);
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'ERROR' });
    });
});

describe('availability / enrollment reporting (native shell present)', () => {
    it('reflects the native plugin result', async () => {
        installNativeShell(makePlugin());
        expect(await biometricAvailable()).toBe(true);
    });

    it('collapses a native isAvailable throw to false (never propagates)', async () => {
        installNativeShell(makePlugin({ isAvailable: vi.fn(async () => { throw new Error('boom'); }) }));
        expect(await biometricAvailable()).toBe(false);
    });

    it('collapses a native isEnrolled throw to false (never propagates)', async () => {
        installNativeShell(makePlugin({ isEnrolled: vi.fn(async () => { throw new Error('boom'); }) }));
        expect(await biometricEnrolled()).toBe(false);
    });
});

describe('DEK round trip through enroll/unlock (byte-exact, base64 in between)', () => {
    it('the exact bytes handed to biometricEnroll come back unchanged from biometricUnlock', async () => {
        const plugin = makePlugin();
        installNativeShell(plugin);
        const original = new Uint8Array(32);
        for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 3) % 256; // non-trivial pattern
        // Defensive copy: the shim must not require (or mutate) the caller's array in place.
        const dek = new Uint8Array(original);

        await biometricEnroll(dek);
        expect(plugin.enroll).toHaveBeenCalledWith({ dek: expect.any(String) });

        const recovered = await biometricUnlock();
        expect(recovered).toBeInstanceOf(Uint8Array);
        expect(Array.from(recovered)).toEqual(Array.from(original));
    });

    it('round-trips bytes across the full 0..255 range, including 0x00 and 0xff', async () => {
        const plugin = makePlugin();
        installNativeShell(plugin);
        const dek = new Uint8Array(256);
        for (let i = 0; i < 256; i++) dek[i] = i;

        await biometricEnroll(dek);
        const recovered = await biometricUnlock();
        expect(Array.from(recovered)).toEqual(Array.from(dek));
    });

    it('reports enrolled=true only after a successful enroll', async () => {
        installNativeShell(makePlugin());
        expect(await biometricEnrolled()).toBe(false);
        await biometricEnroll(new Uint8Array([9, 9, 9]));
        expect(await biometricEnrolled()).toBe(true);
    });
});

describe('error-code contract from biometricUnlock (what app.js branches on)', () => {
    function withUnlockRejecting(message, code) {
        const err = new Error(message);
        if (code !== undefined) err.code = code;
        return makePlugin({ unlock: vi.fn(async () => { throw err; }) });
    }

    it('propagates CANCELLED (user backed out / chose "Use password")', async () => {
        installNativeShell(withUnlockRejecting('User canceled', 'CANCELLED'));
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'CANCELLED' });
    });

    it('propagates INVALIDATED (device biometrics changed; enrollment self-deleted)', async () => {
        installNativeShell(withUnlockRejecting('Biometrics changed', 'INVALIDATED'));
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'INVALIDATED' });
    });

    it('propagates NOT_ENROLLED', async () => {
        installNativeShell(withUnlockRejecting('Not enrolled', 'NOT_ENROLLED'));
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'NOT_ENROLLED' });
    });

    it('propagates KEYSTORE_UNAVAILABLE distinctly from NOT_ENROLLED (#166 review)', async () => {
        // The native side reports this when it could not consult the Keystore at all. It must stay
        // its own code: app.js only hides the unlock button for INVALIDATED/NOT_ENROLLED, and the
        // enrollment is still intact here, so collapsing it into those would be wrong.
        installNativeShell(withUnlockRejecting('Keystore unavailable', 'KEYSTORE_UNAVAILABLE'));
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'KEYSTORE_UNAVAILABLE' });
    });

    it('falls back to ERROR when the native rejection carries no code at all', async () => {
        installNativeShell(withUnlockRejecting('Something went wrong'));
        await expect(biometricUnlock()).rejects.toMatchObject({ code: 'ERROR' });
    });

    it('falls back to a generic message when the native rejection carries none', async () => {
        const plugin = makePlugin({ unlock: vi.fn(async () => { throw {}; }) });
        installNativeShell(plugin);
        await expect(biometricUnlock()).rejects.toThrow(/biometric unlock failed/i);
    });
});

describe('biometricDisable() boolean contract', () => {
    it('resolves true when the native plugin confirms the disable (does not reject)', async () => {
        installNativeShell(makePlugin());
        expect(await biometricDisable()).toBe(true);
    });

    it('resolves false (never throws) when the native disable call rejects', async () => {
        installNativeShell(makePlugin({ disable: vi.fn(async () => { throw new Error('keystore busy'); }) }));
        await expect(biometricDisable()).resolves.toBe(false);
    });

    it('actually clears enrollment: isEnrolled is false after a confirmed disable', async () => {
        const plugin = makePlugin();
        installNativeShell(plugin);
        await biometricEnroll(new Uint8Array([1, 2, 3]));
        expect(await biometricEnrolled()).toBe(true);

        expect(await biometricDisable()).toBe(true);
        expect(await biometricEnrolled()).toBe(false);
    });
});
