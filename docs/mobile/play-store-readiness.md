# Play Store readiness (internal-testing preview -> production)

Working brief for #148/#149. Status: **preliminary** — researched 2026-07-01 from official
help pages (multi-agent research; the adversarial verification pass + the health-policy topic
are still pending, see "Open items"). Load-bearing claims cite their source.

> **Companion documents (added 2026-08-09):**
> [`egress-audit.md`](egress-audit.md) is the evidence base for the Data Safety declaration: a
> file-and-line audit of every way bytes can leave the device in the Android build, including the
> definitive `allowBackup` answer. [`play-console-answers.md`](play-console-answers.md) turns that
> audit into pre-drafted console answers, and flags the questions that need an owner decision
> (notably the target-audience/age field, §3 below) or a live policy check before filing.

## The plan in one paragraph

Register a Play Console **organization** account under **Zoignon Studio LLC**, launch a private
preview on the **internal testing** track (no review, live in minutes, up to 100 invited testers,
no Data Safety form or full store listing required while internal-only), then complete the full
app-content gate (listing, content rating, Data Safety, privacy policy) when promoting to closed
testing / production. As an organization account there is **no 12-tester/14-day closed-testing
quota** blocking production. The schedule is dominated by one item: the **D-U-N-S number**.

## 1. Account setup (Zoignon Studio LLC), start the D-U-N-S first

- [x] **D-U-N-S number: obtained** (owner-provided 2026-07-03: 124827854). The former 30-day
      long pole is gone; the account can be registered as soon as the address check below passes.
      [support.google.com/googleplay/android-developer/answer/13628312]
- [ ] **Address consistency**: D&B record, Google payments profile, and state registration must
      all show the **current Bakersfield address** (not the old Clovis one). Google re-checks and
      restricts on mismatch.
- [ ] **Organization-type Google Payments profile** in the exact legal name (org name/address are
      pulled from it).
- [ ] **Register the Play Console org account**: $25 one-time; needs org website (zoignon.com),
      org email + phone, and a developer email + **developer phone (shown publicly)**; all
      OTP-verified and must stay operational. Website verification required.
      [answer/10841920]
- [ ] **Identity verification**: person's government ID + possibly an official org document;
      payment-method verification up to 5 days; budget 1-2 weeks after D-U-N-S exists.
- **Realistic lead time (updated): ~1-2 weeks** — D-U-N-S already in hand; remaining time is the
  D&B address check + Google identity/payment verification.
- **applicationId locked (owner decision 2026-07-03): `app.wymber`** — brand-rooted (reverse of
  wymber.app), becomes permanent at first Play upload.

## 2. Internal-testing preview (the "private preview")

- [ ] Signed **release AAB** with the upload key (done: `.secrets/android/wymber-upload.keystore`,
      Play App Signing holds the distribution key).
- [ ] Create internal testing release, upload AAB.
- [ ] Tester email list (<=100), share the **opt-in URL** (only works after the release publishes;
      the app is not searchable on Play).
- Facts: internal releases are "not subject to the usual Play policy or security reviews"; live
  within minutes (first publish may show temporary app info up to 48h); internal-only apps are
  **exempt from the Data safety section**; a complete store listing is not required yet.
  [answer/9845334, answer/10787469]

## 3. Full gate (first closed test / production), plan, don't block on it

- [ ] Store listing (name, descriptions, screenshots, feature graphic)
- [ ] **Content rating questionnaire** (mental-health themes, crisis links)
- [ ] **Data Safety form** ("collects no data" — still must be filled deliberately)
- **INTERNET permission, pre-answered**: the manifest declares `android.permission.INTERNET`
  because the Capacitor WebView bridge requires it to serve the app shell locally; there is no
  network egress — the vault never leaves the device.
- [ ] **Privacy policy URL** (wymber.app/privacy exists)
- [ ] Target audience declaration; app review happens here
- Org account => no 12/14 quota (that rule is scoped to personal accounts created after
  2023-11-13; tester minimum dropped 20 -> 12 on 2024-12-11). [answer/14151465]

## 4. Target API level

- Current requirement: target **API 35+** (mandatory since 2025-08-31).
- From **2026-08-31**: target **API 36** for new apps/updates. **We already target 36** (Capacitor
  8 default), so no action, just don't regress. [answer/11926878]

## 5. Health-app policy (researched 2026-07-02, official policy pages)

- **The Health apps declaration is mandatory for ALL apps** (since 2024-08-31, testing tracks
  included). Wymber has health features, so it cannot pick "no health features". **Declare under
  Health and Fitness → "Stress Management, Relaxation, Mental Acuity"**, NOT Medical ("Mental and
  Behavioral Health" is for counseling/treatment tools, which Wymber deliberately is not). Selecting
  a Medical category also triggers org-account enforcement; irrelevant if we stay Health & Fitness,
  and we are an org account anyway. An inaccurate declaration blocks releases. [answer/14738291]
- **Listing disclaimer, verbatim requirement**: non-medical-device health apps must state in the
  description that the app is "not a medical device and does not diagnose, treat, cure, or prevent
  any medical condition". [answer/16679511]
- **Consult-a-professional reminder** required in-app and/or listing — aligns with the existing
  "not therapy or a crisis service" bar; make it explicit. [answer/16679511]
- **Privacy policy required despite zero collection** (User Data policy), in the Play field AND
  in-app, public non-PDF URL, with contact info + data-handling + retention/deletion. Health apps
  must additionally address how sensitive content is handled — ours should say plainly: encrypted
  on-device, never transmitted, deleted by deleting the app or "Delete everything".
  [answer/10144311, answer/16679511]
- **Data safety = honestly "No data collected"**: locally processed data that never leaves the
  device is not "collection" by Google's definition. Form still mandatory (from first closed test).
  [answer/10787469]
- **WymberSync note (monetization)**: Google exempts end-to-end-encrypted transfers unreadable by
  the developer from "collection" — a ciphertext-only zero-knowledge sync can preserve the
  "No data collected" label. Carry this constraint into WymberSync's design. [answer/10787469]
- **Content rating (IARC)**: mandatory; the questionnaire has no mental-health/journaling item, and
  crisis-line links do not raise the rating. Expect Everyone. [answer/9859655, 6209544]
- April 2026 policy round: nothing material for a no-permission, no-collection app. [answer/16926792]

## Open items (pending verification)

- The **org-exemption from the 12/14 rule** is stated by scoping on Google's page + third-party
  corroboration; no official sentence says "organizations are exempt." Confidence high, not absolute.
- Adversarial verification of the load-bearing claims (research is cached in the workflow; the
  verify + synthesis passes keep hitting session limits and can re-run anytime).
