# ADR-0001: Local-first encrypted file as the unit of data

- Status: Accepted (2026-06-01)
- Deciders: project owner + Claude

## Context

Wymber is a privacy-first trauma-mapping tool. The original architecture is server-centric:
a FastAPI backend owns accounts (Argon2 + JWT), holds an in-memory `session_keys` dict, and
stores Fernet-encrypted node descriptions in server-side SQLite. That design forces us to host
(and secure) a stateful server just to let a single user keep their own data, it weakens the
privacy story (the server processes the plaintext to encrypt it), and it has a cruel failure
mode: a forgotten password means the encrypted data is unrecoverable.

Two facts about the current code make a different model cheap to adopt:

- `frontend/js/export.js` already serializes the **entire map** to a versioned JSON document
  (`version: '2.1'`, nodes + edges) and `importMap()` already rebuilds from it.
- `frontend/js/api.js` is a single thin seam (`get/post/put/delete` through one `request()`),
  so the persistence layer can be swapped without touching the UI.

## Decision

The **unit of data is a single encrypted file (a "vault")** that the *client* creates, reads,
and writes. The user's password (or a recovery code, or a passkey) unlocks it. The file is
portable: export it from one instance, import it into any other (browser PWA, desktop, phone,
self-hosted). The server is **not** required for the core product.

### Crypto: envelope encryption (DEK wrapped by per-method KEKs)

We do **not** encrypt the data directly with the password. Instead:

1. A random **Data Encryption Key (DEK)** encrypts the document (AES-256-GCM).
2. The DEK is **wrapped** (encrypted) separately by one **Key-Encryption-Key (KEK)** per unlock
   method: `KEK_password`, `KEK_recovery`, and (later) `KEK_passkey`.
3. All wrapped copies live in a **versioned header**, so any one method can unlock, changing the
   password only re-wraps the DEK (no data re-encryption), and methods can be added later.

KDF: **PBKDF2-SHA256** for the dependency-free, buildless floor (native WebCrypto, runs in the
browser and in Node tests). **Argon2id (WASM)** is the planned upgrade; because the KDF is named
in the header, swapping it is a localized, backward-compatible change.

Cipher: **AES-256-GCM** (authenticated — tampering fails decryption). XChaCha20-Poly1305 is a
fine future alternative if we move off WebCrypto.

### Recovery sheet (required, not optional — this is a trauma app)

Losing a trauma map because a distressed user forgot a password would be actively harmful.
On vault creation we generate a high-entropy **recovery code** (120-bit, Crockford-base32,
grouped) and wrap the DEK with it. "Download a recovery sheet" = a printable copy (later: PDF +
QR). Forgetting the password no longer means losing data.

### Passkeys (additive, later)

A passkey unlocks via the WebAuthn **PRF extension** (`hmac-secret`): derive a stable secret
from the credential, use it as `KEK_passkey`. Caveats: PRF support is still maturing, and
passkeys are device/platform-bound (iCloud/Google sync), so they do **not** travel inside the
portable file — the password and recovery code remain the universal, portable roots. The passkey
is a fast unlock on a trusted device.

### Working copy & session model

Persist only **ciphertext** at rest (OPFS / IndexedDB in the browser; a real file on desktop).
Decrypt to memory on unlock; **unlock per session**; **auto-lock on idle** (also trauma-informed:
privacy if the user steps away). Never leave decrypted data at rest on the device.

### Sync (post-MVP, paid, greyed-out "Coming soon")

Optional cloud sync is a **dumb authenticated blob store**: it takes the opaque encrypted vault
and gives it back (zero-knowledge — it never holds the key). Best-fit hosting is serverless
blob storage (Cloudflare Workers + R2, or Supabase), **not** an always-on container. Conflict
handling starts last-write-wins with a version vector; CRDTs are a later option.

### Hosting consequences

- **MVP web app**: a **static PWA** on free static hosting (Cloudflare Pages / Porkbun static).
  No app server, no hosting cost — and the privacy claim becomes literally true.
- **Self-host container**: the existing `Dockerfile` stays, for people who want to run the
  optional sync/blob store on their own infrastructure.
- **Fly.io is dropped from the plan** — unnecessary for MVP, and not the best fit for the
  eventual sync backend either.

### Threat model (stated plainly)

The web build trusts wymber.app to serve honest JS on each load; a compromised host/CDN could
ship code that exfiltrates the password — the web cannot fully solve "malicious app author."
Mitigations: strict CSP + Subresource Integrity, and the **desktop app** (signed, user-controlled
binary) + **self-host** as the high-trust tiers. "Honest-but-curious" is fully solved; the
paranoid tier uses desktop/self-host.

## Consequences

- Accounts collapse to a local passphrase; no server auth for the core product.
- The server hardening / deploy work (PR #98 etc.) is repositioned to serve the self-host + sync
  path, not the MVP web path.
- New core modules: `crypto.js` (vault/key-wrapping) and a local document store behind the
  `api.js` seam. Migrations become a client-side, version-keyed registry.

## Alternatives considered

- **Keep server-centric** (status quo): higher hosting + security burden, weaker privacy story,
  cruel forgotten-password failure. Rejected.
- **Client-side SQLite (sql.js / wa-sqlite over OPFS)**: preserves a relational model in-browser,
  but unnecessary at this data scale (KB–MB). Encrypt one JSON document per save instead.
  Revisit only if data grows.
