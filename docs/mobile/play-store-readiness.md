# Play Store readiness (internal-testing preview -> production)

Working brief for #148/#149. Status: **preliminary** — researched 2026-07-01 from official
help pages (multi-agent research; the adversarial verification pass + the health-policy topic
are still pending, see "Open items"). Load-bearing claims cite their source.

## The plan in one paragraph

Register a Play Console **organization** account under **Zoignon Studio LLC**, launch a private
preview on the **internal testing** track (no review, live in minutes, up to 100 invited testers,
no Data Safety form or full store listing required while internal-only), then complete the full
app-content gate (listing, content rating, Data Safety, privacy policy) when promoting to closed
testing / production. As an organization account there is **no 12-tester/14-day closed-testing
quota** blocking production. The schedule is dominated by one item: the **D-U-N-S number**.

## 1. Account setup (Zoignon Studio LLC), start the D-U-N-S first

- [ ] **D-U-N-S number** (mandatory for org accounts; a CA LLC cannot skip it). Free via D&B,
      **up to 30 days**; paid expedite exists (~$229, ~8 business days, confirm on dnb.com).
      First check whether the LLC already has one (D&B free lookup).
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
- **Realistic lead time: 1-5 weeks, dominated by D-U-N-S.**

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
- [ ] **Privacy policy URL** (wymber.app/privacy exists)
- [ ] Target audience declaration; app review happens here
- Org account => no 12/14 quota (that rule is scoped to personal accounts created after
  2023-11-13; tester minimum dropped 20 -> 12 on 2024-12-11). [answer/14151465]

## 4. Target API level

- Current requirement: target **API 35+** (mandatory since 2025-08-31).
- From **2026-08-31**: target **API 36** for new apps/updates. **We already target 36** (Capacitor
  8 default), so no action, just don't regress. [answer/11926878]

## Open items (pending verification / research)

- The **org-exemption from the 12/14 rule** is stated by scoping on Google's page + third-party
  corroboration; no official sentence says "organizations are exempt." Confidence high, not absolute.
- **Health Content & Services policy / health-apps declaration**: research incomplete (rate-limited).
  Must confirm whether a self-help wellness journal needs the health declaration, and what the
  medical-disclaimer expectations are. The in-app "not therapy or a crisis service" framing likely
  helps; verify against the current policy text.
- Adversarial verification of all load-bearing claims above (workflow resumes with cached research).
