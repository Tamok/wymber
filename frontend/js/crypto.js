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

// Stamped instead of VAULT_VERSION the moment any key entry carries an explicit `kdf` descriptor,
// or the vault-level `kdf.algo` itself is no longer the baseline (see `versionForVault`, and
// docs/adr/0008 for the rule) — including an override whose `algo` happens to still be the
// default, because
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

/** The KDF every build before this one assumes unconditionally. Anything an old build would not
 * derive correctly has to sit behind the version gate. */
const BASELINE_KDF_ALGO = 'PBKDF2-SHA256';

/**
 * The version stamp for a vault, computed from what an OLD build would actually be able to derive.
 * An old build reads `vault.kdf` unconditionally and has never heard of `entry.kdf`, so there are
 * two independent ways a vault can become unreadable to it, and BOTH must raise the stamp:
 *
 *  1. Any entry carries an explicit per-entry `kdf` — regardless of its `algo`, because even a
 *     same-algo override with different parameters (say different iterations) would be silently
 *     mis-derived by a build that can't see the override.
 *  2. The vault-level `kdf.algo` itself is no longer the baseline. This is the case that matters
 *     most for whoever wires Argon2id: switching the default in `createVault` is the obvious move,
 *     and it leaves no per-entry override anywhere. Keying the stamp only off (1) would leave such
 *     a vault stamped version 1, and an old build would run PBKDF2 against an Argon2id-wrapped
 *     entry, fail the GCM tag check, and tell the user "Incorrect password" — the precise
 *     silently-wrong failure this whole gate exists to make impossible.
 */
function versionForVault(vaultKdf, keys) {
    const hasEntryOverride = Object.entries(keys).some(([name, entry]) => {
        // `passkey` is deliberately excluded here, EXPLICITLY by name, not because it happens
        // not to carry a `kdf` field today. An old build never looks up `vault.keys.passkey` at
        // all — it only ever reads `keys.password` / `keys.recovery` — so a passkey entry is
        // invisible and harmless to it, and such a vault still opens perfectly by password there.
        // Raising the version stamp for a passkey entry would turn an additive convenience into a
        // lockout: a user who enrols a passkey on this build could no longer open their vault on
        // an older build or a second device, even with their correct password. See
        // docs/adr/0003 Layer 3 and frontend/tests/crypto-passkey.test.js.
        if (name === 'passkey') return false;
        return entry && entry.kdf;
    });
    const nonBaselineDefault = (vaultKdf?.algo ?? BASELINE_KDF_ALGO) !== BASELINE_KDF_ALGO;
    return hasEntryOverride || nonBaselineDefault ? VAULT_VERSION_KDF_MIX : VAULT_VERSION;
}

/** Refuse to install a `keys` object with no `password` entry. Passkeys (and any other unlock
 * method added later) are additive only, never a replacement for the password root: the password
 * is the one unlock method every build, every fixture, and the forgot-password flow all assume
 * exists. This is deliberately a hard invariant of `withKeys`, the single funnel every
 * keys-rewriting function goes through, rather than something each caller has to remember. */
function assertHasPasswordEntry(keys) {
    if (!keys?.password) {
        const err = new Error(
            'Refusing to produce a vault with no password entry: passkeys and any other unlock ' +
            'method are additive only, never a replacement for the password root.'
        );
        err.code = 'ERR_NO_PASSWORD_ENTRY';
        throw err;
    }
}

/** The single place that installs a new `keys` object onto a vault: sets `keys`, recomputes the
 * version stamp from what `keys` actually contains, and bumps `updatedAt`. Every function that
 * rewrites `keys` (createVault, changePassword, resetPassword, upgradeVaultKdfEntry, enrollPasskey)
 * funnels through here so the version stamp can never drift out of sync with the entries it
 * describes, and so the "always has a password entry" invariant is enforced in one place.
 * sealDocument (a normal save) never calls this — it only replaces the payload. */
function withKeys(vaultFields, keys) {
    assertHasPasswordEntry(keys);
    return {
        ...vaultFields,
        keys,
        version: versionForVault(vaultFields.kdf, keys),
        updatedAt: new Date().toISOString(),
    };
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

// ----- passkey unlock (WebAuthn PRF, issue #113, ADR-0003 Layer 3) -----
//
// A passkey is an ADDITIONAL wrapped key under `vault.keys.passkey`, alongside `password` and
// `recovery` — never a replacement for either (`assertHasPasswordEntry`, above, refuses to write
// a vault without a password entry). Precisely what a passkey does and does not protect here (see
// docs/adr/0003 Layer 3 and docs/adr/0006's "Adjacent, not evaluated as a recovery method:
// passkeys / WebAuthn"):
//
//  - It releases a WRAPPING KEY (a KEK), not the DEK itself and not a recovery root. Losing the
//    device/authenticator that holds the passkey does not lose the vault: password and recovery
//    remain the portable ways in, the same framing native-biometric.js already uses for its
//    device-local "key-release model."
//  - It protects against a PHISHED USER: a passkey registered to this origin cannot be used, or
//    even asked to run its ceremony, by a clone hosted on a different origin — the browser
//    enforces that, this module does not reimplement it. That origin binding is the entire value
//    of Layer 3.
//  - It does NOT protect a stolen `.wymber` file whose password is weak. The file is the whole
//    secret; anyone holding it who also has (or guesses) the password can still open it. A
//    passkey narrows the phishing surface, it does not change what a stolen file plus a weak
//    password can do.
//
// The WebAuthn `prf` extension is REQUIRED, not merely preferred, and enrollment REFUSES outright
// if it isn't available (`PRF_UNSUPPORTED`). A bare WebAuthn assertion by itself proves only that
// a ceremony happened; nothing stops a relying party from treating "the assertion succeeded" as
// good enough, wrapping nothing new, and just unlocking. On a vault that IS the entire secret
// (there is no server session to also check), that would be client-side theatre: anyone who
// obtained the `.wymber` file could bypass the "passkey" step outright by skipping straight past
// wherever the app checks it, because nothing about the ciphertext would actually depend on the
// passkey. Deriving the wrapping key from the `prf` extension's output — key material only that
// specific passkey can release — is what makes the check real instead of decorative.
//
// The actual AES-GCM key is HKDF-SHA256 over the raw PRF output (never used directly as an AES
// key), with a random per-entry salt and a fixed `info` string for domain separation. The PRF
// output and the unwrapped DEK are treated as radioactive: zeroed (`.fill(0)`) in a `finally` the
// moment they're no longer needed, mirroring the discipline `app.js` already applies around
// `native-biometric.js`'s DEK handling.
//
// `credentialId` and `rpId` are recorded on the entry so unlock can re-run the ceremony against
// the same credential; origin binding itself is enforced by the browser, not reimplemented here.
//
// Split in two for testability: the pure wrap/unwrap core (`wrapDekUnderRawSecret` /
// `unwrapDekWithRawSecret`) is plain WebCrypto with no browser globals, so it runs and is tested
// directly under Node (this file stays `@vitest-environment node`, several suites depend on that).
// The `navigator.credentials` ceremony lives in separate, explicitly-invoked functions
// (`enrollPasskey`, `unlockVaultWithPasskey`) that nothing calls yet — nothing browser-only runs
// at module load, and both guard for `navigator.credentials` being absent.
//
// Deliberately unwired: there is no UI here, no call site in app.js/local-repo.js, and no way yet
// to persist a passkey-enrolled vault from the app. That's out of this module's scope.

const PASSKEY_HKDF_INFO = enc.encode('wymber-passkey-wrap-v1');

/** Thrown by the passkey ceremony functions. `code` mirrors native-biometric.js's convention:
 * `NOT_SUPPORTED` (no WebAuthn/PRF in this browser), `CANCELLED` (user backed out of the
 * ceremony), `PRF_UNSUPPORTED` (the authenticator ran but didn't return a PRF result — enrollment
 * always refuses rather than silently downgrading), `NOT_ENROLLED` (no passkey entry to unlock
 * with). */
export class PasskeyError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'PasskeyError';
        this.code = code;
    }
}

/** Derive an AES-GCM KEK from 32 raw secret bytes (a WebAuthn PRF output) via HKDF-SHA256. Pure
 * WebCrypto, no browser globals — runs identically in Node and the browser. */
async function deriveKekFromRawSecret(rawSecretBytes, saltBytes) {
    const baseKey = await subtle.importKey('raw', rawSecretBytes, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: PASSKEY_HKDF_INFO },
        baseKey,
        256
    );
    return importAesKey(new Uint8Array(bits));
}

/** Wrap `dekBytes` under 32 raw secret bytes (e.g. a WebAuthn PRF output). The pure, Node-testable
 * core of passkey enrollment — no browser API involved. Returns `{ salt, nonce, ct }`. */
export async function wrapDekUnderRawSecret(dekBytes, rawSecretBytes) {
    const salt = randomBytes(16);
    const kek = await deriveKekFromRawSecret(rawSecretBytes, salt);
    const wrapped = await aesEncrypt(kek, dekBytes);
    return { salt: toB64(salt), ...wrapped };
}

/** Unwrap a `wrapDekUnderRawSecret` entry given the same raw secret bytes. Throws on a wrong
 * secret via GCM's authentication check (never a silent wrong answer), same discipline as every
 * other unwrap path in this module. */
export async function unwrapDekWithRawSecret(entry, rawSecretBytes) {
    const kek = await deriveKekFromRawSecret(rawSecretBytes, fromB64(entry.salt));
    try {
        return await aesDecrypt(kek, entry);
    } catch (err) {
        throw translateUnwrapError(err, 'This passkey no longer unlocks this vault.');
    }
}

function credentialsApi() {
    return globalThis.navigator?.credentials ?? null;
}

/** True only when this environment actually exposes a usable `navigator.credentials`. Does NOT
 * prove PRF support — that can only be learned by actually running the ceremony (browsers don't
 * offer a static "does this authenticator support PRF" query), which is why `enrollPasskey`
 * refuses rather than trusting a capability probe. */
export function passkeySupported() {
    const credentials = credentialsApi();
    return !!credentials && typeof credentials.create === 'function' && typeof credentials.get === 'function';
}

function requireCredentialsApi() {
    const credentials = credentialsApi();
    if (!credentials || typeof credentials.create !== 'function' || typeof credentials.get !== 'function') {
        throw new PasskeyError('Passkeys are not available in this browser.', 'NOT_SUPPORTED');
    }
    return credentials;
}

/** Read the PRF output from a WebAuthn credential/assertion's extension results, or `null` if the
 * authenticator didn't return one (unsupported, or the ceremony didn't ask correctly). */
function readPrfResult(credentialOrAssertion) {
    const results = credentialOrAssertion?.getClientExtensionResults?.();
    return results?.prf?.results?.first ?? null;
}

/**
 * Enroll a passkey as an additional unlock method. Runs a real `navigator.credentials.create()`
 * ceremony requesting the `prf` extension and then, if that browser didn't already evaluate the
 * salt at creation time (most don't — they return only `prf.enabled`), a follow-up `get()` to
 * actually obtain the PRF value, derives a KEK from it via HKDF, and wraps the DEK under it. Only
 * after both have been tried is a missing PRF result treated as "this authenticator can't do PRF".
 * Requires the `password` entry to
 * already exist on `vault` (enforced by `withKeys` → `assertHasPasswordEntry`) and never touches
 * `password` or `recovery`.
 *
 * Refuses with `PasskeyError { code: 'PRF_UNSUPPORTED' }` if the authenticator/browser does not
 * support the PRF extension — this module will NOT fall back to a non-PRF scheme, because that
 * would mean the "passkey" step no longer actually gates anything (see the module comment above).
 *
 * `dekBytes` is treated as radioactive: callers must not reuse it after calling this function; it
 * is zeroed (`.fill(0)`) in a `finally` regardless of success or failure, mirroring
 * `unwrapDekRaw` callers' existing convention elsewhere in this codebase.
 *
 * `opts`: `{ rpId, rpName, userId, userName, userDisplayName, challenge }`, all optional with
 * sane defaults, mainly present so tests can inject deterministic values and a stubbed
 * `navigator.credentials` doesn't need real ones.
 */
export async function enrollPasskey(vault, dekBytes, opts = {}) {
    if (!vault.keys?.password) {
        throw new PasskeyError('Cannot enroll a passkey on a vault with no password entry.', 'ERR_NO_PASSWORD_ENTRY');
    }
    const credentials = requireCredentialsApi();
    const rpId = opts.rpId ?? globalThis.location?.hostname ?? 'localhost';
    const rpName = opts.rpName ?? 'Wymber';
    const userId = opts.userId ?? randomBytes(16);
    const userName = opts.userName ?? 'wymber-vault';
    const userDisplayName = opts.userDisplayName ?? 'Wymber vault';
    const challenge = opts.challenge ?? randomBytes(32);
    const prfSalt = randomBytes(32);

    let prfBytes = null;
    try {
        let creation;
        try {
            creation = await credentials.create({
                publicKey: {
                    rp: { id: rpId, name: rpName },
                    user: { id: userId, name: userName, displayName: userDisplayName },
                    challenge,
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
                    extensions: { prf: { eval: { first: prfSalt } } },
                },
            });
        } catch (err) {
            throw new PasskeyError(err?.message || 'Passkey creation was cancelled.', 'CANCELLED');
        }
        if (!creation) throw new PasskeyError('Passkey creation was cancelled.', 'CANCELLED');

        const credentialIdBytes = new Uint8Array(creation.rawId);

        // Getting the PRF value takes up to two ceremonies, and which one yields it is a browser
        // difference, not an error. Most browsers report only `prf.enabled` at creation and do NOT
        // evaluate `eval` there, so a missing result here is the NORMAL case on real hardware — it
        // must not be read as "this authenticator has no PRF", which would refuse enrollment on
        // exactly the devices that do support it. Some browsers do evaluate at creation; when they
        // do, we already have the value and skip the extra prompt.
        const fromCreation = readPrfResult(creation);
        if (fromCreation) {
            prfBytes = new Uint8Array(fromCreation);
        } else {
            let assertion;
            try {
                assertion = await credentials.get({
                    publicKey: {
                        rpId,
                        challenge: randomBytes(32),
                        allowCredentials: [{ id: credentialIdBytes, type: 'public-key' }],
                        userVerification: 'required',
                        extensions: { prf: { eval: { first: prfSalt } } },
                    },
                });
            } catch (err) {
                throw new PasskeyError(err?.message || 'Passkey enrollment was cancelled.', 'CANCELLED');
            }
            const evaluated = assertion ? readPrfResult(assertion) : null;
            if (evaluated) prfBytes = new Uint8Array(evaluated);
        }

        // Only now, having actually tried to evaluate it, is "no PRF" a real answer.
        if (!prfBytes) {
            throw new PasskeyError(
                "This device's passkey doesn't support the PRF extension, which passkey unlock " +
                'requires. Passkey unlock was not enabled; your password and recovery code are unaffected.',
                'PRF_UNSUPPORTED'
            );
        }
        const wrapped = await wrapDekUnderRawSecret(dekBytes, prfBytes);
        const entry = {
            ...wrapped,
            credentialId: toB64(credentialIdBytes),
            rpId,
            prfSalt: toB64(prfSalt),
        };
        return withKeys(vault, { ...vault.keys, passkey: entry });
    } finally {
        // Zeroed on every exit, including a cancelled or failed ceremony — the previous shape left
        // dekBytes un-zeroed whenever create() threw.
        if (prfBytes) prfBytes.fill(0);
        dekBytes.fill(0);
    }
}

/**
 * Unlock a vault via its enrolled passkey. Re-runs the WebAuthn ceremony (`get()`) against the
 * recorded `credentialId`/`rpId`, evaluates the same `prf` salt used at enrollment, re-derives the
 * KEK via HKDF, and unwraps the DEK. Throws `PasskeyError { code: 'NOT_ENROLLED' }` if the vault
 * has no passkey entry, `{ code: 'CANCELLED' }` if the ceremony didn't complete, or
 * `{ code: 'PRF_UNSUPPORTED' }` if the authenticator didn't return a PRF result this time (a
 * changed browser/device, most likely). A wrong/stale unwrap (tampering, or a credential that no
 * longer matches) fails via GCM's authentication check, propagated as-is.
 */
export async function unlockVaultWithPasskey(vault) {
    const entry = vault.keys?.passkey;
    if (!entry) throw new PasskeyError('This vault has no passkey enrolled.', 'NOT_ENROLLED');
    const credentials = requireCredentialsApi();
    const prfSalt = fromB64(entry.prfSalt);
    const credentialId = fromB64(entry.credentialId);

    let assertion;
    try {
        assertion = await credentials.get({
            publicKey: {
                rpId: entry.rpId,
                challenge: randomBytes(32),
                allowCredentials: [{ id: credentialId, type: 'public-key' }],
                userVerification: 'required',
                extensions: { prf: { eval: { first: prfSalt } } },
            },
        });
    } catch (err) {
        throw new PasskeyError(err?.message || 'Passkey unlock was cancelled.', 'CANCELLED');
    }
    if (!assertion) throw new PasskeyError('Passkey unlock was cancelled.', 'CANCELLED');

    const prfResult = readPrfResult(assertion);
    if (!prfResult) {
        throw new PasskeyError("This passkey didn't return the expected unlock key.", 'PRF_UNSUPPORTED');
    }
    const prfBytes = new Uint8Array(prfResult);
    let dek;
    try {
        dek = await unwrapDekWithRawSecret(entry, prfBytes);
        const dekKey = await importAesKey(dek);
        const documentObj = JSON.parse(dec.decode(await aesDecrypt(dekKey, vault.payload)));
        return { document: documentObj, dekKey };
    } finally {
        prfBytes.fill(0);
        if (dek) dek.fill(0);
    }
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
