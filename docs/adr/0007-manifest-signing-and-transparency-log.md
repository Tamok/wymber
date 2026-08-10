# ADR-0007: Sign the integrity manifest, keep it informational, keep the log third-party-anchored

- Status: Accepted (2026-08-09)
- Decider: [@tamok](https://github.com/tamok)

## Context

[ADR-0003](0003-client-integrity-and-anti-phishing.md) is the governing decision here; read it
first. Its Layer 1 has landed: a reproducible build, a published SHA-384 integrity manifest on
two origins, Subresource Integrity, import-map integrity, and a strict Content-Security-Policy
([#111], [#112]). Layer 1 makes the official deploy tamper-evident against its own published
source, but it says nothing about *who* published that source. Two people looking at
`wymber.app/integrity-manifest.json` and `web.wymber.app/integrity-manifest.json` agreeing with
each other still have to take on faith that the agreement itself hasn't been staged by whoever
controls both origins.

Layer 2, out-of-band attestation, is the piece ADR-0003 explicitly deferred: "not alpha scope,"
tracked as [#115], a Code-Verify-shape browser extension. That is still unbuilt. This ADR covers a
narrower, cheaper slice of the same problem that can ship now, without a browser extension and
without a new dependency: an **Ed25519 signature over the manifest**, recorded as an append-only,
hash-chained transparency log (`landing/integrity-log.jsonl`), verified by a stdlib-only script
(`scripts/integrity-log.mjs`) anyone can run from a fresh `git clone`.

The tooling for this already exists and is committed: `scripts/integrity-log.mjs` (the shared
library and verifier CLI), `scripts/sign-integrity-log.mjs` (the owner-only signer), and CI
running the verifier's structure-and-chain check, no key, on every push
(`.github/workflows/ci.yml`). This ADR documents what that tooling is for, how strong its
guarantee actually is, and the open question it does not answer for itself: who holds the signing
key and how. **`landing/integrity-log.jsonl` is currently zero bytes.** No production signing key
exists yet, and nothing has been signed. This ADR is being written before that key exists, on
purpose, so the design is argued on its own merits rather than retrofitted to a decision already
made.

Two facts from ADR-0003 bound this ADR exactly as they bounded that one: **a file cannot attest
the code that opens it**, and **a client cannot prove its own honesty**. A signed log is not an
exception to either fact. It is a third thing: a record a *third party*, not the client and not
the file, can check.

## The verifier hierarchy, and why the levels differ in strength

Three ways to check "is this the real client," from strongest to weakest. The point of laying
them out together is that they are not competing designs, they serve different situations, and
this ADR is only about the weakest of the three.

### (i) The OS (strongest: the verifier is not us)

A store-installed native build is checked by the platform at install and update time, using a
signing key the app's own code never sees and cannot influence. This already ships: Android
release signing is live today via Play App Signing (upload-key signing in
`mobile/android/app/build.gradle`, resolved from CI secrets or a gitignored
`.secrets/android/keystore.properties`, never from a value the app ships or reads;
[ADR-0005](0005-mobile-native-shell-single-web-core.md), [#148]/[#158]). This is the strongest
rung precisely because Wymber does not implement or control the verification: Google's signing
infrastructure does, entirely outside both our reach and an attacker's.

### (ii) A browser extension ([#115], deferred)

An out-of-band Code-Verify-style extension, cited in ADR-0003 Layer 2, would compare the code
actually loaded in the tab against a published manifest, from outside the page. Strong, because
the check runs in a process the page cannot touch. But its own trust is not free-standing: the
extension itself has to be installed from a browser store, so a user is trusting that store's
review and signing pipeline to have kept the extension honest. It inherits a store's trust rather
than standing on its own the way (i) does.

### (iii) A transparency log (this ADR, weakest of the three)

What this ADR adds. Be blunt about the ceiling: **a transparency log does not prevent a targeted
attack.** If `wymber.app` were compromised and served one modified file to one targeted visitor
while serving the honest file to everyone else, a signed log over the manifest that everyone else
sees would not stop that from happening, and would not warn the targeted person at the moment it
mattered. What it changes is what happens *after*: it makes the act **detectable and provable, by
a third party, after the fact**, because the log entry for what was actually signed sits in a
public, hash-chained, append-only record that the honest manifest either matches or doesn't. That
is a real property. It is also a distinctly lesser one than "this attack could not happen," and
this document does not blur the two.

## What signing proves, and what it does not

Say the limits plainly, because this section will be read by someone deciding whether to trust
this tool with the worst thing that ever happened to them, and understating is the right failure
mode here, not overstating.

- **It does not stop a compromised host from serving different bytes to one targeted user.**
  Signing does not run at request time and does not gate what a server hands back to any
  particular visitor. It only makes the act of doing so leave signed evidence behind, evidence a
  third party can later compare against what was actually served.
- **A compromised build pipeline signs a bad manifest exactly as happily as a good one.** The
  signature proves the *keyholder* endorsed a manifest, not that the manifest is correct. If the
  machine that builds and signs releases is itself compromised, it will sign whatever it is told
  to build, and the signature will verify perfectly.
- **Verifying a log against a key fetched from the same place as the log proves very little.**
  `scripts/integrity-log.mjs` prints this caveat itself, every time `--key` is supplied: a party
  able to rewrite `wymber.app`'s log could publish a matching key right next to it. A green result
  from a run whose log *and* key were both downloaded from `wymber.app` proves the site is
  internally self-consistent, not that the site is honest. The key has to come
  from somewhere independent for the check to mean anything (see "Publishing the public key," below).
- **Nothing gates on any of this.** No unlock flow, no build step, no CI check fails because a
  release is unsigned. Signing is informational, full stop; see "Consequences."

## The third-party anchor is the git repo itself

The log is a committed file, `landing/integrity-log.jsonl`, so every push carries it into GitHub's
public, timestamped commit history. Anyone can clone the repo at any past commit and read exactly
what the log said at that point, independent of what `wymber.app` currently serves. That is a
real, if modest, third-party anchor: a compromise that only touched the live site would not also
rewrite every fork and clone already sitting on other people's machines.

Be honest about how much weaker this is than a witnessed log (Sigstore/Rekor-style, see below).
The owner controls this repository and *could* force-push over the log's history. The hash chain
(`prev` = SHA-256 of the previous line's exact bytes) and the fact that other people's existing
clones and CI logs already have a copy make a rewrite **detectable**, not **impossible**: a force-
push changes commit SHAs, and anyone who diffs their old clone against the new history sees it.
"Append-only" here is enforced by convention, the signing script's own append-only write-and-
reverify check, and by outside evidence, not by any mechanism that stops the repository owner
from rewriting it. That is a materially different, weaker claim than a log hosted by a party who
cannot rewrite it at all.

## Key custody: decided

Two decisions were taken on 2026-08-09, both before any production key exists.

**Storage: the maintainer's password manager**, as an encrypted attachment or note. Chosen for
operational realism over theoretical strength: a key that is awkward to reach is a key that
tempts a shortcut on release day, and the shortcut is always worse than the storage choice it
avoided. The honest cost, recorded here rather than glossed: **the signing key is exactly as
safe as that password manager and its unlock method.** A compromise of the manager is a
compromise of the key, with no second factor between them. If the manager supports a hardware
second factor, use it; if the project's release cadence ever becomes frequent enough for a
dedicated token to be worth the friction, revisit this line.

**Rotation and retirement: a retirement record appended to the log itself**, in the same
hash-chained format, naming the key being retired. The log therefore becomes its own
append-only history of which key was trusted between which records. Chosen because it adds no
infrastructure, is self-describing, and a verifier already reading the log gets it for free
rather than having to know to consult a separate list. A published retired-keys list remains a
compatible future addition for verifiers holding a signature but not the log.

This was settled before the first key was generated on purpose: retrofitting retirement onto a
log that already contains entries which *look* unretired means either rewriting history, which
the hash chain deliberately makes detectable, or bolting on an out-of-band list and hoping
verifiers consult it.

The options considered are preserved below, since a future reader deciding whether to revisit
this needs to see what was weighed.

**Where the private key lives.** Candidates, roughly in ascending cost and descending single-point-
of-failure risk:
- An offline file (an air-gapped drive, never on a machine that also browses the web). Cheapest,
  weakest against a compromised signing machine at the moment of signing.
- A password manager's encrypted-note or file-attachment feature. Convenient, inherits the trust
  and attack surface of that password manager and its unlock method.
- A hardware token (a YubiKey or similar) that never exposes the raw private key, only performs
  signing operations. Strongest of the three against exfiltration; adds a physical dependency and
  a recovery story if the token is lost or damaged.
- A cloud KMS (e.g. a cloud provider's key-management service) that signs on request without ever
  releasing the key. Strong against local compromise; reintroduces a third party and a network
  dependency this project has otherwise avoided everywhere else (this app makes no outbound
  requests; a KMS-backed signer would be the one exception, and only for the owner's own signing
  workflow, never for anything the running app does).

**Who can use it.** Today, by construction: whoever holds the file/token/credential, since
`scripts/sign-integrity-log.mjs` is a local script the owner runs by hand, never CI (CI has no
key). Multi-person signing (e.g. requiring two people) is not built and is out of scope here; a
single owner-held key is the simplest starting point and matches how the rest of this project's
trust decisions are made today.

**What happens on compromise.** If the private key is ever exposed, an attacker could produce
signatures that verify against the published public key, including over a malicious manifest.
There is no automatic revocation: nothing currently checks "is this key still trusted" beyond
"does it match the one published." A compromise response would mean generating a new key,
publishing it everywhere the old one was published, and publishing that the old key is retired.

**What rotation means for already-published signatures.** A rotated (or retired) key does not
retroactively invalidate what it already signed: a signature over a specific manifest at a
specific commit stays cryptographically valid for exactly that manifest and commit forever, the
same way an expired code-signing certificate doesn't un-sign old software. The open question is
how a verifier, possibly checking a signature made months ago, learns that the key that made it
has since been retired (e.g. because it was compromised, not just because a newer key exists).
Options worth weighing, not chosen here:
- **A retirement record appended to the log itself**, in the same hash-chained format (e.g. a
  record whose `alg`/`keyId` names the key being retired), so the log becomes its own append-only
  history of "this key was trusted from record N to record M."
- **A key-overlap period**, publishing the new key alongside the old one for some window before
  the old key stops being used to sign anything new, so verifiers see the transition rather than a
  hard cutover.
- **A separate, explicitly-dated "retired keys" list**, published the same places the active key
  is (repo, DNS), which a careful verifier is expected to consult before trusting an old signature
  as still meaningful.

None of these are mutually exclusive, and none are adopted by this ADR. The owner decides which
combination, if any, to commit to before the first production key is generated; changing the
answer after keys already exist is possible but costs more (retrofitting a retirement scheme onto
a log that already has unretired-looking entries in it).

## Why Ed25519 and no new dependency

`node:crypto` in this repo's Node (v22.15.0, confirmed by running the tooling in this worktree)
has Ed25519 signing and verification built into the standard library: `generateKeyPairSync`,
`sign`, `verify`, `createPrivateKey`, `createPublicKey`, all used as-is in
`scripts/integrity-log.mjs` and `scripts/sign-integrity-log.mjs` with no import beyond `node:*`
built-ins. That matters for a project with no build step and a deliberately narrow dependency
surface (an unaudited signature-verification library is exactly the kind of supply-chain risk
this whole ADR exists to guard against). A verifier a stranger can run straight out of a fresh
`git clone`, with zero `npm install`, is a feature of the design, not an incidental convenience:
it removes "trust this other package too" from the chain of things a verifier has to accept.

## Publishing the public key in more than one independent place

The repo is one place (this ADR, and eventually the key itself, once one exists). A DNS TXT record
on `wymber.app` is a good second, because DNS for that domain is controlled through a different
account and system entirely from the GitHub repo: compromising one does not hand an attacker the
other. A third place (a social post, the Zoignon Studio site) raises the bar again, since an
attacker now has to compromise three unrelated systems to publish a matching fake key everywhere a
verifier might check.

**Template for the owner to add, once a real key exists (placeholders only, nothing here is a
real value):**

```
Name:  _wymber-integrity.wymber.app
Type:  TXT
Value: v=wymber1; alg=ed25519; keyId=<32 hex chars, printed by scripts/sign-integrity-log.mjs>; spki=<base64 SPKI DER, from the PEM the same script prints, header/footer/newlines stripped>
```

`keyId` and the SPKI public key both come straight out of the signer's own output (see the
ceremony below): `keyId` is printed as `keyId: <hex>`, and `spki` is the base64 body of the
`-----BEGIN PUBLIC KEY-----` PEM block the script prints, with the header, footer, and line breaks
removed so it fits on one TXT-record line. Nothing about this template requires the owner to
compute anything by hand beyond that copy-and-strip step.

Why two sources, not one: a verifier who checks the key against both the repo and DNS is safe
unless an attacker compromises *both independently*, which is a materially harder bar than
compromising either alone. A verifier who only checks the log against a key living next to the log
(same repo, same site) gets the weak self-consistency check `integrity-log.mjs` warns about at
runtime, not the independent one this section is for.

## The key-generation ceremony

`scripts/sign-integrity-log.mjs` refuses to create a key. Run without `--key` or
`WYMBER_SIGNING_KEY` set, it prints the exact ceremony below and exits non-zero, doing nothing
else. This is copied verbatim from actually running `node scripts/sign-integrity-log.mjs` in this
worktree (no key configured), not paraphrased:

```
[sign-integrity-log] No signing key was given (no --key, no WYMBER_SIGNING_KEY). This script
never creates one, that boundary is deliberate: a production signing key must be generated once,
by the owner, on a machine they control, and must never touch this repository or any git history.

To generate a NEW Ed25519 keypair (stdlib only, run this yourself, ONCE, from a directory OUTSIDE
any git checkout of this repo):

  node -e "const{generateKeyPairSync}=require('node:crypto');const{writeFileSync}=require('node:fs');const{privateKey,publicKey}=generateKeyPairSync('ed25519');writeFileSync('wymber-signing-key.pem',privateKey.export({type:'pkcs8',format:'pem'}));writeFileSync('wymber-signing-key.pub.pem',publicKey.export({type:'spki',format:'pem'}));console.log('wrote wymber-signing-key.pem (PRIVATE - keep offline, never commit, never share) and wymber-signing-key.pub.pem (publish this one)');"

That writes two files in your current directory:
  wymber-signing-key.pem      the PRIVATE key. Keep it offline (a password manager, an air-gapped
                               drive, a hardware key). Never commit it. Never put it in .secrets/
                               or anywhere inside a wymber checkout.
  wymber-signing-key.pub.pem  the PUBLIC key. This is what you publish, through a channel
                               independent of this repo/site (ADR-0003: "a client cannot prove its
                               own honesty" applies just as much to a log verifying itself, so the
                               key that checks it has to be findable somewhere else too).

Then sign, pointing this script at the private key's path from OUTSIDE the repo:

  WYMBER_SIGNING_KEY=/absolute/path/to/wymber-signing-key.pem node scripts/sign-integrity-log.mjs

(or: node scripts/sign-integrity-log.mjs --key /absolute/path/to/wymber-signing-key.pem)
```

Once run, `wymber-signing-key.pem` goes wherever the "where the private key lives" section above
lands (owner's call), never into any wymber checkout, `.secrets/`, or git history. The public half,
`wymber-signing-key.pub.pem`, is what gets published: into the DNS TXT record above, and eventually
alongside this ADR once a real key exists. Every subsequent signing run
(`node scripts/sign-integrity-log.mjs --key /path/to/wymber-signing-key.pem`) prints the same two
things at the end, the record it appended and the public key to publish, so the publish step is a
copy-paste from the signer's own output, not a value anyone has to reconstruct by hand.

## Sigstore / Rekor: considered and deferred

[Sigstore](https://www.sigstore.dev/)'s Rekor is a genuinely independent, publicly witnessed
transparency log, run and monitored by a party other than the project. That is a meaningfully
stronger property than a self-hosted, git-anchored log: a Rekor entry cannot be quietly force-
pushed away by the project the way this repo's own git history theoretically could be, because
the witness is a third party by construction, not by convention.

The cost is real too: it means an external service dependency (Rekor's public instance, or
self-hosting the equivalent), a new toolchain (`cosign` or an equivalent client, likely a new
`npm` dependency or a separate binary this repo does not otherwise need), and, for a
privacy-first product whose entire posture is "nothing leaves the device" and "no build step,"
one more moving external part in a project that has deliberately kept its dependency count and
network surface close to zero everywhere else.

Recommendation: revisit Sigstore/Rekor once (a) a production key actually exists and has been in
use long enough to know whether the self-hosted log's actual weak point (owner-controlled repo
history) has mattered in practice, and (b) the project's tolerance for a build-time or CI-time
external dependency has been reconsidered elsewhere, not decided as a side effect of this ADR.
**This ADR does not adopt Sigstore/Rekor.** What ships here is the git-anchored log described
above, with its weaker, but honestly-stated, property.

## Consequences

- Signing remains informational only. No unlock flow, build, or CI step gates on whether a release
  is signed, whether a signature verifies, or whether the log has any records at all. This is
  enforced today by `.github/workflows/ci.yml` running only the structure/chain check (no `--key`,
  no `--require-signed`) and by nothing in `frontend/js/` reading this log or the manifest's
  signature status.
- Forks stay fully legitimate. Anyone may build, host, and distribute an alternative client from
  this same AGPL-3.0 source. What they cannot do is produce a signature that verifies against the
  owner's published key, or call their fork Wymber (`TRADEMARK.md`). Both are honest, narrow
  limits: identity and endorsement, not permission to run the software.
- No new dependency. `node:crypto`'s stdlib Ed25519 support is the entire cryptographic surface.
- No data leaves the device. Signing is a release-time action the owner runs locally against a
  static manifest file; the running app makes no request related to this log or any key, consistent
  with [ADR-0001](0001-local-first-encrypted-file.md).
- `landing/integrity-log.jsonl` stays empty, and every honest description of the project should
  say so, until a production key exists and the owner has actually run the signer.

## Alternatives considered

- **Sign the app bundle itself, not the manifest.** The manifest already covers every shipped
  file's hash; signing the manifest transitively covers the bundle without needing a second
  signature format for, e.g., a desktop or mobile build artifact later. Revisit if a future signed
  artifact (a Tauri desktop build,
  [ADR-0003](0003-client-integrity-and-anti-phishing.md) Layer 4) needs its own, differently-shaped
  signature; not needed today.
- **Embed a signature inside the `.wymber` file.** Already rejected by
  [ADR-0003](0003-client-integrity-and-anti-phishing.md)'s "Alternatives considered": the file is
  passive data, and an attacker re-signs their own copy with their own key just as easily as the
  real client signs a real one. Not relitigated here.
- **A self-attesting in-app "signed ✅" badge.** Firmly rejected. This is exactly the spoofable
  self-attestation ADR-0003 forbids by name ("a client cannot prove its own honesty"): a modified
  client would simply show the same badge and lie, and a person under threat has no way to tell
  the difference by looking at the page. This is also why this change does not touch anything in
  `frontend/js/`: there is no in-app surface for this ADR to wire up, on purpose. Any future
  in-app indicator of signature status would need to point *out* of the page, the way the "verify
  this client" page and Layer 2's browser extension do, never render a verdict computed by the
  page checking itself.

[#111]: https://github.com/Tamok/wymber/issues/111
[#112]: https://github.com/Tamok/wymber/issues/112
[#115]: https://github.com/Tamok/wymber/issues/115
[#148]: https://github.com/Tamok/wymber/issues/148
[#158]: https://github.com/Tamok/wymber/issues/158
