# TrauMapp'd — Research & Strategy Report

**Date:** 2026-05-30
**Scope:** Trauma-informed design, evidence-based modalities, safety/ethics, regulatory landscape, node ontology, competitors, naming/brand, and prioritized recommendations.

> Produced by a research agent. Decision-support, not professional/legal advice. TrauMapp'd is a self-help/wellness tool and must never be presented as therapy, diagnosis, or a substitute for professional care. "Evidence-based" refers to the clinical *modality*; almost none of that evidence covers *unsupervised app delivery*, so most product applications are reasoned extrapolation. Regulatory points are general — have counsel review before launch, especially the paid cloud tier. Knowledge cutoff Jan 2026; live items (trademarks, domains, competitor features, polyvagal debate, AI-chatbot law) were web-checked May 2026 but still need primary-source verification.

---

## 1. Trauma-informed design principles

Anchor: SAMHSA's *Concept of Trauma and Guidance for a Trauma-Informed Approach* (2014), six principles, translated into product terms via the emerging trauma-informed design (TID) UX literature. ([SAMHSA infographic](https://www.samhsa.gov/resource/dbhis/infographic-6-guiding-principles-trauma-informed-approach); [SAMHSA concept paper](https://library.samhsa.gov/product/samhsas-concept-trauma-and-guidance-trauma-informed-approach/sma14-4884); [UX Content Collective TID guide](https://uxcontent.com/a-guide-to-trauma-informed-content-design/); [UX Magazine on TID](https://uxmag.com/articles/trauma-informed-design-understanding-trauma-and-healing))

Six principles: **Safety; Trustworthiness & Transparency; Peer Support; Collaboration & Mutuality; Empowerment, Voice & Choice; Cultural, Historical & Gender Humility.**

### 1.1 Safety (physical and psychological)
- **Do:** Global, persistent "pause / I need a break" affordance; one-tap grounding tool reachable anywhere (incl. mid-edit); blur/collapse/"fog" heavy nodes by default; optional gentle "soft start" screen; default to the calmest theme; honor `prefers-reduced-motion`; fast reliable exit (Escape closes modals; one-tap "step away").
- **Don't:** Streaks, "you haven't journaled in 5 days," guilt nudges, red badges, loss-aversion mechanics; auto-play animation on heavy content; "memories"/"on this day" resurfacing; forced "tell us your worst memory" onboarding. Trauma work proceeds *at the user's pace, never pushing disclosure.* ([window of tolerance / pacing](https://iptrauma.org/docs/body-of-knowledge-of-psychotraumatology/understanding-the-window-of-tolerance-in-trauma-theory/))

### 1.2 Trustworthiness & Transparency
- **Do:** Plain-language data-location statement on first run + settings ("Everything stays on this device. Nothing is sent anywhere unless you turn on Sync."); honest live data-flow indicator; legible encryption ("Only you hold the key. We literally cannot read your map."); real, immediate, confirmable deletion.
- **Don't:** Hide cloud-sync implications in a EULA; vague "we value your privacy" boilerplate. This audience is precisely the population harmed by BetterHelp/GoodRx-style betrayals (§4).

### 1.3 Peer Support
- **Do (carefully):** Static curated peer-experience content / normalization; links to vetted external communities + warmlines.
- **Don't:** In-app map sharing, public feeds, comment threads in MVP — moderation/contagion/privacy minefield that conflicts with local-first identity.

### 1.4 Collaboration & Mutuality
- **Do:** Tentative, collaborative language ("You might consider…", "Some people notice…"); let users define/rename node types & edge labels.
- **Don't:** Let the app label/diagnose ("You have an avoidance pattern"); auto-categorize without override.

### 1.5 Empowerment, Voice & Choice (most-cited TID principle)
- **Do:** Everything optional and reversible; undo everywhere; default new/heavy features OFF; choice of depth; choice of format (map / list / plain-text journal).
- **Don't:** Gate core functionality behind emotionally heavy steps; make progress feel mandatory or normed.

### 1.6 Cultural, Historical & Gender Humility
- **Do:** Inclusive, non-clinical, non-gendered defaults; locale-aware crisis resources (don't hard-code US-only 988); user-defined vocabulary; plan localization + RTL.
- **Don't:** Assume a Western, individualist, talk-therapy frame is universal.

> TID as a UX discipline is young (practitioner-blog, not peer-reviewed); treat specific checklists as heuristics. SAMHSA principles are authoritative but weren't written for software.

---

## 2. Evidence-based modalities — what to (not) embed

**General principle:** embed psychoeducation + self-directed regulation skills + organizing/meaning-making; do **not** embed trauma *reprocessing* (where harm risk concentrates and clinical containment is needed).

### 2.1 DBT — strongest fit for self-help skills
Four modules: Mindfulness, Distress Tolerance, Emotion Regulation, Interpersonal Effectiveness; well-evidenced; *skills* are the part most amenable to self-guidance (as a therapy adjunct). ([Four DBT modules](https://psychwire.com/free-resources/expert-insights/resource-1o224sc/the-four-dbt-skills-modules); [DBT Skills Group NJ](https://dbtskillsgroupnj.com/four-skill-modules/); [Best DBT apps](https://www.mindfulsuite.com/reviews/best-dbt-apps))

| Module | Appropriately offer | Inappropriate/risky | Keep-it-safe rule |
|---|---|---|---|
| Mindfulness | Short observe/describe; tag "what I noticed" | Long unguided meditation (dissociation/flashback risk) | Short, eyes-open option, easy stop |
| Distress Tolerance | TIPP, self-soothe, ACCEPTS in an always-available crisis-skills drawer | Framed as a substitute for crisis services | Pair with crisis resources; "get through the moment" |
| Emotion Regulation | Emotion-naming, check-the-facts, intensity over time | Implying emotions must be eliminated | Validate first; never pathologize |
| Interpersonal Effectiveness | DEAR MAN / boundaries linked to "person" nodes | Scripting confrontations with named abusers | Skills, not instructions about a specific person |

Offer a small, attributed **DBT-informed skills** library ("skills to try," not treatment). Don't claim "DBT app/therapy."

### 2.2 Mindfulness & grounding — embed, with trauma adaptations
Grounding (5-4-3-2-1, paced breathing, orienting) is lowest-risk/highest-value; pulls users into the **window of tolerance**. ([window of tolerance](https://iptrauma.org/docs/body-of-knowledge-of-psychotraumatology/understanding-the-window-of-tolerance-in-trauma-theory/); [Psychology Tools](https://www.psychologytools.com/resource/window-of-tolerance)) One-tap, eyes-open/body-light variants; don't push deep meditation by default (can increase distress/dissociation).

### 2.3 CBT — partial, light fit
Thought-record/reframe maps to insight/belief nodes. Offer gentle optional reframing. **Don't** build exposure/trauma-narrative reprocessing (device-like, needs containment). Avoid "your thinking is distorted" (invalidating).

### 2.4 IFS — interesting but elevated risk; keep light/optional
Parts-as-nodes resonates, but deeper parts work can destabilize without a therapist, risks false memories, and is used-with-caution for dissociative disorders/psychosis/some BPD. ([IFS outline](https://ifs-institute.com/resources/articles/internal-family-systems-model-outline); [Wikipedia IFS](https://en.wikipedia.org/wiki/Internal_Family_Systems_Model); [IFS self-help cautions](https://www.ifswithsanni.com/blog/apps-for-ifs-therapy)) Max: name "parts" as nodes (vocabulary/psychoeducation). Don't guide unburdening/retrieval; AI must never play IFS-therapist.

### 2.5 Narrative therapy — good fit, low risk if descriptive
Externalizing ("the problem is the problem; the person is not the problem") + re-authoring fits mapping; the **trauma egg / trauma timeline** (Murray Method) is essentially this product on paper — strong validation + a model to study. ([externalizing](https://positivepsychology.com/narrative-therapy/); [trauma egg](https://oakmountaincoaching.com/trauma-egg/); [trauma timeline](https://www.mentalyc.com/worksheets-and-cheatsheets/trauma-timeline-worksheet)) Lean into externalizing + timeline view; don't force chronological completeness (flooding risk).

### 2.6 Polyvagal — use the *practices*, not the *neuroscience claims*
Polyvagal-derived practices are useful, but the theory is scientifically contested and the debate is live/unresolved. ([Wikipedia](https://en.wikipedia.org/wiki/Polyvagal_theory); [Polyvagal Institute critical discussion](https://www.polyvagalinstitute.org/criticaldiscussionofpolyvagaltheory); [JPR: "scientifically questionable but useful in practice"](https://journalofpsychiatryreform.com/2023/10/17/polyvagal-approaches-scientifically-questionable-but-useful-in-practice/)) Offer "nervous-system check-in" framings; **don't** make vagal-nerve neuroscience claims.

> **Cross-cutting rule:** psychoeducation + regulation + meaning-making; never reprocessing. Every modality optional, skippable, validating-first, paired with grounding + crisis resources.

---

## 3. Safety, ethics & risk

### 3.1 Crisis handling
Mandatory always-reachable crisis resource. US: **988** (call/text/chat) + **Crisis Text Line (HOME to 741741)**. Global + locale-humble → integrate **Find A Helpline / ThroughLine** (175+ countries). Provide **offline/cached** (local-first users may be offline). ([988](https://988lifeline.org/); [Crisis Text Line](https://www.crisistextline.org/); [findahelpline.com](https://findahelpline.com/)) Don't build automated risk-scoring that flags users to third parties.

### 3.2 Avoiding retraumatization
Heavy content collapsed/blurred by default; no resurfacing; no forced disclosure; gentle predictable transitions; "lighter mode"; exit + grounding always within reach.

### 3.3 Scope-of-use & disclaimers
Persistent plain-language: *"TrauMapp'd is a self-reflection and wellness tool. It is not therapy, medical care, or a crisis service, and it can't diagnose or treat any condition. If you're in danger or crisis, contact [resources]."* State limitations honestly (ethical + regulatorily protective).

### 3.4 Mandatory safety features (red-line checklist)
1. One-tap grounding tool, everywhere, offline. 2. Always-available, locale-aware, offline crisis resources. 3. Persistent non-therapy disclaimer. 4. Global pause/exit; Escape closes modals. 5. Real, immediate, confirmable deletion. 6. No streaks/guilt/loss-aversion. 7. Heavy content collapsible/blurrable by default.

### 3.5 AI "Explore/Connect" guardrails (NON-NEGOTIABLE)
2025–2026 evidence on AI mental-health chatbots is sobering: documented self-harm encouragement, delusion reinforcement, crisis-referral failures, safety degrading over long chats; new laws (e.g., NY "I am not human" reminders + self-harm detection). ([PIRG](https://pirg.org/edfund/resources/ai-chatbot-therapy/); [Stateline](https://stateline.org/2026/01/15/ai-therapy-chatbots-draw-new-oversight-as-suicides-raise-alarm/); [Undark](https://undark.org/2025/09/18/opinion-chatbots-guardrails-mental-health/); [constitutional AI for MH (arXiv)](https://arxiv.org/pdf/2509.16444))

Red lines: **no directive interpretation of trauma** (open tentative questions only, never assert meaning/diagnose/label); **no therapy role-play** (no IFS/EMDR/reprocessing/exposure); **crisis-aware + de-escalating** (on self-harm/abuse/psychosis cues: stop exploring, surface crisis resources, direct to human help; stay reliable over long sessions); **non-human transparency** (repeated AI reminders); **no data egress — by architecture** (local model; no map content leaves device; no training on user data; no conversation telemetry); **bounded/validating/optional** (default OFF, conservative refusals); **don't optimize for engagement** (no sycophancy/"keep them talking").

---

## 4. Regulatory / compliance landscape (not legal advice)

### 4.1 Wellness app vs. medical device (FDA/CE)
Device = intended to **diagnose/treat/cure/mitigate/prevent** a condition. General-wellness (stress management, self-reflection) with **no disease claims** is generally outside active FDA oversight; CBT-for-anxiety/PTSD-exposure delivery pushes toward device territory. ([APA wellness vs treatment](https://www.apaservices.org/practice/business/technology/tech-talk/wellness-treatment-digital-mental-health); [FDA digital MH](https://www.fda.gov/media/189391/download); [Hooper Lundy](https://hooperlundy.com/fdas-new-digital-health-guidance-signal-shift-for-wellness-devices-and-cds/))
**Lever:** claims discipline — "self-reflection / organize & understand your experiences / well-being"; **avoid** "treats PTSD / reduces trauma symptoms / clinically proven / therapy." EU MDR is stricter (CE-marking if medical *purpose*). AI "Explore" raises FDA interest — keep wellness-framed/non-diagnostic.

### 4.2 HIPAA
Consumer self-help app with no covered-entity link is **generally outside HIPAA**. But **FTC Health Breach Notification Rule** (updated 2024) explicitly covers health apps; FTC fined **GoodRx ($1.5M)** and acted vs **BetterHelp ($7.8M)** for sharing MH data. Your zero-sharing/no-ads/no-telemetry posture is the defense — make it true and provable. ([HHS health apps](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html); [FTC HBNR 2024](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps); [FTC GoodRx](https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising))

### 4.3 GDPR / UK GDPR (real obligation, esp. cloud sync)
MH content = **Article 9 special-category** data → **explicit, granular, named, withdrawable consent** (not buried). Applies to any EU/UK resident regardless of company location; fines up to 4% global revenue. Local-first shrinks the surface; **the paid cloud-sync tier is where obligations attach** even with zero-knowledge E2EE. ([Art. 9](https://gdpr-info.eu/art-9-gdpr/); [ICO special category](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/); [GDPR health consent](https://www.themomentum.ai/blog/gdpr-consent-requirements-health-data))

### 4.4 Zero-knowledge sync nuance
E2EE is right + a differentiator, but "we can't read it" reduces ≠ erases obligations: account metadata, billing, IP/timestamps remain; honor GDPR rights, DPA/notice, breach notification, Art. 9 consent. ([Intellect ZK](https://intellect.co/read/privacy-of-mental-health-apps/); [HIPAA/GDPR for MH apps](https://secureprivacy.ai/blog/mental-health-app-data-privacy-hipaa-gdpr-compliance))

**Safe-side checklist:** claims discipline; no ads/third-party analytics/data sale (and say so); plain-language policy + non-therapy disclaimer; E2EE + minimized metadata + honest threat model; GDPR explicit-consent for sync + data-subject rights + real deletion; FTC HBNR breach plan; age gating (13–16) + CCPA/CPRA; US state AI-chatbot laws if "Explore" ships; incident/breach plan before launch.

---

## 5. Node ontology review

**Current 8:** event, emotion, person, place, trigger, coping, insight, growth — a solid base mirroring trauma-egg concepts + recovery types. Gaps: **body, needs/values, safety/resources, beliefs.**

**Keep (notes):** event (most disclosure-pressure; keep optional/collapsible), emotion (add intensity slider), person (allow initials), place, trigger (pair with anchor), coping (consider rename), insight (pairs with belief), growth.

**Add:**
- **body sensation** *(high value)* — somatic awareness, central to trauma/window-of-tolerance, currently absent.
- **need** — unmet/met needs underlie much trauma.
- **value** — what matters; empowerment/strengths anchor.
- **support / resource** — who/what the user can lean on; safety counterweight to trigger-heavy maps (reinforces Peer Support).
- **safety / regulation anchor** — places/objects/practices that calm; quick grounding access. **Pair "trigger" creation with a prompt to add a coping/anchor** so the map isn't only pain.
- **belief** *(optional)* — recurring self/world beliefs (trauma-egg endpoint, CBT cognition); could be a sub-flavor of insight.

**Structure:** keep default set lean (~8–10); expose extras as optional/user-toggleable/user-definable; allow rename/recolor.

**Gentle placeholder prompts (optional, non-directive):**
- event: "Something that happened. Share only as much as feels okay."
- emotion: "A feeling that came up. There's no wrong feeling here."
- body sensation: "What did you notice in your body? (Skip if you'd rather not.)"
- person: "Someone connected to this. You can use initials or a nickname."
- place: "A place that's part of this."
- trigger: "Something that brings the feeling back. Want to add a calming anchor too?"
- coping / skill: "Something that helps you get through. Even small things count."
- support / resource: "Someone or something you can lean on."
- safety / regulation anchor: "A place, person, or practice that helps you feel steadier."
- need: "What did you need then — or need now?"
- value: "Something that matters to you."
- insight: "Something you've come to understand. No pressure to have answers."
- growth: "A way you've grown or coped, however small."
- belief: "A belief about yourself or the world that this shaped. You can question it later."

---

## 6. Competitive landscape

No direct competitor found doing **trauma-mapping-as-core, local-first, with optional private AI** — a genuine open position. Closest analog is the *paper* trauma egg/timeline (validation, not competition). Four buckets:

- **A. Trauma-specific self-help:** PTSD Coach (VA — trusted, symptom/coping, not mapping), Rebound / Self Help for Trauma / Healing Traumatic Stress. *Gap: none center visual relational mapping.* ([VA apps](https://www.ptsd.va.gov/appvid/mobile/); [traumaapps.com](https://www.traumaapps.com/))
- **B. DBT/mindfulness skills:** DBT Coach, DBT Travel Guide, Wysa (AI). *Gap: skills-first not map-first; cloud/AI not privacy-first.* ([Best DBT apps](https://www.mindfulsuite.com/reviews/best-dbt-apps))
- **C. Mood/journaling:** Daylio (local storage — privacy point to match/beat), Reflectly, Day One, Rosebud, Mindsera. *Gap: list/timeline not node-and-connection; AI is cloud.* ([Daylio](https://daylio.net/); [Rosebud roundup](https://www.rosebud.app/blog/top-10-ai-journaling-apps-for-trauma-healing-and-emotional-recovery))
- **D. General mind-mapping repurposed:** Miro, MindMeister, EdrawMind, AFFiNE (local-first). *Not trauma-informed, no safety/crisis features.* ([EdrawMind](https://edrawmind.wondershare.com/mind-map/mental-health-mind-map.html); [AFFiNE](https://affine.pro/blog/mind-mapping-software))

**Defensible wedge:** mapping-as-core for trauma; local-first + true privacy; optional private/local AI; trauma-informed by construction. **Watch-outs:** wellness-not-therapy line; well-funded AI-journaling incumbents; "trauma" in positioning narrows the funnel (§7).

---

## 7. Name & brand research

> Web-checked May 2026; treat TM/domain findings as a sanity check, not clearance.

### "TrauMapp'd" assessment
**Collisions (real risk):** the "Trauma + app" namespace is crowded — **The Trauma App** (clinical docs), **TraumApp / traumapp.com** (existing; site had an expired TLS cert), **traumaapps.com**, **Trauma App** on Google Play, **TTapp**. No product named exactly "TrauMapp'd," but it's a **near-homophone of TraumApp/Traumapp** in the same class → trademark "likelihood of confusion" risk.
**Spelling/pronunciation:** the **apostrophe-d ("'d") is a liability** (unsayable, invalid in URLs, hard to type, hurts word-of-mouth/search); "TrauMapp" reads ambiguously (Trau-Map vs Trauma-pp); double-p collides with "-app."
**"Trauma" in the name:** *Cons (significant)* — off-putting/stigmatizing for the audience, a label many don't claim, heavy on a home screen / in public, foregrounds the wound not the agency. MH naming favors safety/calm/resilience (Calm, Finch, Daylio, Headspace — none name the pathology). *Pros* — SEO/discovery, category clarity, honesty. *Net:* mapping is the differentiator and gentler hook; make "trauma" optional in the tagline, not mandatory in the name. ([mindful MH naming](https://smartbranding.com/mindful-naming-how-mental-health-startups-are-choosing-names-that-build-trust/))

### Alternative directions (need real TM/domain clearance)
1. **Throughline** — thread connecting experiences; warm. *Risk: common word; "ThroughLine" runs Find A Helpline — verify conflict.*
2. **Mendmap** — mend + map; gentle, on-concept, sayable.
3. **Pathweave / Weaver** — weaving experiences into a map. *("Weaver" crowded; combos freer.)*
4. **Inner Atlas / Atlas of Me** — personal map of inner world; dignified. *(2-word lockup for availability.)*
5. **Lantern / Lumen / Throughlight** — light-in-dark, hopeful. *(check prior MH usage.)*
6. **Rootmap** — roots/origins + map.
7. **Cairn** — marks a safe path through hard terrain; quiet, resilient, no pathology word.
8. **Constella / Constellate** — map experiences like a constellation (nodes + connections); modern, gentle.

**Recommendation:** move off "TrauMapp'd" (TraumApp homophone + apostrophe-d + trauma-word stigma). Top picks to validate: **Cairn**, **Constellate/Constella**, **Mendmap** — keep the map/connection metaphor, evoke safety/path/healing, sayable/ownable, "trauma" goes in the tagline for SEO. If keeping a trauma-forward name, at minimum drop the apostrophe-d and double-p and de-risk the Traumapp collision.

**Taglines:** "Map your story. At your pace, in your hands." · "A private, gentle space to make sense of what you've been through." · "Your experiences, connected. Your data, yours alone."

---

## 8. Prioritized recommendations (issue-ready)

**P0 (MVP — safety, legal, trust):** offline locale-aware crisis resources; one-tap grounding tool (offline); persistent non-therapy disclaimer; claims discipline (UI/marketing/store); real confirmable deletion + data-flow transparency; collapse/blur heavy content by default + remove streaks/"memories"; **resolve the name before public launch.**

**P1 (MVP / fast-follow):** expand node ontology (body sensation, support/resource, need, safety anchor; optional/user-definable) + gentle prompts; trigger→coping prompt; optional DBT/grounding skills library ("skills to try"); GDPR Art. 9 explicit consent + data-subject rights (sync tier) + honest threat model; list/timeline + journal alternate views; calmest-theme default + reduced-motion + WCAG AA.

**P2 (post-MVP):** AI "Explore/Connect" only with the full §3.5 guardrails (local, no egress, crisis-aware, non-directive, default OFF); paid zero-knowledge sync (metadata minimization, FTC HBNR plan, explicit consent); optional IFS/narrative as light psychoeducational node flavors (contraindication notes, no guided processing); curated non-social peer content + external links; localization/RTL/cultural vocabulary; track US state AI-chatbot laws + FDA AI guidance before "Explore" GA.

> Strongest/most defensible: the P0 safety/trust/claims + node-ontology/format items (low-risk, well-grounded). Gate the **AI "Explore"** feature hard. Keep **polyvagal** framing and **IFS** depth deliberately light. Resolve the **name** before launch. Re-verify all TM/domain/competitor/legal specifics against primary sources.
