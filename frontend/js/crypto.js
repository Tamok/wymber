/**
 * Wymber vault crypto — local-first, zero-knowledge.
 *
 * Envelope encryption: a random Data Encryption Key (DEK) encrypts the document;
 * the DEK is wrapped (encrypted) separately by one Key-Encryption-Key (KEK) per
 * unlock method (password, recovery code, later passkey). Any one method unlocks;
 * changing the password only re-wraps the DEK. See docs/adr/0001.
 *
 * KDF: PBKDF2-SHA256 (native WebCrypto, buildless) is the vault-level default. Each key entry
 * MAY also carry its own `kdf` descriptor that overrides the vault-level one for that entry
 * only (`entry.kdf ?? vault.kdf`) — see the "KDF registry" section below. That is what lets a
 * future KDF (Argon2id, tracked in #100) be adopted lazily, one unlock method at a time, without
 * a flag day: a password re-wrap can upgrade `keys.password` the moment the user's password is
 * in hand, while `keys.recovery` stays on the old KDF until the day they actually use the
 * recovery code (its secret is never "in hand" otherwise). A vault is therefore allowed to be
 * mixed-KDF; every entry resolves its own effective KDF independently.
 * Cipher: AES-256-GCM (authenticated; tampering fails decryption).
 *
 * Runs in the browser and in Node 20+ (both expose globalThis.crypto.subtle).
 */

export const VAULT_FORMAT = 'wymber-vault';

// `VAULT_VERSION` is pinned at 1 deliberately: frontend/tests/native-crypto-parity.test.js (out
// of this module's ownership, must pass untouched) asserts frozen, real-PBKDF2-sealed fixtures'
// `vault.version` against this exact exported constant. Those fixtures were sealed before this
// file existed and their baked-in version is 1, so this constant must stay 1 — it names "the
// version a from-scratch, all-default-KDF vault gets", which every fixture and every vault
// `createVault` produces today still is. The *new* ceiling this build additionally understands
// (a vault with at least one non-default per-entry KDF) is `VAULT_VERSION_KDF_MIX`, below.
export const VAULT_VERSION = 1;

// Stamped instead of VAULT_VERSION the moment any key entry carries an explicit `kdf` descriptor
// (see `versionForKeys`) — including one whose `algo` happens to still be the default, because
// what matters for compatibility is the *shape*: an old build reads `vault.kdf.iterations`
// unconditionally and has no idea `entry.kdf` exists, so any entry that overrides it must be
// hidden from that old build rather than silently mis-derived. `parseVault` accepts up through
// this version and refuses anything newer with the existing "please update" error.
export const VAULT_VERSION_KDF_MIX = 2;

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

// ----- KDF registry -----
//
// A KDF is registered by `algo` name and implements `deriveBits(secret, saltBytes, descriptor)
// -> ArrayBuffer|Uint8Array` (256 bits). `'PBKDF2-SHA256'` is registered below with exactly the
// behaviour this module has always had. `registerKdf` lets a future Argon2id land as a pure
// addition (no change to unlock/wrap logic), and lets tests register a fast stand-in KDF.

/** Thrown when a key entry names a `kdf.algo` this build doesn't have registered. Distinct from
 * "Incorrect password": the secret was never even tried. A user-facing message, not "Incorrect
 * password" — an unsupported KDF means the app needs updating, not that the password is wrong. */
export class UnsupportedKdfError extends Error {
    constructor(algo) {
        super("This vault uses a form of key protection this version of Wymber doesn't support. Please update Wymber.");
        this.name = 'UnsupportedKdfError';
        this.code = 'ERR_UNSUPPORTED_KDF';
        this.algo = algo;
    }
}

const kdfRegistry = new Map();

/** Register (or override, e.g. in tests) a KDF implementation under an `algo` name. */
export function registerKdf(algo, impl) {
    kdfRegistry.set(algo, impl);
}

function getKdf(algo) {
    const impl = kdfRegistry.get(algo);
    if (!impl) throw new UnsupportedKdfError(algo);
    return impl;
}

registerKdf('PBKDF2-SHA256', {
    async deriveBits(secret, saltBytes, descriptor) {
        const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
        return subtle.deriveBits(
            { name: 'PBKDF2', salt: saltBytes, iterations: descriptor.iterations, hash: descriptor.hash ?? 'SHA-256' },
            base,
            256
        );
    },
});

/** The effective KDF descriptor for a key entry: its own override, else the vault-level default. */
function resolveKdf(vault, entry) {
    return entry.kdf ?? vault.kdf;
}

/** Derive an AES-GCM KEK from a secret (password/recovery code) via the named KDF. */
async function deriveKEK(secret, saltBytes, kdfDescriptor) {
    const impl = getKdf(kdfDescriptor.algo);
    const bits = await impl.deriveBits(secret, saltBytes, kdfDescriptor);
    return importAesKey(new Uint8Array(bits));
}

async function wrapDEK(dek, secret, kdfDescriptor) {
    const salt = randomBytes(16);
    const kek = await deriveKEK(secret, salt, kdfDescriptor);
    const wrapped = await aesEncrypt(kek, dek);
    return { salt: toB64(salt), ...wrapped };
}

async function unwrapDEK(entry, secret, kdfDescriptor) {
    const kek = await deriveKEK(secret, fromB64(entry.salt), kdfDescriptor);
    return aesDecrypt(kek, entry); // throws if the secret is wrong (GCM auth fails)
}

/**
 * Turn an unwrap failure into the right error for the caller to throw. A genuine wrong secret
 * fails AES-GCM's tag check, which WebCrypto surfaces as an `OperationError` — only that case
 * becomes the user-facing "Incorrect password/recovery code." message. Everything else
 * (`UnsupportedKdfError`, a corrupted envelope, any internal error) propagates as itself: telling
 * someone their password is wrong when the real problem is an unsupported KDF or a broken
 * envelope is a harmful lie on a vault that has no password-reset fallback.
 */
function translateUnwrapError(err, wrongSecretMessage) {
    if (err && err.name === 'OperationError') return new Error(wrongSecretMessage);
    return err;
}

/** Re-wrap `dek` under `secret`, preserving `existingEntry`'s own KDF descriptor if it had one
 * (never silently drop a previously-upgraded entry back to the vault-level default); otherwise
 * wrap under `fallbackKdf` (today, always the vault-level default). */
async function rewrapPreservingKdf(dek, secret, existingEntry, fallbackKdf) {
    const targetKdf = existingEntry?.kdf ?? fallbackKdf;
    const wrapped = await wrapDEK(dek, secret, targetKdf);
    if (existingEntry?.kdf) wrapped.kdf = existingEntry.kdf;
    return wrapped;
}

/** True once any entry carries an explicit per-entry `kdf` (regardless of its `algo`): that is
 * the structural fact an old build can't see, so it is also what the version stamp keys off. */
function versionForKeys(keys) {
    const mixed = Object.values(keys).some((entry) => entry && entry.kdf);
    return mixed ? VAULT_VERSION_KDF_MIX : VAULT_VERSION;
}

/** The single place that installs a new `keys` object onto a vault: sets `keys`, recomputes the
 * version stamp from what `keys` actually contains, and bumps `updatedAt`. Every function that
 * rewrites `keys` (createVault, changePassword, resetPassword, upgradeVaultKdfEntry) funnels
 * through here so the version stamp can never drift out of sync with the entries it describes.
 * sealDocument (a normal save) never calls this — it only replaces the payload. */
function withKeys(vaultFields, keys) {
    return { ...vaultFields, keys, version: versionForKeys(keys), updatedAt: new Date().toISOString() };
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
    const kdf = { algo: 'PBKDF2-SHA256', hash: 'SHA-256', iterations };
    const dek = randomBytes(32);
    const dekKey = await importAesKey(dek);
    const payload = await aesEncrypt(dekKey, enc.encode(JSON.stringify(documentObj)));

    const recoveryCode = opts.recoveryCode ?? generateRecoveryCode();
    const keys = {
        password: await wrapDEK(dek, password, kdf),
        recovery: await wrapDEK(dek, normalizeRecoveryCode(recoveryCode), kdf),
    };
    const vault = withKeys({
        format: VAULT_FORMAT,
        cipher: 'AES-256-GCM',
        kdf,
        payload,
    }, keys);
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
    const kdfDescriptor = resolveKdf(vault, entry);

    let dek;
    try {
        dek = await unwrapDEK(entry, prepared, kdfDescriptor);
    } catch (err) {
        throw translateUnwrapError(err, method === 'recovery' ? 'Incorrect recovery code.' : 'Incorrect password.');
    }
    const dekKey = await importAesKey(dek);
    const documentObj = JSON.parse(dec.decode(await aesDecrypt(dekKey, vault.payload)));
    return { document: documentObj, dekKey };
}

/**
 * Unwrap the raw DEK bytes with a secret — for enrolling a device unlock method (e.g.
 * biometrics wraps the DEK under a hardware key). Callers must treat the bytes as
 * radioactive: hand them to the enroll step, then zero them.
 */
export async function unwrapDekRaw(vault, secret, method = 'password') {
    const entry = vault.keys?.[method];
    if (!entry) throw new Error(`This vault has no "${method}" key.`);
    const prepared = method === 'recovery' ? normalizeRecoveryCode(secret) : secret;
    const kdfDescriptor = resolveKdf(vault, entry);
    try {
        return await unwrapDEK(entry, prepared, kdfDescriptor);
    } catch (err) {
        throw translateUnwrapError(err, method === 'recovery' ? 'Incorrect recovery code.' : 'Incorrect password.');
    }
}

/**
 * Unlock with the raw DEK itself — device unlock methods (biometrics) hold the DEK, not a
 * passphrase, so there is nothing to derive. GCM auth still rejects a wrong/stale DEK.
 */
export async function unlockVaultWithDek(vault, dekBytes) {
    const dekKey = await importAesKey(dekBytes);
    let documentObj;
    try {
        documentObj = JSON.parse(dec.decode(await aesDecrypt(dekKey, vault.payload)));
    } catch {
        throw new Error('This device key no longer matches the vault.');
    }
    return { document: documentObj, dekKey };
}

/** Re-encrypt the document into the vault using an unlocked DEK key (a normal save). */
export async function sealDocument(vault, dekKey, documentObj) {
    const payload = await aesEncrypt(dekKey, enc.encode(JSON.stringify(documentObj)));
    return { ...vault, payload, updatedAt: new Date().toISOString() };
}

/** Re-wrap the DEK under a new password. Other unlock methods (recovery) are untouched. Preserves
 * the password entry's own KDF descriptor if it had been upgraded to one (see
 * `rewrapPreservingKdf`) — a password change must never silently downgrade it. */
export async function changePassword(vault, oldPassword, newPassword) {
    const entry = vault.keys.password;
    const kdfDescriptor = resolveKdf(vault, entry);
    let dek;
    try {
        dek = await unwrapDEK(entry, oldPassword, kdfDescriptor);
    } catch (err) {
        throw translateUnwrapError(err, 'Incorrect password.');
    }
    const keys = { ...vault.keys, password: await rewrapPreservingKdf(dek, newPassword, entry, vault.kdf) };
    return withKeys(vault, keys);
}

/**
 * Forgot-password recovery: prove ownership with the recovery code, then set a new password.
 * The DEK never leaves this module. Returns the updated vault (unlock with the new password).
 * The fresh password entry preserves whatever KDF the old password entry was already on (see
 * `rewrapPreservingKdf`) — resetting via recovery must not silently downgrade a previously
 * upgraded password entry just because it's being re-derived from scratch.
 */
export async function resetPassword(vault, recoveryCode, newPassword) {
    const entry = vault.keys.recovery;
    const kdfDescriptor = resolveKdf(vault, entry);
    let dek;
    try {
        dek = await unwrapDEK(entry, normalizeRecoveryCode(recoveryCode), kdfDescriptor);
    } catch (err) {
        throw translateUnwrapError(err, 'Incorrect recovery code.');
    }
    const keys = {
        ...vault.keys,
        password: await rewrapPreservingKdf(dek, newPassword, vault.keys.password, vault.kdf),
    };
    return withKeys(vault, keys);
}

/**
 * Lazily upgrade ONE key entry (`method`: 'password' | 'recovery') to a new KDF, using the secret
 * already in hand. This is the only way a mixed-KDF vault ever comes into being: a caller can
 * only re-wrap the entry whose secret it actually has (e.g. on a successful password unlock),
 * never the other one. Verifies `secret` against the CURRENT entry before replacing anything and
 * returns a NEW vault object; never mutates the input.
 *
 * Deliberately unwired: persisting the returned vault is local-repo.js's job, which is outside
 * this module's ownership. `target` is a KDF descriptor, e.g. `{ algo: 'Argon2id', ... }`.
 */
export async function upgradeVaultKdfEntry(vault, method, secret, target) {
    const entry = vault.keys?.[method];
    if (!entry) throw new Error(`This vault has no "${method}" key.`);
    const prepared = method === 'recovery' ? normalizeRecoveryCode(secret) : secret;
    const currentKdf = resolveKdf(vault, entry);

    let dek;
    try {
        dek = await unwrapDEK(entry, prepared, currentKdf);
    } catch (err) {
        throw translateUnwrapError(err, method === 'recovery' ? 'Incorrect recovery code.' : 'Incorrect password.');
    }

    const wrapped = await wrapDEK(dek, prepared, target);
    wrapped.kdf = target; // always explicit: an upgraded entry never falls back to vault.kdf
    const keys = { ...vault.keys, [method]: wrapped };
    return withKeys(vault, keys);
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
    if (vault.version > VAULT_VERSION_KDF_MIX) {
        throw new Error('This vault was made by a newer version of Wymber. Please update.');
    }
    return vault;
}
