# Wymber mobile, roadmap

The plan of record for the Android and iOS apps. The architecture decision lives in
[ADR-0005](../adr/0005-mobile-native-shell-single-web-core.md): a **native shell (Capacitor)
over the single web core**, in a `mobile/` directory of this monorepo. This doc is the
human-readable mirror of the GitHub milestone, epic, and issues.

## Milestone

All of this lands under one phase-level milestone, matching how the repo already tracks phases
(M0 Foundations, M1 MVP, M2 Sync, M3 Mobile, Backlog):

- **M3 — Mobile (Android, then iOS).** *Corrected description:* "Installable Android and (later)
  iOS apps via a Capacitor native shell over the existing web core ([[ADR-0005]]). Android first.
  Shares the vault, not a sync layer." (The old description said "sharing the sync layer," stale
  since [ADR-0001](../adr/0001-local-first-encrypted-file.md) made the data local and sync the
  future paid layer.)

> Sync is **not** tracked here. It is the paid monetization layer, built in its own private repo
> **WymberSync** (teased as "coming soon" on the site). Mobile shares the vault and does not
> depend on sync. When a stale "+ sync" reference is dropped from a mobile issue, the concept
> moves there, it is not deleted.

## Epic

- **#56 — Epic: Mobile apps (Capacitor, native shell + single web core).** Re-based onto
  ADR-0005, the umbrella that tracks the workstreams below.

## Workstreams

Existing issues are re-framed onto ADR-0005, new ones fill the gaps the local-first pivot opened
(durable native storage, biometric unlock, export/backup, store readiness, crypto parity).

Existing issues (#11/#53/#54/#55) are re-framed onto ADR-0005; the rest are new. All sit under
epic **#56**, in milestone **M3** (passkeys in Backlog).

| Issue | Workstream | State | Labels | Pri | Gist |
|---|---|---|---|---|---|
| **#11** | Mobile stack decision | reframed | `area:mobile` | P1 | Decided: Capacitor. Closes when ADR-0005 is Accepted. |
| **#53** | Capacitor foundation (Android) | reframed | `area:mobile` `type:infra` | P1 | `mobile/` project, `webDir -> ../frontend`, Android build runs the vault round-trip on a real device. "+ sync" dropped (moves to the private WymberSync repo). |
| **#145** | Durable native persistence | new | `area:mobile` `type:feature` | P1 | Native backend behind `VaultPersistence` (app-private file + keystore). Kills the OPFS 10 MB cap + eviction risk. Only ciphertext crosses the seam. |
| **#146** | Biometric / passcode unlock | new | `area:mobile` `type:security` | P2 | Wrap the DEK under a Keychain / Android Keystore key, Face ID / fingerprint gate. Local, zero-knowledge. |
| **#54** | Mobile chrome + a11y | reframed | `area:mobile` `type:a11y` | P1 | Splash, status bar, safe areas, themes, reduced-motion, and a VoiceOver / TalkBack pass on the `#map-outline` twin ([[ADR-0004]]). |
| **#147** | Data portability + backup nudge | new | `area:mobile` `type:feature` | P1 | Native export/import (Files, share sheet) + a "back up your vault" prompt. Mobile's delete-app-loses-data caveat. |
| **#148** | Mobile CI/CD + signing | new | `area:mobile` `type:infra` | P2 | Signing keys, fastlane, GitHub Actions build/release lanes (Play internal, TestFlight). Path-filtered so it never fires on web-only changes. |
| **#149** | Store readiness | new | `area:mobile` `type:design` | P1 | Play Data Safety + Apple privacy labels (honest "no data collected"), Guideline 4.2 compliance, mental-health age rating, listings, screenshots. |
| **#150** | Cross-platform crypto parity | new | `area:mobile` `type:security` | P1 | A vault sealed on web must unlock on device and vice versa. A security-parity test, not a nicety. |
| **#55** | iOS parity + App Store | reframed | `area:mobile` `type:feature` | P2 | Same Capacitor project, iOS target, TestFlight, App Store submission. |
| **#151** | Passkeys on mobile | new (Backlog) | `area:mobile` `type:feature` | P3 | Platform Credential Manager / iOS as the high-trust, anti-phishing unlock ([[ADR-0003]]). Lands after the foundation. |

## Phasing

1. **Foundation (Android):** #11 resolved, #53 reframed. Shell wraps `frontend/`, vault round-trips
   on a device, with #145 landing alongside so we never bet data on WebView storage.
2. **Make it feel native:** biometric unlock (#146), mobile chrome + a11y (#54), export/backup (#147).
3. **Ship Android:** CI/signing (#148), store readiness (#149), crypto parity (#150). Play internal
   -> closed -> production.
4. **iOS parity:** #55, same codebase, TestFlight -> App Store.
5. **Later:** passkeys (#151), and Argon2id ([[ADR-0001]]) ride along naturally.
