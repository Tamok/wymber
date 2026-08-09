# ADR-0006: Optional recovery, without breaking the zero-knowledge guarantee

- Status: Proposed (2026-08-09), pending owner review
- Decider: [@tamok](https://github.com/tamok)

## Context

[ADR-0001](0001-local-first-encrypted-file.md) accepted a cruel tradeoff on purpose: because the
project never holds a copy of the key, a user who loses both their password and their recovery
code loses their data permanently. There is no "forgot password" support flow to fall back on,
because there is nothing on the project's side to reset. That absence is the whole guarantee: the
published privacy policy (`landing/privacy.html`) states it plainly, *"We cannot read your map,
reset your password, or recover your data, because we never have any of it."*

That guarantee is worth protecting deliberately, because every plausible way to soften the "lose
both, lose everything" outcome pulls in the direction of weakening it. This ADR looks at the
options for optional recovery against one test: does it preserve the property that nobody but the
person who holds the password or the recovery code can read the vault, ever, including the
project. It records what ships today, what was considered, and why the shipped design is the
right one, not just the first one that worked.

## Decision

Keep the **user-held recovery code as the only recovery root.** Decline provider escrow, in any
form, permanently. Treat recovery-code rotation and clearer recovery-sheet guidance as the
concrete gaps in the current design, not scheduled work items.

### Option: user-held recovery code (shipped today)

What ships: a 120-bit, Crockford-base32 recovery code, generated at vault creation
(`frontend/js/crypto.js`, `generateRecoveryCode`), shown to the user exactly once behind a forced
acknowledgment checkbox (`frontend/js/app.js`, `showRecoverySheet`: the continue button stays
disabled until the "I've saved it" checkbox is checked), never re-displayable inside the app
afterward, and never stored in plaintext by the app itself.

Its real costs, stated as plainly as its benefits:

- **It is a second key of equal power, not a lesser one.** The recovery code wraps the same Data
  Encryption Key the password wraps (`crypto.js`, `createVault`: `keys.password` and
  `keys.recovery` are independent wrapped copies of one DEK). Anyone holding the recovery code can
  unlock the vault exactly as the password owner can.
- **`changePassword` does not revoke or rotate it.** `crypto.js`'s `changePassword` re-wraps only
  `vault.keys.password`; the recovery entry is untouched. If a recovery code is ever exposed and a
  user responds by changing their password, the exposed recovery code remains a fully valid way
  into the vault.
- **There is no rotation path today.** No UI action rotates the recovery entry alone. The only way
  to invalidate an exposed recovery code today is to create a new vault.
- **Losing both is permanent, and that is the accepted tradeoff, not an oversight.** ADR-0001
  chose this over a support-mediated reset precisely because a support-mediated reset would mean
  someone other than the user could get into the vault, which is the property being protected.
- **The sheet is plaintext by nature.** A recovery code that could not be written down or copied
  would not function as recovery. That means wherever the user puts it (a note, a password
  manager, a printed page) becomes the weakest link in the whole scheme, and the app has no way to
  see or improve on that choice once the sheet is dismissed.

### Option: printed paper key / recovery sheet

Functionally a UX variant of the option above, not a different cryptographic design: the same
recovery code, on paper instead of (or alongside) a digital copy (`frontend/js/app.js`,
`downloadRecovery`, produces a plain-text file the user can print).

The tradeoff worth naming for this product specifically: paper is offline and durable (immune to
account compromise, cloud-storage breach, or a wiped device), but it is discoverable by anyone
with physical access to the household. For a general password manager, that is a minor
consideration. For a trauma map, it is not: the adversary in the family-member scenario the
[threat model](../threat-model.md#2-a-family-member-or-partner-with-access-to-the-unlocked-device)
already describes as the hardest, most honest case for this product is often exactly the person
who could find a printed sheet left in a drawer. Neither storage medium is strictly safer; which
one is safer depends on which adversary a given user is actually protecting against, and only the
user knows that.

### Option: social recovery / Shamir secret sharing

Split the key (or a wrapping key) into shares held by trusted contacts, requiring some threshold
of them to reconstruct it. This preserves the zero-knowledge guarantee in the strict cryptographic
sense: the project still never holds a usable key, and no single share-holder can unlock the vault
alone.

It is also worth being genuinely even-handed about before rejecting it: for many kinds of personal
data, social recovery is a reasonable, well-studied answer to "what if I lose my only key," and it
does not inherently compromise confidentiality.

For this product specifically, it introduces a hazard that is not generic. The "trusted contacts"
a person would name to hold a share of their trauma map are, for a meaningful fraction of this
product's users, drawn from the exact same pool of people who appear *in* the map as triggers,
sources of harm, or people the user is actively working through experiences with. Asking a user to
name recovery contacts for a trauma map can mean asking them to hand a piece of it to someone the
map is about. On top of that, share management (who holds a share, how a threshold is
reconstructed, what happens when a contact becomes unreachable or estranged, which is common in
this exact population) is real complexity with its own failure modes. Weighed together, the
trauma-specific hazard outweighs the general-purpose appeal of the pattern for this product,
today.

### Option: provider escrow

The project itself holding a key, or a share of one, so that it (or a support process acting on
its behalf) could restore access.

This **breaks the zero-knowledge guarantee outright.** It directly contradicts the published
privacy policy's core claim, *"we cannot read your map, reset your password, or recover your
data, because we never have any of it"* (`landing/privacy.html`), and it re-creates precisely the
asset this architecture was built to avoid holding: a centralized, compellable, breachable store
of key material. [ADR-0001](0001-local-first-encrypted-file.md) rejected the prior server-centric
design partly on this basis; provider escrow would be that same design decision, reintroduced
under a different name. Declined, permanently, not "not now."

### Adjacent, not evaluated as a recovery method: passkeys / WebAuthn

Already foreshadowed in [ADR-0001](0001-local-first-encrypted-file.md) ("later passkeys") and
[ADR-0003](0003-client-integrity-and-anti-phishing.md) (Layer 3, the phishing-resistant unlock
path) as an additional wrapped key under the same envelope-encryption scheme `password` and
`recovery` already use. It is worth naming here only to be precise about its category: a passkey
would be an **unlock** method, a fast, origin-bound way in on a trusted device, not a **recovery**
method, since passkeys are device/platform-bound and do not travel inside a portable `.wymber`
file the way the password and recovery code do. **Not implemented today**: there is no
`navigator.credentials` call anywhere in the frontend.

### Adjacent, not a recovery method: device-local biometric unlock

Implemented and shipping today, Android-only, opt-in (`frontend/js/native-biometric.js`): the DEK
is wrapped under a hardware-backed, biometric-gated Android Keystore key. This is a convenience
layer on top of an unlock the user has already set up, not a recovery path: it is explicitly
device-local, so losing the device loses that particular access route, and the password or
recovery code remains the only way back in. `mobile/` contains an Android directory only; there is
no iOS build.

## Consequences

- The recovery code stays the only recovery root. No provider-side fallback exists or is planned.
- A user who loses both the password and the recovery code loses their data permanently. This
  document reaffirms that ADR-0001 tradeoff rather than revisiting it.
- Two concrete gaps in the current design are identified, not scheduled: **recovery-code
  rotation** (a UI action to invalidate the current recovery entry and issue a new one, without
  requiring a whole new vault) and **clearer recovery-sheet guidance** (helping a user reason
  about where to keep the sheet given the household-adversary case this product's own threat model
  already names). Neither has an issue number attached by this ADR; scoping that work is a
  separate step.
- Social recovery / Shamir sharing is a deliberate **"not now,"** specifically because of the
  trauma-specific hazard of naming recovery contacts for a trauma map, not because the
  cryptographic pattern is unsound in general.
- Provider escrow is off the table permanently as a matter of product identity, not just current
  scope.

## Alternatives considered

- **Support-mediated password reset** (the pre-ADR-0001 server-centric model). Requires the
  project to hold or derive key material server-side. Rejected in ADR-0001 and not revisited here.
- **Shorter, memorable recovery phrases (e.g. a BIP-39-style word list) instead of the current
  base32 code.** Not evaluated in depth here; the entropy and encoding of the recovery code itself
  is an implementation detail of the option already shipped, not a distinct recovery model.
- **Time-locked or dead-man's-switch recovery** (release a key automatically after a period of
  inactivity, to a designated contact). Considered and set aside without a detailed writeup here:
  it reintroduces a third party into the trust boundary and inherits the same trauma-specific
  hazard as social recovery, with the added complexity of a timing mechanism. Not pursued.
