# Crypto parity tests (issue #150)

"A vault sealed on web must unlock on device, and vice versa" — a **security-parity** check
(ADR-0005, ADR-0001), not a nicety. The same `frontend/js/crypto.js` runs everywhere (ADR-0005
keeps it single-source), so the *algorithms* cannot diverge by construction. What can still drift:

- the **serialized envelope format** itself changing incompatibly over time (a field rename, a
  KDF parameter change, a base64 variant change) so old vaults stop opening;
- the **storage encoding**: `NativePersistence` (`frontend/js/native-persistence.js`) writes the
  sealed blob through Capacitor Filesystem with `encoding: 'utf8'`, while `persistence.js` stores
  a JS string in OPFS/IndexedDB — if the envelope ever stopped being pure-ASCII, the native path
  could mangle it;
- the two **JS runtimes**: Node's WebCrypto (OpenSSL-backed) vs Chromium's (BoringSSL-backed).
  Chromium matters specifically because Android's System WebView *is* Chromium, the closest honest
  stand-in for "device" available in this repo (there is no Android device/emulator here — see the
  gap noted below).

## What's in here

- `fixtures/fixture-document.js` — the shared document + throwaway password/recovery-code inputs
  both fixtures are sealed from.
- `fixtures/node-sealed.vault.js` — a vault **sealed under Node's WebCrypto**, exported as
  `export const nodeSealedFixture = {...}`.
- `fixtures/chromium-sealed.vault.js` — the *same* document, sealed under **Chromium's WebCrypto**
  (via a real Playwright page loading the app's own `crypto.js` as an ES module), exported as
  `export const chromiumSealedFixture = {...}`.
- `fixtures/generate.node.mjs` / `fixtures/generate.chromium.mjs` — the generators (see below).
- `crypto-parity.spec.js` — the Playwright/Chromium half of the test (the Node half lives at
  `frontend/tests/native-crypto-parity.test.js`, vitest, since it needs no browser).

Both fixture modules export the sealed vault **plus** the recorded plaintext (password, recovery
code, and the exact document object that was sealed), so tests can assert the decrypted document
matches field-for-field, not merely that unlocking "didn't throw".

**Why plain `.js` modules exported as an object literal, not `.json` read via `node:fs`:** this
repo's `package.json` has no `"type": "module"`, so Playwright transforms `.js` specs toward CJS
before running them. A fixture loader that used `.mjs` (which forces ESM) or `import.meta.url`
(unavailable after that transform) made `crypto-parity.spec.js` fail to load at all under
Playwright ("`ReferenceError: require is not defined`" / "No tests found") even though the exact
same code worked fine under vitest — a real regression caught in review before it ever reached CI.
Both fixture modules use plain `import`/`export` only, exactly like the sibling `e2e/helpers.js`,
so both vitest and Playwright load them identically.

## These are test fixtures. The secrets in them are throwaway, not real credentials.

`fixture-document.js`'s password and recovery code exist only to seal these two frozen files.
Nobody's actual trauma map is behind them.

## The fixtures are FROZEN. Read this before touching them.

They were sealed once, with the `DEFAULT_ITERATIONS` KDF cost that was live in `crypto.js` at the
time (recorded in each file, currently 600000 — deliberately **not** lowered for speed: the
envelope records its own iteration count, so a frozen fixture only proves anything if it keeps
opening even after the *default* changes later. That is the backward-compatibility property this
whole test exists to protect).

**If a parity test starts failing, that is the signal working as designed. Do NOT "fix" it by
regenerating the fixture.** Regenerating on a red test silently launders exactly the kind of
envelope break this test exists to catch — the fixture would start passing again for the wrong
reason, and a real user's already-sealed vault would still fail to open. Instead:

1. Figure out *why* the format changed (an intentional envelope/KDF change vs. an accidental one).
2. If it was accidental: fix the code, not the fixture.
3. If it was a deliberate, versioned, backward-compatible change (e.g. a new KDF, added under a
   new `kdf.algo` value, with old vaults still opening via their recorded algo): add a **new**
   fixture pair for the new format and keep the old ones passing too. Only replace an existing
   frozen fixture as a last resort, with an explicit note in the PR about what compatibility
   guarantee is being given up.

## Regenerating deliberately

Only do this when you mean it (see above). Both generators reseal `fixtureDocument()` with the
live `crypto.js`, at its current `DEFAULT_ITERATIONS`:

```bash
node e2e/parity/fixtures/generate.node.mjs        # writes fixtures/node-sealed.vault.js
node e2e/parity/fixtures/generate.chromium.mjs     # writes fixtures/chromium-sealed.vault.js
                                                    # (spins up a throwaway uvicorn on :8099,
                                                    # launches Chromium, tears both down)
```

Both generators emit the frozen `.js` module form directly (`export const ...Fixture = {...}`),
so what they write is exactly what gets imported — never hand-edit the generated file afterward.

## What this test proves, and what it does not

Proves: a vault sealed on Node's WebCrypto opens (password + recovery) on Chromium and vice versa;
a vault survives the exact byte encoding `NativePersistence` uses (`utf8` via
`TextEncoder`/`TextDecoder`) and the native storage read/write seam (mocked Filesystem plugin in
the vitest half, an in-page Capacitor shim in the Playwright half); a blob written by the **real
web backend** (`persistence.js`, OPFS/IndexedDB) is read back intact by `NativePersistence` and
vice versa, still unlocking by **both** roots after the crossing; the envelope's structural
invariants (format tag, version, both key wraps, base64 payloads, ASCII-only today) hold across
both fixtures.

Note on where each half lives: the web↔native storage crossing is tested **only** in the Playwright
half, on purpose. `persistence.js` is browser-only, so under Node it could only be stood in for by
an in-memory fake — and comparing a fake against `NativePersistence` collapses into asserting a
string equals itself. A test that cannot fail is worse than no test, so it lives where both
backends are real.

Does **not** prove: correctness on an actual Android device or emulator (none exists in this
repo/CI) — a real device could still differ in ways Chromium-on-desktop cannot surface, e.g. the
*real* `@capacitor/filesystem` native plugin (Kotlin/Swift) instead of its web shim/an in-page
mock, real Android Keystore-backed storage behavior, OS-level file encoding quirks, or
device-specific WebView builds. That gap is real and open; closing it needs an actual device/CI
lane (tracked under the mobile epic, #56), not something this test suite can fake.
