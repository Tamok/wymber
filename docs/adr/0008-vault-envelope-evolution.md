# ADR-0008: How the vault envelope is allowed to change

- Status: Accepted (2026-08-09)
- Decider: [@tamok](https://github.com/tamok)

## Context

[ADR-0001](0001-local-first-encrypted-file.md) accepted that the vault is the only copy of a
user's map: no server holds it, no support process can reset it, and losing the password and the
recovery code loses the data permanently. Everything in this ADR follows from one consequence of
that: **there is nobody to recover from a bad envelope change.** A migration bug in a normal
product produces a support ticket. Here it produces a person who can no longer open the only
record of what they have been through.

The envelope is about to change more than it ever has. Two tracked pieces of work both alter it:

- **#100**, the PBKDF2-SHA256 → Argon2id key-derivation upgrade, which cannot be a flag day
  (see below), so vaults must be able to carry more than one KDF at once.
- **#113**, passkey/WebAuthn unlock ([ADR-0003](0003-client-integrity-and-anti-phishing.md)
  Layer 3), which adds a third way into the same envelope.

Both are additive in intent, and both were one small mistake away from locking users out during
implementation. This ADR exists because the rule that separates the safe change from the
dangerous one is not obvious, was got wrong twice in review, and is not written down anywhere.

### Why a KDF migration cannot be a flag day

The envelope wraps one Data Encryption Key separately per unlock method
(`frontend/js/crypto.js`, `createVault`: `keys.password` and `keys.recovery` are independent
wrapped copies of one DEK). Re-wrapping an entry requires the secret that opens it.

A password unlock has the password in hand, so it can re-wrap `keys.password`. It **never** has
the recovery code, so it cannot touch `keys.recovery` — that entry can only be upgraded on the day
the user actually uses their recovery code, which may be never. Any migration is therefore lazy
and per-entry, and a migrating vault is **legitimately mixed-KDF** for an unbounded period. A
single vault-level `kdf` field cannot describe that state, which is why the descriptor has to move
down to the entry.

## Decision

Four rules govern every future change to the envelope.

### 1. The envelope describes its own key derivation, per entry

Each entry in `keys` may carry its own `kdf` descriptor, resolved as `entry.kdf ?? vault.kdf`.
Every vault written before this change has no `entry.kdf` anywhere, so every entry resolves to the
vault-level `kdf` exactly as it always did — the old path is not a compatibility shim, it is the
same code path.

KDFs are looked up in a registry by `algo` name, so a new one lands as a registration rather than
a change to unlock logic. An entry naming an unregistered `algo` raises a distinct
`UnsupportedKdfError`.

### 2. Failing loudly beats failing plausibly

`unlockVault` previously turned *every* unwrap failure into "Incorrect password" via a bare
`catch`. On a product with no password reset, that message does not read as "try again" — it
reads as "your data is gone." Saying it to someone whose password is correct, because the real
problem was an envelope this build cannot parse, is a harmful lie.

Only a genuine AES-GCM authentication failure (WebCrypto's `OperationError`, i.e. an actually
wrong secret) may produce "Incorrect password" / "Incorrect recovery code." An unsupported KDF, a
corrupted envelope, or an internal error must propagate as itself.

### 3. The version gate keys off what an OLD build would do, not off what changed

`parseVault` already refuses a vault whose `version` exceeds what the build understands, with
"This vault was made by a newer version of Wymber. Please update." That shipped mechanism is the
loud failure, and the version stamp is how a change opts into it. The test is not "did the
envelope change?" but:

> **Would a build that has never heard of this change silently derive the wrong answer?**

- **Yes → raise the version stamp.** The old build refuses the whole file and tells the user to
  update. Concretely: any per-entry `kdf` override (an old build reads `vault.kdf` unconditionally
  and cannot see the override, even one that only changes iterations), *and* a vault-level
  `kdf.algo` that is no longer the baseline. That second case is the one most easily missed,
  because the natural way to adopt Argon2id is to change the default in `createVault`, which
  leaves no per-entry override anywhere; keying the stamp only off overrides would let such a
  vault reach an old build stamped version 1 and be reported as "Incorrect password."
- **No → do NOT raise it.** An old build only ever looks up `keys.password` and `keys.recovery`.
  An entry under any other name is invisible to it, so a passkey entry is harmless there and that
  vault still opens by password on the older build. Raising the stamp for it would convert an
  additive convenience into a lockout: enrol a passkey on a new build and you can no longer open
  your vault on an older build or a second device *even with your password*.

Both directions are failure modes. Under-gating produces silent wrongness; over-gating produces
lockout. Neither is the safe default, which is why the rule is stated as a question about the old
build rather than as "when in doubt, bump."

Version stamping is computed from the envelope's content in one place that every `keys`-rewriting
path funnels through, so the stamp cannot drift out of sync with the entries it describes. A
normal save (`sealDocument`) replaces only the payload and never restamps.

### 4. Unlock methods are additive, and the password root is permanent

A new unlock method is an additional wrapped copy of the same DEK. It must never remove or weaken
`keys.password`, and the envelope layer refuses to write a vault that has no password entry. The
password and the recovery code remain the portable roots ([ADR-0006](0006-optional-recovery-tradeoffs.md));
device- or origin-bound methods (Android biometrics today, passkeys next) sit on top of an unlock
the user has already established. They are convenience and phishing-resistance, never recovery,
because losing the device or the authenticator must never lose the vault.

A corollary worth stating because it is easy to get backwards: an unlock method that releases a
**wrapping key** must derive that key from material only the authenticator can produce (for
passkeys, the WebAuthn PRF extension). Gating unlock on "the ceremony succeeded" would be
client-side theatre — anyone holding the vault file could skip the check entirely. Where that
material is unavailable, refuse to enrol rather than fall back to a weaker scheme that claims the
same protection.

## Consequences

- A vault created before these changes opens on the new build through the same code path, with
  the same salts and iterations. The frozen, real-PBKDF2-sealed fixtures in `e2e/parity/fixtures/`
  are the standing proof of this, exercised under Node
  (`frontend/tests/native-crypto-parity.test.js`) and in real Chromium
  (`e2e/parity/crypto-parity.spec.js`). **Those fixtures are the regression test for every future
  envelope change; wanting to edit one is the signal that backward compatibility has broken, not
  that the fixture is stale.**
- A vault that has begun migrating is refused wholesale by older builds rather than partially
  opened. This is deliberate: a partial open (recovery works, password reports "Incorrect
  password") is precisely the silently-wrong outcome rule 2 forbids. The cost is that a user who
  upgrades and then downgrades is locked out of that build until they update again, which is
  recoverable; being told their password is wrong is not.
- `VAULT_VERSION` remains `1` and names "the version an all-default-KDF vault gets"; the ceiling a
  build accepts is tracked separately. This split exists because the frozen fixtures assert their
  version against the live exported constant. If the fixtures are ever re-frozen at a newer
  baseline, the two constants can collapse back into one.
- Argon2id itself is **not** adopted by this ADR. It needs a WASM dependency and a
  `'wasm-unsafe-eval'` relaxation of the app origin's `script-src`, which trades against
  [ADR-0003](0003-client-integrity-and-anti-phishing.md)'s auditability story: a `.wasm` blob can
  be hashed byte-for-byte by the integrity manifest, but it cannot be *read* by a reviewer the way
  `crypto.js` can. That tradeoff is a separate decision and is not settled here.

## Alternatives considered

- **A single vault-level KDF, migrated all at once.** Impossible without the user's recovery code,
  which the app never holds outside the moment it is used. Rejected on feasibility, not taste.
- **Keeping the bare `catch` that reports every failure as "Incorrect password."** Simpler and
  gives an attacker slightly less information, but the cost lands on legitimate users at the worst
  moment. The information a distinguishable error leaks (that a vault uses a newer format) is not
  secret; it is visible in the plaintext envelope header already.
- **Bumping the version for every envelope change, uniformly.** Simpler to reason about and
  removes the judgment call, but it makes additive unlock methods a lockout, which is a strictly
  worse outcome than the case it protects against. Rejected in favour of the old-build test above.
- **A `minReaderVersion` field instead of a single `version`.** More expressive, and closer to
  what the rule actually means. Not adopted because `parseVault`'s existing `version` check
  already ships in every build in the field, and inventing a new field would mean older builds
  ignore it entirely — the one thing a compatibility gate cannot afford.
