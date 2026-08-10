# ADR-0009: Publish asset severity as manifest data, and compare copies locally or not at all

- Status: Proposed (2026-08-09), pending owner review
- Decider: [@tamok](https://github.com/tamok)

## Context

[ADR-0003](0003-client-integrity-and-anti-phishing.md) is the governing decision; read it first.
Its Layer 1 has landed: a reproducible build, a published SHA-384 manifest on two origins,
Subresource Integrity, import-map integrity, and a strict Content-Security-Policy ([#111], [#112]).
[ADR-0007] added an Ed25519 signature over that manifest and a hash-chained transparency log.
Layer 5's "verify this client" page ([#114], `landing/verify.html`) documents how to check all of
it by hand.

Two gaps remained, and they are related.

**A hash list does not tell you where to look.** A verifier that reports "3 of 30 files differ"
leaves the reader to work out for themselves whether those three are stylesheets or the file that
holds the encryption key. Every verifier that exists or is planned (the CLI, the Code-Verify-shape
browser extension of Layer 2, [#115], and the on-page tool this ADR adds) would otherwise invent
that judgment separately, and they would disagree.

**Checking a copy by hand is a real barrier.** The page's existing instructions are correct and
almost nobody will follow them: they require a terminal, a clone, Node, and a byte-level diff.

## Decision 1: severity is manifest data, produced fail-closed

`landing/integrity-manifest.json` (schema 2) now carries a tier for every asset, from a single
exact-path table in `scripts/asset-severity.mjs`, plus a `severity` block giving each tier's
plain-language meaning and the honesty note below. Every verifier reads that classification
instead of deriving its own.

`assets['/path']` changed from a bare hash string to `{ hash, severity }` rather than gaining a
parallel `severity` map alongside the existing one. A parallel map can drift: it can list a file
`assets` does not, or omit one it does, and nothing structural notices. With one object per asset,
an unclassified asset is **not representable**, which is the property worth having.

The table is exact paths only. No extension rule ("`*.png` is low"), no prefix rule
("`/static/js/` is high"), no default. A file added to the shipped app that nobody classified makes
the generator throw, naming every unclassified path at once, and no manifest is written. A skipped
judgment call is a judgment call made wrong, and the cost of being wrong here is asymmetric: the
silent default would always be the reassuring answer.

### Severity is triage, never permission

This is the part most likely to be misread later, so it is stated in the manifest itself, on the
page, and here.

Severity answers "how alarmed should I be, and what should I look at first". It does not answer
"can I ignore this". Every asset is served under SRI and a strict CSP, so **any** unexpected
difference means the deploy is not what was published, whatever its tier. No verifier may emit a
green or passing state for a difference that happens to be low severity. "Differs, low severity" is
still "differs".

"Low" does not mean harmless. A stylesheet cannot read the vault. It can restyle the page to fake
an unlock prompt, hide a warning, or make a storage error look like a fresh start so that someone
creates a new vault over their real one. It cannot take the data; it can persuade a person to hand
it over. That is a different shape of harm, not a smaller one, and the wording everywhere reflects
that.

Note also that every file under `/static/js/` and `/static/libs/` runs as script in the app's own
origin, so a swapped one could in principle do what any other module can. The tiers rank where to
look first, by how directly the *published* file touches keys or the decrypted map. They are not a
capability boundary, and nothing enforces them.

### The tiers, and what "verified" meant

- **critical** (9): on the path of the unlock secret or the encryption key, or decides what code the
  browser loads and validates at all.
- **high** (7): handles the whole decrypted document, or is a route by which it leaves the device.
- **moderate** (5): changes what the app says or does, without touching keys or the decrypted map.
- **low** (9): cannot read the vault.

Each assignment was checked against what the file does, not what its name suggests, and five
landed somewhere other than a first reading would put them:

- `utils.js` is **critical**, not moderate: it exports `passwordStrength()`, which `app.js` calls
  with the plaintext password on the create and unlock paths.
- `native-biometric.js` is **critical**, not high: `biometricEnroll()` and `biometricUnlock()` pass
  the raw data key to and from the device keystore.
- `native-persistence.js` is **critical**, not high: besides reading and writing vault ciphertext,
  its `isStorageUnavailableError()` decides whether a storage failure reads as "no vault yet",
  which is the difference between an error message and someone creating a new vault over a real
  one.
- `analyze.js`, `suggest.js` and `mindmap.js` are **high**, not moderate: `analyzeMap(nodes, edges)`,
  `suggestLinks(nodes, edges)` and the renderer are each handed the whole decrypted document.
- `cytoscape.min.js` (**high**) and `404.html` (**moderate**) were unclassified in the first pass.
  Cytoscape executes in the app's own realm, is handed every node's text, and is the largest and
  least human-diffable file shipped. A replaced 404 page sits on the real origin, so the address
  bar is genuinely correct: it is the most convincing place to put a fake prompt without touching
  any script.

`mindmap.js` was considered for critical, since `ensureCytoscape()` injects a `<script>` element
and ADR-0003 puts "decides what code loads" in that tier. It stays high: the element points at one
fixed same-origin path, so the set of code it can cause to load is exactly the set already in the
manifest. It does not widen what can run, unlike `sw.js` or `index.html`'s import map, which do.

## Decision 2: the comparator runs locally, and there is deliberately no URL checker

`landing/verify.html` gains a tool that hashes a copy of the client with WebCrypto SHA-384 in the
reader's own browser and diffs it against the published manifest, reporting match / differs /
missing / unexpected, grouped by severity, highest first.

**It makes zero network requests, and `connect-src 'none'` does not change.** The manifest is
embedded in the page as a `<script type="application/json">` data block rather than fetched, which
is also the only option available: the landing has no build step and may not make requests at all.
A privacy-first tool that asks a person to hand over files has to answer "where does this go"
before it is asked, so the page says so first, and the property is enforced by the CSP and checked
by a test that drives the shipped page in a real browser and asserts the request count does not
move.

**A "paste a URL" checker is not offered, and that is the decision, not an omission.** A scanner
that fetches a site from its own servers can be handed clean bytes while real visitors are served
poisoned ones, because the addresses such a scanner calls from are knowable in advance. It would
return a confident pass on precisely the attack it exists to catch, which is worse than having no
checker at all: it manufactures false assurance. The honest form of that check runs in the reader's
own browser against the bytes that browser actually received, from outside the page. That is
Layer 2's browser extension, [#115], still deferred.

### Consequences and limits

- This checks a copy someone already has against the published list. It says nothing about the page
  the reader is currently on, and cannot: ADR-0003's "a client cannot prove its own honesty" applies
  to this tool exactly as it applies to everything else on this origin. A cloned site could ship a
  cloned comparator that reports whatever it likes.
- The published list is a release snapshot and can trail the app by a commit or two. `index.html`
  and `build-info.js` both carry the build's commit stamp, so a copy built from a different commit
  differs in those two files with nothing wrong. The page says so, because it is the most likely
  confusing result.
- The tool's code is an inline `<script>` with a generated `sha256-` CSP hash, not an external
  file: `landing/_headers` allows no script source at all, only hash-pinned inline blocks, and
  `frontend/tests/csp.test.js` asserts that `script-src` never gains `'self'`. Regenerate with
  `node scripts/landing-csp.mjs` after any edit. A stale hash does not error, it silently stops the
  script running, so a test drives the real page under the shipped headers and asserts the tool
  actually became visible.
- No new dependency. WebCrypto in the browser, Node stdlib in the tooling.
- Nothing gates on any of this, consistent with [ADR-0007]: no unlock flow, build, or CI step fails
  because a file differs or a tier is high.

## Alternatives considered

- **A parallel `severity` map beside `assets`.** Non-breaking, and drifts silently. Rejected: the
  whole point is that an unclassified asset must be impossible, not merely unlikely.
- **Extension or prefix rules instead of an exact-path table.** Less maintenance, and a new file
  lands in a tier nobody chose. Rejected for the same reason.
- **Inferring severity in each verifier.** Guarantees that two tools disagree about the same file
  and gives a reader no way to know which to believe. Rejected; that is why this is manifest data.
- **A server-side or hosted URL checker.** Rejected above, on the merits: it would be confidently
  wrong in exactly the case that matters.
- **Fetching the manifest at runtime instead of embedding it.** Would require relaxing
  `connect-src`, on the one origin whose entire posture is that it requests nothing. Rejected.
- **An external `verify-tool.js` with SRI instead of an inline script.** Would require adding
  `'self'` to the landing's `script-src`, weakening a documented posture and breaking an existing
  test, to gain a file that a no-build-step origin cannot hash without the same generator machinery
  the inline path already uses. Rejected.
- **Treating "missing" as evidence of tampering.** Rejected: someone who checks three files has
  three checked files and the rest unchecked. Reporting that as "this copy is not what was
  published" would cry wolf on the tool's most ordinary use, and a tool that cries wolf is one
  people stop reading. Differences and unexpected extras are reported plainly; an incomplete check
  is reported as incomplete.

[#111]: https://github.com/Tamok/wymber/issues/111
[#112]: https://github.com/Tamok/wymber/issues/112
[#114]: https://github.com/Tamok/wymber/issues/114
[#115]: https://github.com/Tamok/wymber/issues/115
[ADR-0007]: 0007-manifest-signing-and-transparency-log.md
