# ADR-0005: Mobile delivery, a native shell over the single web core

- Status: Proposed (2026-06-14)
- Decider: [@tamok](https://github.com/tamok)

## Context

Wymber should ship as installable Android and (later) iOS apps. The instinct is "make it
as native as possible." But [[ADR-0001]] put the *entire* product, the vault crypto, the
document model, the graph, the unlock flow, in the client, with no server and no second
implementation anywhere. That reframes the mobile question. "Native" is not one decision, it
is a spectrum from "load wymber.app in a browser tab" to "rewrite everything in Kotlin and
Swift," and the right point on it is fixed by one constraint: the crypto in `crypto.js`
(envelope encryption, PBKDF2-600k, AES-256-GCM, recovery codes, the versioned vault format and
its migrations) is the thing users trust, and it must stay a *single audited implementation*.
Three copies of the vault crypto (web, Kotlin, Swift) is three audit surfaces and three chances
for a silent GCM/nonce/KDF bug that weakens encryption or corrupts a vault. The AGPL "auditable"
claim gets weaker, not stronger, the more we duplicate it.

This ADR resolves #11 (the open "which mobile stack" decision) and re-bases the mobile epic #56,
written before [[ADR-0001]], onto the local-first architecture. The old framing ("Android app
sharing the sync layer") is stale: the data is local, and sync is the future *paid* layer, opt-in
and post-MVP, built in its own private repo (**WymberSync**), already teased as "coming soon" on
the site. Mobile shares the **web core and the vault**, not a sync layer, and does not depend on
sync to ship.

## Decision

### Native shell, single web core (not a full rewrite, not a bare wrapper)

We ship the existing `frontend/` unchanged inside a native app via **Capacitor**. The WebView
runs our exact JS: same crypto, same vault-store, same Cytoscape graph, same `#map-outline` twin
([[ADR-0004]]). The native budget is spent only where native genuinely beats web: durable
storage, biometric unlock, passkeys, share/export, app-store distribution. This buys ~90% of
"feels native" while the trust core stays single-source.

Capacitor over the alternatives: a Trusted Web Activity is Android-only and runs the site in the
user's Chrome (no native unlock, vault stranded in browser storage). Tauri 2 mobile is promising
but its own team says mobile is not yet first-class, too much risk for a sensitive-data app in
App Review. A full native rewrite is the duplication trap above. Capacitor is the mature
web-to-both-stores path, and it is happy with our no-build, vanilla-ES-module `frontend/` (its
`webDir` points straight at it).

### The one architectural change: native owns the sealed vault at rest

[[ADR-0001]] persists only ciphertext, today via OPFS with an IndexedDB fallback
(`persistence.js`). Inside a mobile WebView that storage is *not* trustworthy as the system of
record: WKWebView caps each OPFS file at 10 MB (our vault is one blob),
`navigator.storage.persist()` is weak on iOS, and the OS may reclaim WebView storage under disk
pressure, while some Android WebView builds restrict OPFS outright. So on native platforms,
`VaultPersistence` gains a native backend: it writes the sealed blob to app-private native
storage (Capacitor Filesystem, key material behind iOS Keychain / Android Keystore) instead of
OPFS. The WebView still does 100% of the crypto, native only holds the opaque result. This is a
clean extension of the existing load/save/clear seam, and only ciphertext crosses it, so
zero-knowledge holds.

### Native unlock (the payoff, and it advances ADR-0003)

Biometric / device-passcode unlock: wrap the DEK under a key held in the Secure Enclave /
Android Keystore, gated by Face ID or fingerprint. Still local, still zero-knowledge, far gentler
than retyping a password each session. Passkeys via the platform Credential Manager / iOS land
naturally here and are exactly the high-trust, anti-phishing anchor [[ADR-0003]] names; a signed
store listing is itself a stronger "is this the real client" signal than a URL.

### Store posture (a feature, if we don't break it)

Wymber is not a bare web view (offline local data, an unlock flow, native biometrics and share),
so it clears Apple's Guideline 4.2 "minimum functionality" bar that sinks thin wrappers. "No
account, no telemetry, nothing leaves the device" is the easy-mode answer to both stores'
health-data scrutiny and privacy labels, *provided* we add no analytics/crash SDK that quietly
makes it untrue. One trauma-informed caveat to design for: on mobile, delete-the-app means the
vault is gone, and OS cloud backup of app-private data is unreliable, so the recovery-code +
native export ("back up your vault") story matters *more* here, not less.

### Repo layout: monorepo

The mobile shell lives in `mobile/` inside this repo, not a separate one. Capacitor's `webDir`
points at `../frontend`, so shell and web core move atomically with zero sync ritual, and the
`VaultPersistence` native backend sits next to the code it extends. A separate repo would need a
git-subtree of `frontend/` and a standing drift risk aimed straight at the single-core promise.
(For a two-person team the daily sync tax outweighs toolchain isolation.)

## Consequences

- Mobile is one Capacitor project targeting both platforms, never one repo per OS.
- `VaultPersistence` becomes platform-aware (web: OPFS/IDB, native: app-private file + keystore).
  Crypto and vault-store stay untouched and single-source.
- "Definition of done" for a mobile feature includes its `#map-outline` behaviour on
  VoiceOver/TalkBack ([[ADR-0004]] carries onto mobile).
- New cross-platform test surface: the same vault must round-trip web <-> device (a
  security-parity check, not a nicety).
- Sync stays optional/post-MVP (the paid layer, built in its own private **WymberSync** repo,
  [[ADR-0001]]), mobile does not depend on it.
- #11 is resolved by this ADR, epic #56 and its children are re-based onto this decision
  (see [the mobile roadmap](../mobile/roadmap.md)).

## Alternatives considered

- **Full native (Kotlin + Swift):** maximal "native feel," but triples the vault-crypto audit
  surface and the whole UX build for a two-person alpha. The privacy claim *is* the product,
  duplicating its core weakens it. Rejected.
- **Trusted Web Activity (Android):** cheapest, but Android-only, no native unlock, vault tied to
  the user's Chrome storage. A demand-test at best. Rejected as the foundation.
- **Tauri 2 mobile:** single core like Capacitor and lighter, but mobile is explicitly not yet
  first-class and fewer plugins are ported. Revisit when it matures. Rejected for now.
- **Trust WebView OPFS/IndexedDB as the system of record:** simplest, but the 10 MB WKWebView
  cap, weak iOS `persist()`, and eviction under pressure make it unsafe for the one file we
  cannot lose. Rejected in favour of native-owned storage.
- **Separate mobile repo:** cleaner toolchain isolation, but a standing frontend-drift risk
  against the single-core promise. Rejected for monorepo.
