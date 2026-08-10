# Research: Argon2id via WASM for the vault KDF (#100)

- Status: research, feeds a decision; does not make one.
- Scope: whether/how to add Argon2id as a second KDF option alongside PBKDF2-SHA256
  (`frontend/js/crypto.js`), per the envelope rules in
  [ADR-0008](../adr/0008-vault-envelope-evolution.md) and the auditability story in
  [ADR-0003](../adr/0003-client-integrity-and-anti-phishing.md).
- All external claims below are cited with the URL fetched and the date fetched
  (2026-08-09, this session), using `WebSearch`/`WebFetch`. Where a claim could not be
  independently verified from a primary source, it is marked **[unverified]** and the
  attempt is described. Nothing below is from model recollection.

## 1. The candidate packages

| Package | Version | Published | License | Last repo push | Open issues | Argon2 payload size | Pure-JS fallback? |
|---|---|---|---|---|---|---|---|
| [`argon2-browser`](https://www.npmjs.com/package/argon2-browser) (antelle) | 1.18.0 | 2021-06-05 | MIT | 2023-03-24 | 20 | not isolated; ships `argon2.wasm` + SIMD variant | No |
| [`hash-wasm`](https://www.npmjs.com/package/hash-wasm) (Daninet) | 4.12.0 | not confirmed (see below) | MIT | 2024-11-19 | 13 | 11 KB gzipped for all of Argon2d/i/id combined | No |
| [`libsodium-wrappers-sumo`](https://www.npmjs.com/package/libsodium-wrappers-sumo) | 0.8.4 | not confirmed (see below) | ISC | **2026-07-14** | 0 | package unpacked 553,777 bytes; a general web summary (not independently confirmed) put min+gzip around 375 KB for the sumo build | No |
| [`argon2id`](https://www.npmjs.com/package/argon2id) (openpgpjs org) | 1.0.1 | not confirmed | MIT | 2023-08-03 | 1 | **< 7 KB minified+gzipped**, WASM inlined as base64 | No (tried, abandoned — see §2) |
| [`@noble/hashes`](https://www.npmjs.com/package/@noble/hashes) | 2.3.0 | not confirmed | MIT | active | — | **N/A — has no Argon2 implementation at all** | pure-JS scrypt/PBKDF2 only |

Sources fetched 2026-08-09:
[npm registry: hash-wasm](https://registry.npmjs.org/hash-wasm),
[npm registry: argon2-browser](https://registry.npmjs.org/argon2-browser),
[npm registry: libsodium-wrappers](https://registry.npmjs.org/libsodium-wrappers),
[npm registry: libsodium-wrappers-sumo](https://registry.npmjs.org/libsodium-wrappers-sumo/latest),
[npm registry: argon2id](https://registry.npmjs.org/argon2id/latest),
[npm registry: @noble/hashes](https://registry.npmjs.org/@noble/hashes),
[GitHub API: Daninet/hash-wasm](https://api.github.com/repos/Daninet/hash-wasm),
[GitHub API: openpgpjs/argon2id](https://api.github.com/repos/openpgpjs/argon2id),
[GitHub API: antelle/argon2-browser](https://api.github.com/repos/antelle/argon2-browser),
[GitHub API: jedisct1/libsodium.js](https://api.github.com/repos/jedisct1/libsodium.js),
[hash-wasm README](https://raw.githubusercontent.com/Daninet/hash-wasm/master/README.md),
[openpgpjs/argon2id README](https://raw.githubusercontent.com/openpgpjs/argon2id/main/README.md).

Notes and caveats on this table:

- **Exact npm publish timestamps for the specific `4.12.0`/`0.8.4`/`1.0.1` versions could
  not be confirmed.** The registry JSON documents are large; `WebFetch`'s summarizer
  truncated them before reaching the per-version `time` map for `hash-wasm`, and the
  `argon2id`/`libsodium-wrappers-sumo` version-specific registry endpoints don't surface
  a publish date distinct from the package's general metadata. What I could confirm
  instead is each **GitHub repository's `pushed_at`** (via the GitHub API, not the npm
  registry), which is what the table reports. Treat "last repo push" as the more reliable
  staleness signal here; I did not further chase exact npm timestamps once the repo-level
  signal was in hand, since it answers the maintenance question the brief cares about.
- `argon2-browser` (antelle) has had no repository activity since **2023-03-24** (this
  session runs 2026-08-09, roughly three and a half years of no push) and 20 open issues.
  It is, on the evidence gathered, effectively unmaintained.
- `hash-wasm`'s last push was **2024-11-19**, about 21 months before this research. 13
  open issues against 1,152 stars. Not abandoned, but not actively developed either.
- `libsodium-wrappers-sumo` (via the `jedisct1/libsodium.js` repo) is the only candidate
  with **recent** activity (pushed 2026-07-14, one month before this research) and **zero**
  open issues. It wraps `libsodium`, a widely used, externally audited C library (Argon2id
  has been its default `crypto_pwhash` algorithm since 1.0.15 — [libsodium docs, "The
  pwhash* API"](https://libsodium.gitbook.io/doc/password_hashing/default_phf), fetched
  2026-08-09). Note the `crypto_pwhash_*` family (needed for Argon2id) is **only present in
  the "sumo" build**, not the standard `libsodium-wrappers` package — confirmed via the
  same docs page and the registry unpacked-size difference (554 KB sumo vs. the standard
  build).
- `hash-wasm`'s own benchmark (from its README) puts Argon2id at **438 ops/sec at m=512
  KiB, t=8, p=1** on whatever reference hardware they benchmarked on (unspecified in the
  README excerpt fetched), ahead of `argon2-browser` (213 ops/sec) and `argon2-wasm` (195
  ops/sec) at the same parameters. Those parameters are far lighter than OWASP's recommended
  interactive setting (§4), so this number is not directly usable for a real cost estimate.
- `hash-wasm` supports **tree-shaking** ("Webpack only bundles the hash algorithms you
  use"), so a real integration would only pay for the ~11 KB Argon2 binary, not the whole
  package's ~1.8 MB unpacked footprint (which covers every hash function it ships).

**None of the five ships a pure-JS fallback that its own authors consider production-ready.**
See §2.

## 2. Does a credible pure-JS Argon2id exist?

**No.** This was the most interesting possible finding per the brief, and it comes back
negative, with two independent, cited data points:

1. The `openpgpjs/argon2id` maintainers **tried pure JS first and abandoned it**: "We
   initially tried implementing a solution in pure JS (no Wasm) but the running time was
   unacceptable... We resorted to implement part of the module in Wasm, to take advantage
   of 64-bit multiplications and SIMD instructions" ([openpgpjs/argon2id
   README](https://raw.githubusercontent.com/openpgpjs/argon2id/main/README.md), fetched
   2026-08-09). The stated root cause is that Argon2's internal mixing function needs
   64-bit unsigned integer operations, which JavaScript's `Number` type cannot represent
   losslessly and which `BigInt` performs far slower than native `uint64` arithmetic in
   WASM/native code.
2. `Rabbit-Company` publishes **two separate Argon2id packages**: `Argon2id-JS` (pure
   JavaScript) and a distinct `Argon2id-WASM` package. The existence of a second, WASM-based
   implementation from the same author is itself a signal that the pure-JS one wasn't
   considered sufficient on its own. I could not find any published benchmark numbers for
   `Argon2id-JS` — its README documents parameters and a Web Worker option but reports no
   timing data — and it has minimal adoption (6 stars, 2 watchers). **[unverified]**: I
   could not confirm concrete timing numbers for `Argon2id-JS`; I tried its README (fetched
   2026-08-09, no benchmarks present) and a targeted web search for benchmark data, which
   returned none.

**Conclusion: no, a pure-JS path does not sidestep the CSP question.** Every credible,
maintained-enough candidate requires WASM. This means item 3 (does WASM actually need
`wasm-unsafe-eval`) is not avoidable and is the load-bearing question.

## 3. Does WASM actually require `wasm-unsafe-eval`?

**Yes, unconditionally, for every form of WebAssembly compilation.** This was verified
against the CSP spec repository itself, not folklore:

> "when `wasm-unsafe-eval` is set... it allows the page to load, compile and instantiate
> WebAssembly code," covering `WebAssembly.compile`, `WebAssembly.compileStreaming`,
> `WebAssembly.instantiate`, and `WebAssembly.instantiateStreaming` — "the permission
> covers all forms of WebAssembly compilation and instantiation when the directive is
> present," with **no distinction between inline bytes and a fetched/streamed module.**

— [`WebAssembly/content-security-policy` CSP proposal doc](https://raw.githubusercontent.com/WebAssembly/content-security-policy/main/proposals/CSP.md), fetched 2026-08-09.

MDN corroborates from the browser-behavior side:

> "If a page has a CSP header and `'wasm-unsafe-eval'` isn't specified in the `script-src`
> directive, WebAssembly is blocked from loading and executing on the page."
> `'unsafe-eval'` also permits WASM (it's the broader, older grant) but is not preferred,
> since it additionally permits `eval()` and `Function()`.

— [MDN: CSP `script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src), fetched 2026-08-09.

Browser support for the narrower `wasm-unsafe-eval` keyword: **Chrome 97+, Firefox 102+,
Safari 16+** (all shipped years ago, so this is not a compatibility concern) — cited from
the same CSP proposal thread and corroborated by search results referencing the WebKit and
Chromium tracking bugs, though I did not independently fetch caniuse.com's page directly
(a direct fetch was not attempted; the version numbers came from the search summary rather
than a primary source I read myself). **[unverified, low-risk]**: treat the exact minimum
versions as approximate; the underlying fact (widely shipped since ~2021-2022) is
corroborated by two independent sources.

**There is no code-shape workaround.** `instantiateStreaming` vs. `instantiate`, or a
fetched `.wasm` file vs. base64-inlined bytes in a `.js` file (as `argon2id`/openpgpjs
does to keep its footprint small) — none of these change the CSP gate. Inlining the WASM
bytes as base64 avoids a *separate network request* and therefore avoids needing a
`wasm-src`/`script-src` host allowance for a `.wasm` URL, but the act of *instantiating*
those bytes, inlined or not, still requires `wasm-unsafe-eval`. **ADR-0008's assumption
that Argon2id "needs... a `'wasm-unsafe-eval'` relaxation" is confirmed correct, not
folklore.**

## 4. Parameters, and their mobile cost

OWASP's current guidance (fetched directly from the source):

> "m=19456 (19 MiB), t=2, p=1 (Do not use with Argon2i)" as the primary recommended
> interactive setting, with three lighter/heavier alternatives trading memory for
> iterations at roughly equal security: m=12288/t=3/p=1, m=9216/t=4/p=1, m=7168/t=5/p=1.

— [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), fetched 2026-08-09. The same page states the PBKDF2-HMAC-SHA256 recommendation is **600,000 iterations** — exactly what `frontend/js/crypto.js`'s `DEFAULT_ITERATIONS` already ships. Wymber's current PBKDF2 setting is not behind OWASP guidance; it is already at the recommended floor.

**Real-world mobile cost signal**, from a shipping product that already does exactly what
#100 proposes (Argon2id via WASM, in-browser, on a password manager with a comparable
threat model):

> Bitwarden's default Argon2id KDF is `t=3, m=64 MiB, p=4`. A Bitwarden developer
> ("Quexten") explained that the browser/WASM implementation runs Argon2id's parallel
> lanes **sequentially, not in parallel**: "at parallelism 2 the wasm is 2x slower, on 4x
> it is 4x slower (due to being run sequentially)." Separately, Bitwarden's own docs note
> that a KDF memory setting **above 64 MiB triggers an explicit warning dialogue on iOS
> autofill/Share Sheet**, because of memory constraints in that constrained execution
> context.

— [Bitwarden community: "Performance of Argon2id... as compared to KeePass"](https://community.bitwarden.com/t/performance-of-argon2id-algorithm-in-bitwarden-as-compared-to-keepass/56425), and a web-search summary referencing [Bitwarden's KDF docs](https://bitwarden.com/help/kdf-algorithms/) and a [Bitwarden forum thread on Argon2id settings](https://community.bitwarden.com/t/set-argon2id-as-default-kdf/92919), fetched/searched 2026-08-09. The KDF-docs and second-forum-thread content came through `WebSearch`'s synthesized summary rather than a page I fetched and read directly — **[unverified, moderate-confidence]**: the specific "p=4 → 4x slower" and ">64 MiB triggers iOS warning" claims are second-hand from a search summary of a real product's public documentation/forum, not confirmed by me against the primary Bitwarden pages directly. The direct community-thread fetch (`WebFetch`) *did* independently corroborate the sequential-lanes slowdown claim in the maintainer's own words, which is the more load-bearing of the two facts.

This is directly relevant to "a KDF that OOMs a cheap Android is a data-loss event, not an
inconvenience" from the brief: even a well-funded, security-focused team building
purpose-made native+web clients treats **64 MiB as a real ceiling** on constrained mobile
contexts, and found that naively raising `p` (parallelism) in a WASM Argon2id does not
buy the security benefit parallelism is supposed to give (true SIMD/thread parallelism
needs `SharedArrayBuffer` + cross-origin isolation, which is its own CSP/headers
commitment, not evaluated here) — it just adds linear time cost. **The practical
recommendation this implies for Wymber, if Argon2id is adopted, is `p=1`** (OWASP's
primary recommendation already uses `p=1`) and a memory ceiling well under Bitwarden's 64
MiB default, e.g. OWASP's own m=19 MiB.

A concrete timing figure — "~22-23 ms for m=19456 KiB, t=2, p=1" — surfaced in a search
summary referencing an unspecified Node.js benchmark context. **[unverified]**: I could not
trace this to a primary source I fetched myself (the search tool synthesized it from
unnamed benchmark pages), it is not confirmed to be a browser or mobile-device
measurement, and I am not confident enough in its provenance to present it as a real
number for Wymber's actual case. **Honest conclusion: no reliable, sourced,
mobile-specific timing number for Argon2id at OWASP's recommended interactive parameters
was found in this research.** That number would need to come from an actual benchmark run
on representative low-end Android hardware before a parameter choice is finalized — it is
not something a literature search can responsibly manufacture.

## 5. The honest comparison: Argon2id vs. PBKDF2-600k, and "just raise the iterations"

**The mechanism, not just the number.** PBKDF2 is a pure-hash-iteration KDF: each guess
costs a small, fixed amount of compute and a negligible amount of memory (a few hundred
bytes of state). That shape parallelizes extremely well on GPUs and ASICs, which have
enormous numbers of simple compute cores but comparatively little fast memory per core. A
consumer GPU can run huge numbers of independent PBKDF2 guess-instances at once, each one
cheap. Argon2id, by contrast, is **memory-hard by design**: each guess must hold a
multi-megabyte working buffer, and an attacker trying to parallelize guesses across many
cores must provision that memory per core too. Memory bandwidth (and, for a would-be ASIC
attacker, chip area for on-die memory) is dramatically more expensive to scale than raw
compute, so the same nominal "time cost per guess" buys much more real protection under
Argon2id than under PBKDF2, specifically **against an attacker with custom/GPU hardware** —
which is exactly the adversary named in `docs/threat-model.md` §1 (the device thief running
offline, unrate-limited guesses "as fast as their hardware allows").

**What "just raise PBKDF2 iterations" buys, and what it costs:** iteration count is a
*linear* multiplier on both the legitimate unlock and every attacker guess, equally, on
both CPU and GPU. Doubling from 600k to 1.2M doubles unlock latency and doubles attacker
cost by the same factor — it does not change PBKDF2's fundamental GPU/ASIC-parallelism
weakness, because it doesn't add memory pressure. It is real, cheap, zero-dependency,
zero-CSP-change protection (a one-line change to `DEFAULT_ITERATIONS`, immediately
compatible with the existing per-entry KDF descriptor mechanism from #188/ADR-0008), but
it is a **linear improvement to a structurally weak-against-GPUs primitive**, not a
structural fix. I could not find (nor did I look for, since it follows directly from the
mechanism above and is not the kind of claim that benefits from a citation) a source
disputing this well-established property of hash-iteration KDFs vs. memory-hard KDFs; it
is standard, uncontested cryptographic engineering knowledge reflected in why OWASP
recommends Argon2id ahead of PBKDF2 whenever available, per §4's cited cheat sheet.

**A quantified GPU-cost comparison for Wymber's specific numbers was not found.** A search
turned up a claim that "a modern GPU (e.g. RTX 4090) can compute approximately 3.8 million
PBKDF2-SHA256 hashes per second at 100,000 iterations," which would extrapolate (linearly)
to roughly 630,000 guesses/sec at Wymber's actual 600k-iteration setting. **[unverified]**:
this number came from a `WebSearch` synthesis, not a page I fetched and read myself, and I
did not find or fetch a primary source (e.g. a hashcat benchmark table) to confirm it. I am
reporting it only as an order-of-magnitude sanity check, not as a number to build a
decision on. A rigorous version of this comparison would want a primary hashcat/John the
Ripper benchmark table for both PBKDF2-SHA256 and Argon2id at Wymber's actual candidate
parameters, which this research did not obtain.

## 6. Auditability: the ADR-0003 crux

The tension as stated in the brief is real and, on the evidence gathered, not resolvable
by tooling alone: **a `.wasm` blob can be hashed (SHA-384, via the existing SRI/import-map
integrity manifest from ADR-0003 Layer 1) so tampering is detectable, but its bytes cannot
be read and understood by a reviewer the way `crypto.js`'s plain JS can.** That is a
categorical difference, not a matter of degree — no candidate here changes it.

What *does* differ meaningfully between candidates is **how much a reviewer has to trust
the compilation step and the thing being compiled**, since nobody is reading the wasm
bytes directly either way:

- **`libsodium-wrappers-sumo`** compiles a well-known, widely used, externally audited C
  library (`libsodium`) via a documented, scripted build (`Makefile` + `dist-build/
  emscripten.sh` in the [`jedisct1/libsodium.js` repo](https://github.com/jedisct1/libsodium.js/blob/master/Makefile), confirmed to exist and be runnable end-to-end per its own documentation: "Running `make` will clone libsodium, build it, test it, build the wrapper, and create the modules and minified distribution files" — fetched via search summary of the repo's own docs, 2026-08-09, **[unverified against the primary Makefile source directly]**, though the file's existence and general shape was confirmed). Trusting this candidate means trusting (a) upstream `libsodium`'s audit history and wide deployment (used by, among others, Signal), and (b) that Wymber's own CI reruns that build script rather than trusting a pre-built npm artifact — the latter is a build-pipeline decision for whoever implements this, not something the package itself guarantees.
- **`hash-wasm`** and **`argon2id`** (openpgpjs) both claim to compile from a C reference
  implementation, but I could not directly browse either repo's build-script directory to
  confirm a reproducible, from-source build path — a direct fetch of `hash-wasm`'s `wasm/`
  directory returned a 404 (likely a stale/wrong path on the default branch, not
  necessarily an absence of source; I did not retry with a corrected path given time
  constraints). **[unverified]**: I am not able to confirm a documented reproducible-build
  path for these two candidates from what I fetched.
- **`argon2-browser`** is effectively unmaintained (§1) and I did not pursue its build
  story further, since staleness alone is enough to deprioritize it regardless of
  auditability.

**No candidate lets a reviewer do what ADR-0003 Layer 1 does for `crypto.js` today: read
every shipped byte against the audited source directly.** The best available substitute is
"trust a well-known, externally audited upstream, plus a reproducible compile step, plus
the existing SHA-384 integrity manifest for tamper-evidence" — which is a materially
weaker claim than what the rest of the client can make, and that gap does not close no
matter which package is chosen.

## 7. Recommendation (mine, clearly labeled — the owner should weigh this, not defer to it)

**Do not adopt Argon2id yet; keep it tracked and re-scope PBKDF2-iteration-raising as the
cheap interim step, if any change ships at all before #100 is properly resourced.**

Reasoning, laid out so it can be individually disputed:

1. **Every credible Argon2id path requires WASM** (§2) — there is no way to get the
   claimed benefit without paying the CSP/auditability cost from §3/§6. That cost is
   confirmed real (the spec is unambiguous, §3) and not avoidable by implementation choice
   (streaming vs. inline, which package). If the owner is unwilling to accept *any*
   auditability trade for *any* implementation, the decision is already made and the rest
   of this document is moot — say so and close #100 as "not planned" rather than leave it
   open against a tradeoff that's been rejected in principle.
2. **The gap Argon2id closes is specifically "weak/reused password against an attacker
   with GPU/ASIC hardware and the offline vault file"** (`docs/threat-model.md` §1). That
   is a real, named adversary. But it is worth weighing against what's already true today:
   PBKDF2 is already at OWASP's recommended floor (600k, not below it, §4), the recovery
   code is already immune to brute force regardless of KDF (120 bits, §threat-model), and
   [ADR-0003](../adr/0003-client-integrity-and-anti-phishing.md) Layer 3 (passkeys, #113,
   foundation already merged per #189) addresses the arguably *more common* real-world
   failure mode for this kind of app — a person choosing a memorable-but-guessable
   password — by removing the password from the equation for users who opt in, rather than
   making brute force marginally more expensive for users who don't.
3. **This research could not obtain a trustworthy mobile-specific timing/OOM number**
   (§4) — and the one comparably-situated real product's experience I could find
   (Bitwarden) suggests naive parameter choices (parallelism > 1) don't behave the way
   the spec's parameters suggest inside a browser WASM sandbox, and that 64 MiB is already
   treated as a real ceiling by a team with much more operational data than this research
   produced. Shipping Argon2id without that number in hand risks exactly the "OOM on a
   cheap Android = data loss" failure the brief was worried about.
4. **If a change ships now anyway**, raising `DEFAULT_ITERATIONS` (§5) is available today
   at zero new dependencies, zero CSP change, and is already compatible with the per-entry
   KDF/version-gate machinery #188/ADR-0008 built specifically to allow lazy, mixed-KDF
   upgrades. It is a strictly smaller, reversible, better-understood step, even though it
   does not fix PBKDF2's structural GPU-parallelism weakness (§5) — it buys real, linear,
   cheap protection while #100 stays open for the structural fix.
5. **If/when Argon2id is adopted**, `libsodium-wrappers-sumo` is the strongest candidate
   on the evidence gathered: most recently active (§1), zero open issues, ISC-licensed,
   wraps a widely audited upstream with a scripted (if not independently re-verified by
   this research) build path (§6) — at OWASP's `m=19456 KiB, t=2, p=1` (§4), not
   Bitwarden's heavier default, given the mobile-memory caution in §4. That recommendation
   is conditional on someone actually running a real low-end-Android benchmark first,
   which this research did not and could not produce.

## Summary: answers to the brief's specific questions

1. **Candidates**: `argon2-browser` (stale, avoid), `hash-wasm` (best perf/size
   trade-off, moderately stale), `libsodium-wrappers-sumo` (most audited/maintained,
   larger), `argon2id`/openpgpjs (smallest, least maintained), `@noble/hashes` (no Argon2
   support at all — ruled out, not a candidate).
2. **Pure-JS viable?** No — confirmed non-viable by the one team that tried and documented
   abandoning it, corroborated by a second team shipping both a JS and a WASM variant of
   the same algorithm.
3. **Does WASM need `wasm-unsafe-eval`?** Yes, unconditionally, confirmed against the CSP
   spec itself and MDN — no code-shape avoids it.
4. **Parameters/mobile cost**: OWASP recommends `m=19456 KiB, t=2, p=1` for interactive
   use; a real comparable product treats 64 MiB and `p=1` (sequential-lane WASM execution)
   as practical mobile ceilings; **no reliable mobile-specific timing number was found**,
   flagged honestly rather than estimated.
5. **Argon2id vs. PBKDF2-600k, and raising iterations**: Argon2id is structurally stronger
   against GPU/ASIC attackers via memory-hardness; raising PBKDF2 iterations is a real but
   purely linear, structurally-unfixed improvement, available today with no new dependency
   or CSP change.
6. **Auditability**: no candidate closes the "reviewer can't read wasm bytes" gap; the
   best available substitute is a well-audited upstream (libsodium) plus a scripted build
   plus the existing SHA-384 integrity manifest — a materially weaker claim than the rest
   of the client can make.
7. **Recommendation**: don't adopt yet; the cheap, reversible interim step is raising
   PBKDF2 iterations; if/when Argon2id ships, prefer `libsodium-wrappers-sumo` at OWASP's
   lighter interactive parameters, gated on an actual low-end-mobile benchmark this
   research did not produce.
