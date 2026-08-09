# Compliance posture

> **Not legal advice.** This is an engineering description of Wymber's current posture, written
> for general orientation only. It leans heavily on
> [`docs/research/2026-05-30-trauma-dbt-brand-research.md`](research/2026-05-30-trauma-dbt-brand-research.md)
> (§3 Safety, ethics & risk; §4 Regulatory landscape), an internal research document that is
> itself explicit that it is decision-support, not professional/legal advice, has a January 2026
> knowledge cutoff, and states that its live regulatory items were web-checked in May 2026 but
> **still need primary-source verification.** Nothing below has been reviewed by a lawyer.
> Counsel should review this posture before any public launch of a paid tier, and especially
> before the paid cloud-sync tier described in §7 ships.

Every regulatory statement here is attributed to that research document and flagged as needing
primary-source verification. Where this document states what the code does today, that is a
direct claim, checkable against the cited source file.

See also [`docs/threat-model.md`](threat-model.md) for the adversary-by-adversary security
analysis this document does not repeat, [`docs/CONTENT-GUIDELINES.md`](CONTENT-GUIDELINES.md) for
the claims discipline referenced throughout, [ADR-0001](adr/0001-local-first-encrypted-file.md)
for the data model, [ADR-0003](adr/0003-client-integrity-and-anti-phishing.md) for the
client-integrity honesty register this document tries to match, and
[ADR-0006](adr/0006-optional-recovery-tradeoffs.md) for the recovery-key tradeoffs behind the
zero-knowledge guarantee this document relies on throughout.

## 1. Wellness, not a medical device

Wymber is positioned as a private, self-directed wellness and reflection tool, not therapy, a
diagnostic instrument, or a crisis service. That positioning is a product decision with a
regulatory consequence, and both halves matter.

**What keeps it true operationally:**

- **Claims discipline.** [`docs/CONTENT-GUIDELINES.md`](CONTENT-GUIDELINES.md) is binding for all
  user-facing copy (app UI, marketing, store listings, social, support replies) and explicitly
  bans affirmative medical/efficacy language ("treats," "cures," "clinically proven treatment,"
  "diagnose," "reduces symptoms," and similar).
- **A persistent, non-therapy disclaimer ships in the product**, not buried in a policy page. The
  exact wording in the app's safety bar (`frontend/index.html`): *"A private wellness and
  reflection tool, not therapy or a crisis service."* The crisis-support modal adds: *"Wymber
  can't contact anyone for you. These are external services you reach out to directly."*
- **No diagnosis, assessment, or scoring feature exists in the product.** The node types
  (`frontend/js/config.js`) are descriptive categories (event, emotion, body, person, place,
  trigger, coping, support, need, insight, growth) with gentle, non-directive prompts, not a
  clinical instrument. There is no symptom score, severity index, or automated interpretation of
  a user's map anywhere in the codebase.
- **Crisis resources are present and work offline.** 988 (call/text), 911, and the Crisis Text
  Line (`sms:741741`, body `HOME`) are hard-coded in `frontend/index.html` and precached by the
  service worker; one external link to findahelpline.com is labelled in the UI as needing
  internet.
- **No AI/LLM feature exists today.** Should an "Explore" or similar AI-assisted feature ever
  ship, the research document's §3.5 guardrails (non-negotiable in the research doc's own
  framing) would be a pre-condition, not a nice-to-have: no directive interpretation of trauma, no
  therapy role-play, crisis-aware de-escalation, non-human transparency, no data egress by
  architecture, default off, and no optimizing for engagement. None of this is built; it is noted
  here only as a stated precondition on future work.

**General regulatory orientation** (attributed to the research doc §4.1, needs primary-source
verification): a product becomes a regulated medical device when it is *intended to* diagnose,
treat, cure, mitigate, or prevent a condition. General-wellness tools that make no disease claims
generally stay outside active device oversight. The research doc notes EU MDR is stricter (CE
marking attaches to medical *purpose*), without this document attempting to analyse that
framework. This is general orientation only, not a legal conclusion that Wymber is or is not a
regulated device in any jurisdiction.

## 2. No ads, no third-party analytics, no data sale

This is the strongest section here because it is the most directly verifiable.

- **No third-party network requests exist anywhere** in `frontend/` or `landing/`: no analytics
  scripts, no CDN-hosted trackers, no remote web fonts, no beacons, no tag managers.
- **No telemetry, crash reporting, or error reporting exists** anywhere in the codebase or CI (no
  Sentry, Crashlytics, Bugsnag, or equivalent).
- **No ads and no third-party SDKs exist**, and there is structurally no mechanism for any of
  this to appear quietly. `backend/main.py` exposes only `/api/health`, `/sw.js`,
  `/manifest.webmanifest`, `/robots.txt`, `/.well-known/security.txt`, `/`, and a `/static`
  mount. **No endpoint accepts or returns user data.**

The distinction worth stating plainly: this is not merely a policy against sending data, it is
that there is currently nowhere for data to go. A compromised build could still change that (see
§4 and the threat model's adversary 4), but the shipped architecture today has no data-collection
surface to misuse.

Because Wymber is AGPL-3.0 and the source is public, this claim is auditable rather than a
promise taken on faith: anyone can read `backend/main.py`, `frontend/`, and `landing/` and check
it themselves.

## 3. Health-data breach posture

**General orientation** (attributed to the research doc §4.2, needs primary-source verification):
the research doc states that the FTC Health Breach Notification Rule was updated in 2024 and is
understood to cover consumer health apps, and that a consumer self-help app with no
covered-entity relationship to a HIPAA-regulated party is generally outside HIPAA. Both points are
general descriptions from a secondary source and need primary-source verification before being
relied on. The research doc also names two FTC enforcement matters involving health apps sharing
consumer health data (GoodRx and BetterHelp, with specific figures in the research doc); this
document does not restate those figures here because they cannot be independently re-verified
within this task's scope, and any reader who needs them should go to the research doc's §4.2 and
then confirm against the FTC's own record, not treat the research doc's numbers as final.

**What "a breach" would even mean here.** This is the more interesting question for a product
that structurally holds nothing. The classic breach scenario, an attacker exfiltrates a
centralized user database, has no target: there is no user database (`backend/main.py`, no
accounts, no server-side vault storage; see [ADR-0001](adr/0001-local-first-encrypted-file.md)).
The realistic analogues today are not data breaches in the conventional sense but **code-integrity
incidents**: a compromised client bundle, or a compromised release, serving JavaScript that
captures a password, recovery code, or decrypted map at the moment of unlock. The threat model's
[adversary 4](threat-model.md#4-a-hostile-host-cdn-or-supply-chain-compromise-of-the-served-bundle)
covers this in depth; it is not re-derived here.

A plain incident-response posture, stated honestly as intent rather than an audited program:

- Vulnerability and incident contacts are published in `landing/.well-known/security.txt`:
  `mailto:jonathan@wymber.app` and a GitHub Security Advisory intake
  (`https://github.com/Tamok/wymber/security/advisories/new`).
- Because the code is public, a commitment to disclose a code-integrity incident publicly (via the
  repository, a security advisory, or the site) is a natural fit for this project's existing
  transparency posture.
- **This is a stated intent, not an audited or exercised incident-response program.** There is no
  formal runbook today (see the gaps register, §9).

## 4. Age considerations

**No age gate, age declaration, or minimum-age statement exists** anywhere in the app, the landing
site, or this repository's documentation today. This is stated as a fact about the code, verified
by search, not as a legal judgment about whether one is required.

The research doc's safe-side checklist (at the end of its §4, listed alongside CCPA/CPRA) flags age
gating in a 13-16 range as a consideration for a product handling this kind of content. This document does
not adopt a specific age threshold as a requirement: that is exactly the kind of determination
that needs counsel, and asserting a number here without legal review would be worse than leaving
it open. This is flagged as an **open gap** to resolve before any paid tier or app-store
distribution that could trigger store-level age-rating or child-directed-service obligations, not
as a settled requirement.

## 5. GDPR / UK GDPR

**General orientation** (attributed to the research doc §4.3, needs primary-source verification):
the research doc describes mental-health content as special-category data under an Article 9-style
framing, attracting a higher consent standard than ordinary personal data, and notes that GDPR-type
obligations can apply based on the location of the people affected, not the location of the
company. This document does not quote article text or assert a specific legal conclusion from it.

**Where this project sits today:** with no accounts and no sync, the app itself processes
essentially no personal data. The one place personal data touches this project at all is that
Cloudflare, as the hosting/CDN provider, transiently processes request metadata (for example IP
addresses) to serve the static site and protect it from abuse, exactly as `landing/privacy.html`
already discloses.

The research doc is explicit, and this document agrees as a matter of architecture: **local-first
shrinks the surface for these obligations, and the paid cloud-sync tier (unbuilt today) is where
real obligations would attach**, even with zero-knowledge encryption. See §7.

## 6. CCPA/CPRA

**General orientation** (attributed to the research doc's safe-side checklist at the end of its §4,
needs primary-source verification): California's privacy framework is named alongside GDPR as a
consideration for a product handling sensitive personal content, particularly once there are
accounts or a paid tier. This document does not enumerate specific statutory consumer rights here,
since doing so accurately requires legal review this document is not positioned to substitute for.
As with age gating, this is a flagged consideration for later, not a present-tense compliance
claim.

## 7. Where real obligations begin: the paid sync tier

This is the clearest section in this document, precisely because the tier it describes does not
exist yet.

**Today:** no sync implementation exists. `backend/main.py`'s docstring notes only that a future
zero-knowledge sync endpoint "would live" there; `landing/cloud-sync.html` already tells users, in
the present tense, that live sync is "not yet" available. Today, "cloud backup" means a user
manually exporting a `.wymber` file (ciphertext) and storing it themselves.

**When sync ships, as designed in [ADR-0001](adr/0001-local-first-encrypted-file.md)** (see its
"Sync (post-MVP)" section), it is meant to be a zero-knowledge blob store: the server would hold only the same sealed
ciphertext already on-device, and would never hold or see a key. Per the research doc §4.4
(attributed, needs primary-source verification): **zero-knowledge encryption reduces obligations,
it does not erase them.** The moment there are accounts, new categories of data come into
existence that don't exist today: account metadata, billing data, and IP addresses/timestamps
associated with sync activity. Honoring data-subject rights, providing a data-processing notice,
having a breach-notification plan, and handling special-category consent under an Article 9-style
framing would all become real obligations at that point, not aspirational ones.

**This is the point where counsel is required**, not general orientation from an internal research
document. Nothing in this document, or in the research document it draws from, substitutes for
that review, and this project does not intend to treat it as though it does.

## 8. US state AI-chatbot laws / any future AI feature

**No AI/LLM feature exists anywhere in the codebase today.** Everything in this section is future
tense and describes what would need to be true before anything in this space could ship, not a
plan with a date attached.

**General orientation** (attributed to the research doc §3.5 and §4.1, needs primary-source
verification): the research doc describes new state-level attention to AI mental-health chatbots
emerging in the 2025-2026 period, in the context of documented safety failures in AI mental-health
products generally. This document does not name a specific statute, jurisdiction, or effective
date beyond what appears verbatim in the research doc, because none is verified to that standard
here.

What is concrete: the research doc frames its §3.5 AI guardrails as non-negotiable preconditions
on any future "Explore" or similar feature, specifically no directive interpretation of trauma, no
therapy role-play, crisis-aware de-escalation behavior, non-human transparency, no data egress by
architecture, default-off, and no engagement optimization. If Wymber ever ships an AI-assisted
feature, those guardrails, and a legal review of the regulatory landscape at that time (which will
have moved past this document's information), are both preconditions, not follow-up items.

## 9. Gaps register

An honest list of what is missing today. This section is the point of the document, not an
afterthought.

| Gap | Why it matters / when it becomes urgent |
|---|---|
| No Terms of Service document | Currently absent from the repository entirely. Becomes more pressing the moment there is a paid tier or an account relationship of any kind (§7). |
| No age gate or age declaration | Currently absent everywhere in the app/site. An open question needing counsel, more urgent before app-store distribution or any paid tier (§4). |
| No strict CSP, no Subresource Integrity | Only baseline headers ship today (`X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, a restrictive `Permissions-Policy`); no `connect-src 'self'`, no SRI, no `Integrity-Policy`. This is a code-integrity gap (threat model adversary 4, [ADR-0003](adr/0003-client-integrity-and-anti-phishing.md) Layer 1), directly relevant to §3's breach discussion. |
| No formal DPA / processor documentation | There is no data-processing agreement or processor inventory today because there is effectively no personal data processed by the app. Becomes necessary the moment accounts or sync exist (§7). |
| No external security audit | Not done today. Worth doing before charging for a sync tier that would, for the first time, centralize encrypted vaults and hold account/billing metadata. This is an open recommendation, not a scheduled plan. |
| No formal incident-response runbook | Contacts exist (`security.txt`) and public disclosure is the stated intent (§3), but there is no written runbook, no defined severity levels, and no exercised process. |

## 10. Cross-references

- [`docs/threat-model.md`](threat-model.md): the adversary-by-adversary security analysis; this
  document defers to it rather than repeating it, especially for the client-integrity and
  supply-chain material referenced in §3.
- [`docs/CONTENT-GUIDELINES.md`](CONTENT-GUIDELINES.md): the binding claims discipline behind §1.
- [ADR-0001](adr/0001-local-first-encrypted-file.md): the local-first encrypted-vault data model,
  and its "Sync (post-MVP)" section referenced in §7.
- [ADR-0003](adr/0003-client-integrity-and-anti-phishing.md): the client-integrity and
  anti-phishing honesty register this document tries to match in tone.
- [ADR-0006](adr/0006-optional-recovery-tradeoffs.md): the recovery-key design tradeoffs, relevant
  to how the zero-knowledge guarantee referenced throughout this document is actually held.
