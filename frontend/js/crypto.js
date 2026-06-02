/**
 * Wymber vault crypto — local-first, zero-knowledge.
 *
 * Envelope encryption: a random Data Encryption Key (DEK) encrypts the document;
 * the DEK is wrapped (encrypted) separately by one Key-Encryption-Key (KEK) per
 * unlock method (password, recovery code, later passkey). Any one method unlocks;
 * changing the password only re-wraps the DEK. See docs/adr/0001.
 *
 * KDF: PBKDF2-SHA256 (native WebCrypto, buildless). Argon2id is the planned upgrade —
 * the header names the KDF, so swapping it is backward-compatible.
 * Cipher: AES-256-GCM (authenticated; tampering fails decryption).
 *
 * Runs in the browser and in Node 20+ (both expose globalThis.crypto.subtle).
 */

export const VAULT_FORMAT = 'wymber-vault';
export const VAULT_VERSION = 1;
// OWASP-recommended PBKDF2-SHA256 count (matches the server's KDF hardening).
export const DEFAULT_ITERATIONS = 600000;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ----- byte / base64 helpers (work in browser + Node) -----

function randomBytes(n) {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
}

function toB64(bytes) {
    let s = '';
    for (const byte of bytes) s += String.fromCharCode(byte);
    return btoa(s);
}

function fromB64(str) {
    const s = atob(str);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
}

// ----- primitives -----

async function importAesKey(rawBytes) {
    return subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(key, plaintextBytes) {
    const nonce = randomBytes(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintextBytes));
    return { nonce: toB64(nonce), ct: toB64(ct) };
}

async function aesDecrypt(key, wrapped) {
    const pt = await subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(wrapped.nonce) }, key, fromB64(wrapped.ct)
    );
    return new Uint8Array(pt);
}

/** Derive an AES-GCM KEK from a secret (password/recovery code) via PBKDF2. */
async function deriveKEK(secret, salt, iterations) {
    const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256
    );
    return importAesKey(new Uint8Array(bits));
}

async function wrapDEK(dek, secret, iterations) {
    const salt = randomBytes(16);
    const kek = await deriveKEK(secret, salt, iterations);
    const wrapped = await aesEncrypt(kek, dek);
    return { salt: toB64(salt), ...wrapped };
}

async function unwrapDEK(entry, secret, iterations) {
    const kek = await deriveKEK(secret, fromB64(entry.salt), iterations);
    return aesDecrypt(kek, entry); // throws if the secret is wrong (GCM auth fails)
}

// ----- recovery code (120-bit, Crockford base32, grouped) -----

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars; 256 % 32 == 0 → unbiased

/** A human-friendly, high-entropy recovery code: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCode() {
    const r = randomBytes(24);
    let out = '';
    for (let i = 0; i < 24; i++) out += CROCKFORD[r[i] % 32];
    return out.replace(/(.{4})(?=.)/g, '$1-');
}

/** Normalize user-entered recovery codes (case, separators, Crockford O/0 & I/L → 0/1). */
export function normalizeRecoveryCode(code) {
    return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// ----- vault lifecycle -----

/**
 * Create a vault from a document. Returns the vault plus the one-time recovery code
 * (show it once, then forget it — we only ever store the wrapped DEK).
 */
export async function createVault(documentObj, password, opts = {}) {
    const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
    const dek = randomBytes(32);
    const dekKey = await importAesKey(dek);
    const payload = await aesEncrypt(dekKey, enc.encode(JSON.stringify(documentObj)));

    const recoveryCode = opts.recoveryCode ?? generateRecoveryCode();
    const vault = {
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        cipher: 'AES-256-GCM',
        kdf: { algo: 'PBKDF2-SHA256', hash: 'SHA-256', iterations },
        keys: {
            password: await wrapDEK(dek, password, iterations),
            recovery: await wrapDEK(dek, normalizeRecoveryCode(recoveryCode), iterations),
        },
        payload,
        updatedAt: new Date().toISOString(),
    };
    return { vault, recoveryCode };
}

/**
 * Unlock a vault with a secret. `method` is 'password' or 'recovery'.
 * Returns the decrypted document plus the DEK key (so saves don't re-derive from the password).
 */
export async function unlockVault(vault, secret, method = 'password') {
    const entry = vault.keys?.[method];
    if (!entry) throw new Error(`This vault has no "${method}" key.`);
    const prepared = method === 'recovery' ? normalizeRecoveryCode(secret) : secret;

    let dek;
    try {
        dek = await unwrapDEK(entry, prepared, vault.kdf.iterations);
    } catch {
        throw new Error(method === 'recovery' ? 'Incorrect recovery code.' : 'Incorrect password.');
    }
    const dekKey = await importAesKey(dek);
    const documentObj = JSON.parse(dec.decode(await aesDecrypt(dekKey, vault.payload)));
    return { document: documentObj, dekKey };
}

/** Re-encrypt the document into the vault using an unlocked DEK key (a normal save). */
export async function sealDocument(vault, dekKey, documentObj) {
    const payload = await aesEncrypt(dekKey, enc.encode(JSON.stringify(documentObj)));
    return { ...vault, payload, updatedAt: new Date().toISOString() };
}

/** Re-wrap the DEK under a new password. Other unlock methods (recovery) are untouched. */
export async function changePassword(vault, oldPassword, newPassword) {
    const entry = vault.keys.password;
    const dek = await unwrapDEK(entry, oldPassword, vault.kdf.iterations).catch(() => {
        throw new Error('Incorrect password.');
    });
    const keys = { ...vault.keys, password: await wrapDEK(dek, newPassword, vault.kdf.iterations) };
    return { ...vault, keys, updatedAt: new Date().toISOString() };
}

/** Serialize a vault to a string for export / file storage, and back. */
export function serializeVault(vault) {
    return JSON.stringify(vault);
}

export function parseVault(str) {
    const vault = JSON.parse(str);
    if (vault?.format !== VAULT_FORMAT) {
        throw new Error('This file is not a Wymber vault.');
    }
    if (vault.version > VAULT_VERSION) {
        throw new Error('This vault was made by a newer version of Wymber. Please update.');
    }
    return vault;
}
