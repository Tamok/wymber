# ADR-0003: Client integrity + anti-phishing (verify the client; never trust a client to vouch for itself)

- Status: Accepted (2026-06-02)
- Decider: [@tamok](https://github.com/tamok)

## Context

Wymber is open-source and rehostable on purpose. That is a durability promise: a `.wymber` file is
always yours to open with the public code, even if this site disappears (see [[ADR-0001]]). But the
same property is a threat: **anyone can host a look-alike.** A clone at `wymb3r.app` that looks
identical could capture the password, the recovery code, or the decrypted map the moment a user
unlocks.

The ask: can the `.wymber` file recognise whether the client opening it is the legitimate, current
source ("this is a legit client") versus a modified one ("this client has been modified, use with
caution")? And can we make it foolproof that a malicious actor cannot read a `.wymber` file's
contents or capture the password/recovery?

We have to be honest about what is and isn't possible, because overclaiming here would itself be a
trauma of broken trust.

## What is, and isn't, possible

Two facts bound the whole design:

1. **A file cannot attest the code that opens it.** A `.wymber` file is passive data. It has no way
   to inspect, measure, or gate the application reading it. Anything we embed in the file (a flag, a
   signature, an expected hash) is just bytes the reading client may honour, ignore, or fake.
2. **A client cannot prove its own honesty.** If we ship a self-check ("I computed my own hash, I'm
   legit ✅"), a modified client simply keeps the green badge and lies. Self-attestation is
   **spoofable by construction.** Real assurance must come from **outside** the page being checked.

So the literal "the file recognises the app" is not achievable, and an in-app "legit / modified"
badge is **transparency, not security.** What *is* achievable is making the **official** client
**independently verifiable** and the **unlock moment phishing-resistant.**

It helps to separate two goals that are often conflated:

- **(A) Confidentiality of the `.wymber` file itself** (theft of the file at rest or in transit).
- **(B) Preventing a malicious *client* from capturing secrets at unlock** (the phishing / supply-chain
  problem). Cryptography alone cannot solve (B): no math stops a person from typing their password
  into a convincing fake.

## Decision

A layered model. Each layer is honest about which goal it serves and how strong it is.

### Layer 0, the file is useless without the secret (DONE, serves A)

Envelope encryption already means a stolen `.wymber` is unreadable without the password or recovery
code: a random AES-256-GCM data key, wrapped per unlock method, password/recovery derived with
PBKDF2-600k today and **Argon2id** tracked ([#100]). A strong password or the high-entropy recovery
code makes brute force infeasible. **Goal (A) is effectively met today.** This is why the "is the
client legit" question reduces to a single moment: **unlock.**

### Layer 1, make the official client verifiable, not self-attesting (serves B)

Anchor trust in the official origin so tampering with `wymber.app` is *detectable* and the served
bundle is *diffable against the audited source*:

- **Reproducible build + published integrity manifest:** a committed manifest of SHA-384 hashes for
  every shipped asset, regenerated on each release, so anyone can confirm `wymber.app` serves
  exactly the source in the repo.
- **Subresource Integrity (SRI)** on `index.html` for every script and style, plus the
  **`Integrity-Policy`** header to *require* integrity metadata, the browser refuses any resource
  that doesn't match its expected hash.
- **Strict Content-Security-Policy:** no inline script, `connect-src 'self'` (the app makes no
  outbound calls; there is nowhere to exfiltrate to), pinned sources. This makes the official deploy
  tamper-evident and exfiltration-resistant.

Limit, honestly: Layer 1 protects the *official* deploy. It does **not** stop a separate clone on a
different origin from shipping its own (malicious) HTML. That needs Layers 2-4.

### Layer 2, out-of-band attestation (the only true "is this legit", serves B)

The only way to verify a web client is from **outside** it. Precedent: **Meta + Cloudflare's Code
Verify**, an open-source browser extension that compares the loaded code against a manifest
published through Cloudflare as an independent transparency source. We **already run on Cloudflare**,
so the same shape fits: publish the integrity manifest as the third-party-anchored source of truth,
and (future, heavy) ship or endorse a Code-Verify-style extension that shows green only when the
loaded code matches. Tracked as an epic; not alpha scope.

### Layer 3, phishing-resistant unlock with passkeys (serves B, high value)

**Passkeys / WebAuthn are origin-bound.** A passkey registered to `wymber.app` **cannot** be used
by a clone on any other origin, the browser refuses. Making **passkey the primary unlock** means the
strongest path simply does not work on a fake site. Password and recovery remain as fallbacks, with
a standing warning to enter them only on the trusted origin. This is the single most effective
in-product anti-phishing step and is already foreshadowed in `crypto.js` ("later passkeys").

### Layer 4, the high-trust anchor is a signed desktop app (serves B)

The web is inherently phishable; a **signed, installed desktop app** (Tauri, [#38]) updated from a
known source is the strongest client. We will frame desktop as the highest-trust option for people
who want it, without abandoning the easy web path.

### Layer 5, honest UX + claims discipline (serves B, and trust)

- A visible **build hash / version** and a **"verify this client"** page documenting how to check it
  (manual hash compare, the extension, the desktop app). Framed as **transparency**, never as a
  guarantee.
- A standing, gentle reminder: **only unlock at `wymber.app`; never enter your Wymber password on any
  other site.**
- We will **never** claim a web page can prove its own integrity, or that the in-app badge protects
  against clones. Consistent with claims discipline ([#70]).

## On the specific "legit client / modified client" indicator

We can show the running build's hash and link to the published manifest, that is good transparency.
But a *self-reported* "legit ✅ / modified ⚠️" badge is **spoofable** (a malicious clone shows
"legit"), so it must not be presented as protection against a fake client. Genuine "is this legit"
assurance comes only from **out-of-band** verification (Layer 2 extension / manual hash compare),
**origin binding** (Layer 3 passkeys), or a **signed binary** (Layer 4 desktop).

## Consequences

- New issues: SRI + integrity manifest + reproducible build; strict CSP + `Integrity-Policy`;
  passkey unlock as phishing-resistant primary; in-app build indicator + "verify this client" page;
  Code-Verify-style out-of-band attestation (epic). Desktop app ties to [#38]; Argon2id is [#100].
- README "Transparency" links here so the verification story is one click from the front door.
- No new data leaves the device; every layer is local or static-by-construction, consistent with
  [[ADR-0001]].

## Alternatives considered

- **Embed a client signature in the `.wymber` file.** Impossible: the file is passive data and an
  attacker re-signs their own. Rejected.
- **Client self-hash check only.** Spoofable by the very client you're trying to catch. Rejected as
  a *security* control; kept only as *transparency* (Layer 5).
- **SRI alone as "the answer."** Protects the official deploy, not a clone on another origin.
  Necessary but insufficient; it's Layer 1, not the whole story.
- **Obfuscation / DRM to "protect" the client.** Anti-open-source, hostile to the auditability that
  is the entire point, and ineffective against a determined cloner. Rejected.

## The honest headline

> Because Wymber is open source, anyone can host it. That's good for durability, but it means **you**
> must make sure you're on the real client before you unlock. We make the official client
> **verifiable** (reproducible builds, published hashes, strict CSP), we're moving unlock to
> **passkeys** (which a fake site can't use), and a **signed desktop app** is the highest-trust
> option. What we will never pretend is that a web page can prove its own honesty: it can't, so never
> enter your Wymber password anywhere but the site you trust.
