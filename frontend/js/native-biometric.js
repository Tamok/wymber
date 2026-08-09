/**
 * Biometric unlock shim — the web-side face of the native BiometricVault plugin
 * (mobile/android/.../BiometricVaultPlugin.java, issue #146, ADR-0005).
 *
 * Key-release model: the vault's DEK is wrapped by a hardware-backed, biometric-gated
 * Keystore key on the device. Enrolling hands the native side the raw DEK once; unlocking
 * releases it back after a successful biometric prompt. The password and recovery code
 * remain the portable unlock roots (ADR-0001) — this is device-local convenience.
 *
 * Everything here no-ops gracefully on the web build (the plugin only exists inside the
 * Capacitor shell), so app.js can call it unconditionally.
 */
import { isNativeShell } from './native-persistence.js';

function plugin() {
    return globalThis.Capacitor?.Plugins?.BiometricVault ?? null;
}

/** True when the native shell is present, the plugin is registered, and hardware allows it. */
export async function biometricAvailable() {
    if (!isNativeShell() || !plugin()) return false;
    try {
        const { available } = await plugin().isAvailable();
        return available === true;
    } catch {
        return false;
    }
}

export async function biometricEnrolled() {
    if (!isNativeShell() || !plugin()) return false;
    try {
        const { enrolled } = await plugin().isEnrolled();
        return enrolled === true;
    } catch {
        return false;
    }
}

/** Wrap the raw DEK (Uint8Array) under the device's biometric-gated key. Shows the prompt. */
export async function biometricEnroll(dekBytes) {
    const p = plugin();
    if (!p) throw new Error('Biometric plugin is not available.');
    await p.enroll({ dek: toB64(dekBytes) });
}

/**
 * Release the DEK after a biometric prompt. Returns a Uint8Array.
 * Throws with .code === 'CANCELLED' (user backed out), 'INVALIDATED' (device biometrics
 * changed; the enrollment self-deleted), 'NOT_ENROLLED', 'KEYSTORE_UNAVAILABLE' (the device
 * keystore could not be consulted — the enrollment is intact, this is retryable and must NOT be
 * treated as "not enrolled"), or the fallback 'ERROR'.
 */
export async function biometricUnlock() {
    const p = plugin();
    if (!p) {
        const err = new Error('Biometric plugin is not available.');
        err.code = 'ERROR';
        throw err;
    }
    try {
        const { dek } = await p.unlock();
        return fromB64(dek);
    } catch (e) {
        const err = new Error(e?.message || 'Biometric unlock failed.');
        err.code = e?.code || 'ERROR';
        throw err;
    }
}

/**
 * Turn off biometric unlock. Returns true only when the native side confirmed the Keystore
 * entry + wrapped-DEK prefs were actually cleared; false on no-op (web build, plugin missing)
 * or failure. Never throws, so callers can `await` it unconditionally.
 */
export async function biometricDisable() {
    if (!isNativeShell() || !plugin()) return false;
    try {
        await plugin().disable();
        return true;
    } catch {
        return false;
    }
}

// ----- base64 helpers (self-contained; crypto.js keeps its own private) -----

function toB64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function fromB64(str) {
    const s = atob(str);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
}
