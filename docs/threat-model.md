# Threat model

- Status: describes the alpha **as built**, 2026-08-09.
- This document is generated from the source at a point in time. Code changes; this file
  can drift. If you are relying on a specific claim here, re-check it against the cited
  file/function before you act on it. When in doubt, the code is the ground truth, not
  this document.
- Scope: the Wymber web app and the Android native shell, as shipped from this repository.
  It does not cover forks or other deployments of the open-source code.

Wymber has no accounts, no database, and no server-side storage of user data (see
[ADR-0001](adr/0001-local-first-encrypted-file.md)). That collapses most conventional
"what can an attacker steal from our servers" questions to "nothing, there's nothing
there to steal." The real questions are about the device, the client, and the moments a
person types a secret. This document works through those, adversary by adversary, and is
deliberately more interested in **what an attacker can get** than in reassurance.

If you are looking for the anti-phishing / client-integrity analysis specifically, this
document leans on and does not repeat
[ADR-0003](adr/0003-client-integrity-and-anti-phishing.md); read that first for the
supply-chain/clone adversary, it is the harder case and already has its own honest
write-up.

## The architecture, in one paragraph

The document (nodes, edges, settings) is encrypted client-side with a random per-vault
Data Encryption Key (DEK), AES-256-GCM (`frontend/js/crypto.js`, `createVault`). The DEK
itself is wrapped ("envelope encryption") separately per unlock method: today that's
`password` and `recovery`, each derived via PBKDF2-SHA256 at 600,000 iterations
(`frontend/js/crypto.js`, `DEFAULT_ITERATIONS`, `deriveKEK`). Only the sealed ciphertext
ever touches disk, in OPFS with an IndexedDB fallback on web (`frontend/js/persistence.js`)
or a single native file on the Android shell (`frontend/js/native-persistence.js`). The
decrypted document and the DEK live only in memory while the tab/app is unlocked
(`frontend/js/local-repo.js`, `this.dekKey`), and are dropped on lock or auto-lock.

## Adversary summary

| Adversary | Can get | Cannot get |
|---|---|---|
| Device thief (device locked, no unlock secret) | The ciphertext vault file, offline, to brute-force at their leisure | The map, without the password or recovery code |
| Family member / partner with the *unlocked* device | Everything on screen; the whole map if they act before auto-lock | Nothing extra once locked, but the honest limit is: they had the moment |
| Hostile network / Wi-Fi | Nothing about the map (it never transits the network) | The vault; there is nothing in flight to intercept |
| Compromised host/CDN or supply-chain (serves bad JS) | Password, recovery code, or the decrypted map, at the moment of unlock | Nothing if the user never unlocks on the compromised code |
| Look-alike clone site | Same as above, via a phished user | Nothing if the user only unlocks at the real origin |
| Project maintainers (curious insider) | Nothing: there is no channel for user data to reach us | — |
| Legal process against the project | Essentially nothing held by the project itself | The map itself (we don't have it) |
| The user's own exports/backups | Plaintext JSON/text export if the user makes one and it leaks | Nothing extra from a `.wymber` export (it's ciphertext) |
| Malware / OS-level compromise of the device | Anything the OS lets it read, including live memory | Out of scope; no client-side app can defend against this |

The rest of this document unpacks each row.

## 1. A device thief (device locked, no unlock secret)

What they get: the sealed vault file (`wymber.vault` in OPFS/IndexedDB on web, or the
native file via `NativePersistence`), which is opaque ciphertext. To read it they must
recover the DEK, which means guessing the password or the recovery code and running it
through PBKDF2-SHA256 at 600,000 iterations per guess (`frontend/js/crypto.js`,
`deriveKEK`), then verifying against AES-GCM's authentication tag.

What that buys, honestly: a strong, unique password makes offline brute force
infeasible at any realistic budget. A weak or reused password does not: PBKDF2 at 600k
iterations slows a guess, it does not make a weak password strong. And because this is a
local file with no server in the loop, **there is no rate limiting, no lockout, and no
alerting on repeated failed guesses.** An attacker with the file can try passwords as
fast as their hardware allows, indefinitely, with nothing to stop them. That asymmetry
(present in any offline-crackable file) is why password strength carries more weight here
than it would against a server that can throttle or lock out attempts.

The recovery code is not weaker: it's 120 bits of Crockford-base32 entropy
(`frontend/js/crypto.js`, `generateRecoveryCode`), effectively immune to brute force. It
is, however, an equally valid key into the same vault, discussed further below.

## 2. A family member or partner with access to the *unlocked* device

This is the hardest, most honest case for a trauma app, and the one most worth being
plain about. If the app is unlocked, the map is decrypted in memory and rendered on
screen. Nothing in the architecture distinguishes "the account owner is looking at this"
from "anyone standing at this unlocked device is looking at this," because there is no
account, session, or re-auth step beyond the original unlock.

The mitigation is auto-lock: idle for the configured period clears the in-memory DEK and
document and returns to the lock screen (`frontend/js/app.js`, `autoLock`,
`startIdleTimer`). The default is 15 minutes (`frontend/js/app.js`,
`this.autoLockMinutes = 15`), and the settings panel offers 5, 15, 30, or 60 minutes, or
**"Never"** (`getAutoLockMs` treats 0 as "no auto-lock"). That configurability is
double-edged: a shorter timeout is more protective in this scenario, and a user who picks
"never" has knowingly removed the only defense this adversary faces. There's no
technical control on the OS side either: OPFS/IndexedDB are ordinary storage inside the
user's own logged-in browser profile, not sandboxed against that same person's own
session.

A reload or app restart always requires re-unlock (the DEK is never persisted), which
limits exposure to the current session, not to future ones.

## 3. Malicious network / hostile Wi-Fi

Largely out of scope, and that is the point of the architecture, not an accident. The
vault never transits the network: there is no sync endpoint, no API call that sends or
receives map data (`backend/main.py` exposes only `/api/health`, `/sw.js`,
`/manifest.webmanifest`, `robots.txt`, `security.txt`, and static file serving; nothing
that accepts or returns user data). The service worker explicitly leaves `/api/` and
cross-origin requests alone (`frontend/sw.js`, the fetch handler) and only ever caches the
static app shell.

What HTTPS protects here is delivery of the app shell itself: the JS/CSS/HTML a user's
browser fetches from wymber.app. An attacker on the network cannot read or tamper with
that in transit under TLS. They also have nothing to intercept from the vault, because
the vault isn't traveling.

## 4. A hostile host, CDN, or supply-chain compromise of the served bundle

This is the strongest realistic attack against Wymber, because the architecture that
defeats network attackers (everything happens client-side) also means the client-side
code is the entire trust boundary. If `wymber.app` (or the CDN in front of it) is
compromised and starts serving modified JavaScript, that code runs with full access to
whatever the user types or decrypts: the password, the recovery code, or the plaintext
map right after unlock. Client-side encryption cannot defend against a client that has
been substituted, because the substituted client is the thing doing the encrypting.

[ADR-0003](adr/0003-client-integrity-and-anti-phishing.md) works through this in depth and
this document won't re-derive it; the short, honest version of where things stand today:

- **Shipped now:** four baseline response headers on the app and landing pages
  (`landing/_headers`, and generated for the app in `scripts/build-pages.mjs`):
  `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, and a `Permissions-Policy` that denies camera,
  microphone, and geolocation. `frame-ancestors 'none'` blocks clickjacking (embedding the
  app in a hostile iframe). **This is not the strict CSP described in ADR-0003.** There is
  no `connect-src 'self'` restriction shipped, and no `Integrity-Policy` header.
- **Not shipped:** Subresource Integrity on the served scripts (there are no `integrity=`
  attributes anywhere in the built HTML), a published reproducible-build integrity
  manifest, an in-app build-hash display, a "verify this client" page, or an out-of-band
  attestation mechanism (a Code-Verify-style browser extension). `scripts/build-pages.mjs`
  itself notes the strict CSP is tracked as a future issue, not done.

Net: today, a compromised host is not detectable by the app itself, and there is no
independent way for a user to confirm the code they're running matches the published
source, short of manually diffing it against the repository. That gap is real, tracked,
and not yet closed.

## 5. A look-alike clone / phishing site

Because Wymber is open source and rehostable by design (a durability feature: the code
survives even if wymber.app disappears), anyone can also host a convincing copy at a
different domain. A user who unlocks on a clone hands over their password or recovery
code to whoever runs it, and cryptography does not help: they typed the secret into a
form the attacker controls.

The structural fix, per ADR-0003, is origin-bound authentication: passkeys/WebAuthn, which
a browser will not release for a different origin than the one they were registered to.
That is **not implemented today** — there is no `navigator.credentials` call anywhere in
the frontend. Password and recovery code, the two unlock methods that exist now, are both
portable strings a user can be tricked into typing anywhere. The only defense at the
moment is the standing reminder to unlock only at the real, trusted origin, which is a
human-vigilance control, not a technical one.

## 6. A curious insider, or the project maintainers themselves

Structurally, not just by promise: there is no data endpoint for user data to reach.
`backend/main.py` never accepts a POST or PUT of anything vault-related, and there is no
telemetry or crash reporting anywhere in the codebase or CI (no Sentry, Crashlytics, or
equivalent). The only thing that reaches the project team is what a user deliberately
emails to the published security/support contact. A maintainer with full access to the
server and the source code still has nowhere a map would arrive, because it never leaves
the user's device in the first place. This is a property of the architecture, and the
whole point of publishing the source under AGPL-3.0 is that this claim is independently
checkable rather than something to take on faith.

## 7. Legal process / a subpoena

This section describes the architecture, not legal advice; consult a lawyer for questions
about legal process.

What could actually be produced today, as a description of what exists: the project holds
no accounts, no user database, and no server-side copy of any user's map (see the ADR-0001
architecture and `backend/main.py`). There is essentially nothing on the project's side to
compel that would reveal the contents of a user's vault. The published privacy policy
(`landing/privacy.html`) states that Cloudflare, as the hosting/CDN provider, transiently
processes request metadata (for example IP addresses) to serve the static site; whatever
that provider retains and how it would respond to process is a question for that provider,
not something this project controls or has visibility into.

## 8. The user's own exports and backups

This is a real, non-obvious asymmetry worth stating plainly. `frontend/js/export.js`
offers three export formats:

- `exportAsJSON()` and `exportAsText()` produce **plaintext** of the user's map: full
  titles, descriptions, and structure, unencrypted.
- `exportVaultFile()` exports the sealed `.wymber` file: **ciphertext**, still protected by
  whatever unlock secrets wrap the DEK.

All three are routed through the same `downloadBlob()` (`frontend/js/export.js`). On web
that's a normal browser download. On the native (Android) shell, the anchor-download trick
silently does nothing inside a Capacitor WebView, so `downloadBlob()` instead hands the
file to the OS share sheet via `nativeSaveFile()` (`frontend/js/native-share.js`) for
**all three formats**. `native-share.js` carries a comment that "the exported vault is
ciphertext … so any destination is safe," and that reasoning is correct only for the
vault-export path. A plaintext JSON or text export handed to the OS share sheet on mobile
is exactly as exposed as any other plaintext file the user chooses to send: whatever app
or destination they pick can read it in full. Treat a plaintext export as sensitive the
moment it's created, on either platform, regardless of where it's saved or shared.

A `.wymber` file is safe to store anywhere (a cloud drive, an email attachment) precisely
because it stays ciphertext, but only as safe as the password or recovery code that wraps
it. A weak password on a vault export sitting in a widely-shared cloud folder is a weak
password sitting in a widely-shared cloud folder.

The recovery sheet (`frontend/js/app.js`, `showRecoverySheet`) shown once at vault
creation, and its own optional plaintext download (`downloadRecovery`), are both plaintext
by nature: the recovery code only works as a recovery mechanism if it's readable. Anyone
who later finds that text file or printed sheet has the same access as the password would
give them (see the DEK-parity point below).

## 9. A compromised device, malware, or an attacker with OS-level access

Out of scope, and stated plainly rather than implied away. If the operating system itself
is compromised (keylogger, memory-scraping malware, a malicious accessibility service on
Android, root-level access), it can observe whatever the browser or app process can
observe: keystrokes as the password is typed, the decrypted document in memory, or the DEK
itself while the vault is unlocked. No client-side encryption scheme, Wymber's included,
defends against an attacker who already controls the machine running the client. This is a
limit of the model, not a gap the project intends to close with more client-side code.

## Where the guarantees stop

A few consequences worth stating explicitly, because they're easy to miss:

- **A compromised client defeats everything.** Every guarantee in this document assumes
  the code running in the browser or the native shell is the genuine, unmodified Wymber
  client. See adversary 4; this is the single largest asterisk on the whole model.

- **The recovery code is a second, equally powerful key, not a lesser one.** It wraps the
  same DEK the password wraps (`frontend/js/crypto.js`, `createVault`: both `keys.password`
  and `keys.recovery` are independent wrapped copies of the one DEK). Anyone holding the
  recovery code can unlock the vault exactly as the password owner can. And critically,
  **`changePassword` does not touch the recovery entry** (`frontend/js/crypto.js`,
  `changePassword`: it re-wraps only `vault.keys.password`). If a recovery code is ever
  exposed, and a user responds by changing their password, that alone does **not** revoke
  the exposed recovery code. It remains a fully valid way into the vault until a new vault
  is created or the recovery entry is separately rotated (there is no UI action today that
  rotates the recovery code alone).

- **In-memory key material lives as long as the unlocked session does, and beyond
  Wymber's control after that.** The DEK sits in memory as `this.dekKey`
  (`frontend/js/local-repo.js`) from unlock until `lock()`/`autoLock()` clears it. While
  it's live, it's subject to whatever the OS, browser, or hardware does with process
  memory generally: paging to swap/disk, crash dumps, hibernation/sleep images, or
  debugger access. Wymber has no control over any of that; it is a limit of running inside
  a general-purpose OS and browser, not something a web app can harden against. (The
  Android biometric path is a partial, narrow exception: `frontend/js/app.js` zeroes the
  raw DEK bytes it briefly holds during biometric enroll/unlock in a `finally` block, but
  that only bounds one specific short-lived copy, not the DEK's entire lifetime in memory.)

- **There is no protection against a user being coerced into unlocking.** If someone is
  pressured or forced to unlock their own vault, every technical control in this document
  is satisfied: it's a legitimate unlock, by the account's owner in the only sense the
  system understands "owner." No client-side design defends against coercion of the person
  who holds the secret.

## Not yet, and we won't pretend otherwise

These are named directly in ADR-0003 or elsewhere as future work. They are not built, and
nothing above should be read as implying they are:

- **Subresource Integrity, a strict Content-Security-Policy (`connect-src 'self'`), and an
  `Integrity-Policy` header** for the served app bundle.
- **A reproducible-build integrity manifest** (published per-asset hashes so the served
  bundle can be diffed against the audited source) and an in-app build-hash display or
  "verify this client" page.
- **Out-of-band attestation**, e.g. a Code-Verify-style browser extension that checks the
  loaded code against an independently published manifest.
- **Passkeys / WebAuthn** as an origin-bound unlock method (the fix for adversary 5).
- **Argon2id** as the key-derivation function; PBKDF2-SHA256 at 600,000 iterations is what
  ships today (`frontend/js/crypto.js` already names the KDF in the vault header so this
  swap is meant to be backward-compatible when it lands).
- **Shamir/social recovery, or any escrow mechanism.** The only recovery paths today are
  the password and the one-time recovery code; there is no third party, split-key, or
  social-recovery option.
- **A signed desktop app** as a higher-trust client anchor than the web.
- **Any device-level defense against a coerced or malware-compromised device.** Not on the
  roadmap as a client-side feature; it isn't the kind of thing a client can solve.

## Reporting a vulnerability

Contacts are published in `landing/.well-known/security.txt`:

- `mailto:jonathan@wymber.app`
- `https://github.com/Tamok/wymber/security/advisories/new`

## Future posture: sync and AI (unbuilt)

Neither cloud sync nor any AI/LLM feature exists in the codebase today (no sync
implementation, no `navigator.credentials`/WebAuthn, and no AI/LLM call of any kind was
found anywhere in `frontend/` or `backend/`). This section describes, in future tense
only, how the adversary picture above would need to expand if either ships, and should not
be read as a description of anything currently running.

**Sync**, if built as designed in ADR-0001, would be a zero-knowledge blob store: the
server would hold only the same sealed ciphertext that already sits on-device, and would
never hold or see a key. If it ships, it would add a new adversary this document doesn't
yet cover: whoever operates or compromises the sync storage would gain the ability to
collect encrypted vaults at scale (still unreadable without a key, but now centrally
reachable rather than scattered across individual devices), and a new question of whether
metadata about sync activity (timing, account/device identifiers, IP addresses) becomes
newly collectible where today it structurally isn't. That would need its own analysis, and
its own update to this document, before shipping.

**Any AI/LLM-backed feature**, if one is ever built, would need its own explicit accounting
of what data (if any) leaves the device to reach a model, whether that changes the
"nothing leaves the device" claim this whole document currently rests on, and what a
provider processing that data could see. No such feature exists today, so there is nothing
further to say about it here except that its absence is itself a boundary this document
depends on, and its addition would require re-writing several of the sections above, not
just adding to them.
