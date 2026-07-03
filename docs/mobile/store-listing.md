# Play Store listing — copy + declaration answers (#149)

Draft for the first submission. The two *italicized disclaimer lines are policy-mandated*
(Health Content & Services, see [play-store-readiness.md](play-store-readiness.md)) — keep them
verbatim through edits. Tone rules: gentle, no pressure, no clinical overclaiming; the alpha
tagline stays.

## App title (30 chars max)

> **Wymber: Private Trauma Mapping**

(exactly 30 characters)

## Short description (80 chars max)

> **A private, encrypted place to map what you've been through. No account needed.**

(79 characters)

## Full description (4000 chars max; ~1900 used)

> **Put down a dot, connect the dots.**
>
> Wymber is a private place to map what you've been through. Lay out the events, feelings,
> people, places, and patterns of your story as dots on a map — then connect them, at your own
> pace. There's no right way to do this, and nothing is permanent: you can change, unlink, or
> remove anything.
>
> **Your map never leaves your device.**
> Everything you write is encrypted on your phone with a password only you know (AES-256).
> There is no account, no server, no tracking, and no analytics. We can't read your map — no
> one can. You hold the only key.
>
> • Unlock with your fingerprint or face, or your password
> • A recovery code protects you if you ever forget your password
> • Encrypted backups you control: save your vault anywhere — it stays unreadable without
>   your password
> • Eleven gentle building blocks: events, emotions, body sensations, people, places,
>   triggers, coping, support, needs, insights, and growth
> • Designed to be calm and predictable: soft colors, no jarring motion, and grounding
>   exercises one tap away
> • Crisis resources are always one tap away
> • Fully usable offline — the app works with no connection at all
> • Open source (AGPL), so our privacy claims are auditable by anyone
>
> Wymber was built trauma-informed from the first line of code: you set the pace, you can
> leave instantly (one tap locks everything), and the app never pressures, nags, or judges.
>
> *Wymber is a private wellness and reflection tool, not therapy or a crisis service. It is
> not a medical device and does not diagnose, treat, cure, or prevent any medical condition.*
> *If you need support, please consult a qualified healthcare professional — and if you are
> in crisis, contact your local crisis line right away.*

## "What's new" for 0.1.0 (500 chars max)

> The first Wymber for Android. Your map, encrypted on your device: no account, no server,
> no tracking. Unlock with fingerprint or face, keep encrypted backups you control, and map
> what you've been through at your own pace.

## Console declaration answers (decided; use as-is)

| Question | Answer |
|---|---|
| App category | **Health & Fitness** |
| Health apps declaration | **Health and Fitness → "Stress Management, Relaxation, Mental Acuity"** (NOT Medical — Wymber offers no counseling/treatment/clinical services) |
| App access (reviewer login) | **"All functionality is available without special access"** — reviewers create their own free local vault; there are no accounts or credentials to provide |
| Ads | **No ads** |
| In-app purchases | **None** (revisit when sync ships) |
| Data safety — collect? | **No data collected** (all processing is local; Google's definition excludes on-device-only data) |
| Data safety — share? | **No data shared** |
| Privacy policy URL | **https://wymber.app/privacy** (must also be reachable inside the app; verify before submitting) |
| Target audience | **18 and over** (avoids Families-policy obligations; a trauma tool is honestly adult-directed) |
| Content rating (IARC) | Non-game questionnaire: **No** to violence, sexuality, language, drugs, gambling; interactive elements: **no** user interaction, **no** sharing of location or personal info, **no** UGC visible to others, **no** purchases → expect **Everyone / PEGI 3** |
| Made for families / children | **No** |
| Government app / financial features / news | **No** to all |

## Assets still needed (before the listing can be saved)

- [ ] App icon 512×512 (from `frontend/icons/icon-512.png`, verify Play's padding rules)
- [ ] Feature graphic 1024×500 (soft pastel brand treatment; landing visual language)
- [ ] ≥2 phone screenshots (the emulator run already produced clean candidates: create screen,
      soft start, map with dots, add-entry modal — reshoot at final polish)
- [ ] Optional: short promo video (skip for alpha)
