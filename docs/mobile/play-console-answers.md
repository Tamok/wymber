# Play Console answers (#149)

Pre-drafted answers for the Google Play Console forms, meant to be transcribed while sitting in
front of the console, not filed by this document. Every substantive answer below cites either
[`egress-audit.md`](egress-audit.md) (the evidence base), [`play-store-readiness.md`](play-store-readiness.md)
(the policy research, with its `[answer/NNNN]` citations reused as-is, not re-verified here), or
[`store-listing.md`](store-listing.md) (the copy already drafted for the listing). No new policy
citation is invented in this document. Where a claim needs a live check against the current Play
Console UI or policy page, it is marked as such rather than asserted.

---

## Owner decisions required

These are not filled in below because they are not this document's call to make. Read the full
sections cited before deciding.

1. **Target audience / age declaration (§C).** `store-listing.md:72` currently records "18 and
   over" as "decided, use as-is." `compliance-posture.md` §4 says plainly that no age gate, age
   declaration, or minimum-age statement exists anywhere in the app, and explicitly leaves the
   threshold as an open question needing counsel. These two documents are in tension. The owner
   needs to pick one of the paths laid out in §C before this field is filed, and separately decide
   whether an in-app age gate ships at all, since the store declaration and an in-app control are
   independent decisions.
2. **User-initiated export and the Data Safety "collected" question (§A).** The likely basis for
   answering "not collected" despite the export path is a "user-initiated action" style exemption
   in Google's Data Safety policy. `play-store-readiness.md` does not establish that exemption as
   settled fact for this case, so it is presented here as the probable basis, not a verified rule.
   The owner (or whoever files the form) should read the live Data Safety policy page's exact
   exemption language before answering "No data collected" with full confidence.
3. **Whether to fix the two privacy-policy gaps in §D before submission or after.** Both are real
   gaps (no in-app link; the published policy describes browser storage, not the native Android
   storage path). Filing with these open is a compliance risk that grows with time in front of
   users; fixing them is out of this document's scope (it touches `frontend/index.html` and
   `landing/privacy.html`, which this task did not write to).

---

## Blocked / verify before filing

- **The Data Safety "user-initiated action" exemption's exact wording**, checked against the live
  Play Console Data Safety policy page at filing time, not assumed from this document.
- **That `https://wymber.app/privacy` actually resolves** as a clean URL. The policy content lives
  at `landing/privacy.html` in this repo; whether the deployed site serves it at the clean
  `/privacy` path (redirect, rewrite, or static route) was not verified in this session. Confirm
  in a browser before entering it as the Play field value.
- **The Play Console's current exact wording and section order** for the Data Safety form and the
  content rating questionnaire. Google revises these UIs; the mapping below is a best-effort match
  against the sections `play-store-readiness.md` and public help pages describe, not a screenshot
  of the live form.

---

## A. Data Safety form

Evidence base: [`egress-audit.md`](egress-audit.md) Verdict and §2 "Export and share." Policy
framing: `play-store-readiness.md:81-88` (privacy policy requirement, "no data collected" framing,
`[answer/10787469]`, `[answer/10144311]`, `[answer/16679511]`).

### Does your app collect or share any of the required user data types?

**Answer: No.**

Justification: `egress-audit.md`'s Verdict states the Android app "initiates no network
transmission of user data," with zero occurrences of `fetch`, `XMLHttpRequest`, `sendBeacon`,
`WebSocket`, or `EventSource` across every module in `frontend/js/` (egress-audit.md §2), no
analytics/telemetry/crash-reporting dependency anywhere in `mobile/` (egress-audit.md §4), and no
server-side storage of any kind (`backend/main.py` serves only the static app and `/api/health`,
per `compliance-posture.md` §2). Nothing is collected because there is no code path capable of
collecting it.

### Data sharing

**Answer: No data shared with third parties.**

Justification: same evidence as above. There is no SDK, ad network, or backend endpoint that could
receive shared data (`egress-audit.md` §4, `compliance-posture.md` §2).

### The subtlety: user-initiated export

`egress-audit.md` §2 "Export and share" documents the one path where a file actually leaves the
device: on the native shell, `export.js`'s JSON and text exports are plaintext, and
`native-share.js:97-101` hands the exported file to the OS share sheet (`ACTION_SEND`). If the user
picks Gmail or Drive from that chooser, the file leaves the device under the user's own choice of
destination, not the app's.

This is not "collection" by the app in any ordinary sense (the app never sees or selects the
destination), and `egress-audit.md` §2 states directly: "This is not app-initiated transmission and
not 'collection' in any sense." The likely basis for keeping the Data Safety answer at "No data
collected" despite this path is Google's Data Safety guidance carrying an exemption shaped like
"data transferred at the user's specific direction" or "user-initiated action" (for example, a
user explicitly exporting and emailing their own file). **This document does not assert that
exemption as established**, because `play-store-readiness.md` does not verify its exact wording or
scope. Treat it as the probable basis, and confirm the exemption's precise language on the live
Data Safety policy page before relying on it (see "Blocked / verify before filing" above).

Practical answer to enter: **No data collected**, with the export path understood internally as
resting on the user-direction exemption, not omitted from consideration.

### The other subtlety: OS backup and device transfer

Worth having straight before filing, because it is the question most likely to be asked of a
local-first app: **the vault is not swept into a Google cloud backup.**
`mobile/android/app/src/main/AndroidManifest.xml:7` sets `android:allowBackup="false"`, which
disables cloud-based Auto Backup to Google Drive (`egress-audit.md` §1, with the Android
documentation quoted there). No user data reaches Google via backup.

The audit also records a nuance that does **not** change any answer on this form, but should not be
discovered for the first time mid-review: on API 31+, `allowBackup="false"` does not reliably
disable *device-to-device* transfer, and no `dataExtractionRules` is set. That flow moves data from
the user's old phone to their own new phone at their own initiation, involves no third party and no
Google Drive, and moves only ciphertext. It is not collection, sharing, or transmission to anyone.
See `egress-audit.md` §1 for the full reasoning and the recommended hardening.

### Security practices: is data encrypted in transit?

The form's question is built around the assumption that some transmission happens. Here, none
does: `egress-audit.md`'s Verdict is that there is "no code path that sends vault contents
anywhere," and the one `INTERNET` permission exists solely to let the Capacitor WebView bridge
serve the local app shell over `https` (`egress-audit.md` §3, "Manifest"; `capacitor.config.json`
sets `androidScheme: "https"`), not for any outbound call.

Where the console offers a "data is not transmitted off the device" or equivalent option, that is
the accurate answer, and it should be selected instead of "Yes, encrypted in transit" or "No, not
encrypted." If the current form forces a binary yes/no with no such option, the honest answer is
that the question's premise (transmission occurs) does not hold for this app; do not answer "Yes"
to imply a transmission-encryption guarantee that is moot because there is no transmission to
guarantee. This is a case worth a screenshot-level check against the live form wording rather than
guessing at the exact option label here.

### Data deletion request mechanism

**Answer: not applicable in the sense of a server-side deletion request, because there is no
server-side data to delete** (`compliance-posture.md` §2, `backend/main.py` has no user-data
endpoint).

**The in-app deletion control exists and can be cited.** `frontend/js/app.js:1340` renders a
`Delete everything` button in the settings "Your data" section, wired at `app.js:1346` to
`deleteAccount()`, described in the adjacent copy as "Permanently removes your space and all
entries from this device." So both deletion paths Play expects are real: the in-app control, and
uninstalling the app (which removes its private storage, since the vault lives in app-private
storage per `egress-audit.md` §1).

This matters for §D gap 2: `play-store-readiness.md:83-85` calls for the privacy policy to describe
deletion as "deleting the app or 'Delete everything'". The control exists; it is the *published
policy* that does not yet describe it.

### Independent security review

**Answer: No independent security review has been conducted.** `compliance-posture.md` §9 (gaps
register) lists "No external security audit" explicitly as an open item, not done today. Answer
honestly rather than implying a review occurred.

---

## B. Content rating questionnaire (IARC)

Evidence base: `play-store-readiness.md:92-93` ("the questionnaire has no mental-health/journaling
item, and crisis-line links do not raise the rating," `[answer/9859655, 6209544]`) and
`egress-audit.md` §2's link inventory.

**Answer honestly. Under-declaring is a policy violation**, not a way to get a lower rating for
free.

- **Violence, sexuality, profanity, drugs/alcohol/tobacco, gambling:** No to all. Nothing in the
  app's content touches any of these categories (11 node types are descriptive personal-reflection
  categories, `frontend/js/config.js`, per `compliance-posture.md` §1).
- **Does the app link to a crisis line or helpline?** Yes: the app has `tel:988`, `sms:988`,
  `tel:911`, and `sms:741741` (Crisis Text Line) links, plus one external browser link to
  `https://findahelpline.com` (all cited in `egress-audit.md` §2's outbound-links table, lines 56,
  538-557 of `frontend/index.html`). Declare these presences honestly if the questionnaire asks
  about them. Per `play-store-readiness.md:93`, crisis-line links do not raise the rating; the
  expected outcome is still Everyone, but declare the links as present rather than omitting them to
  aim for a particular answer.
- **User interaction / does the app allow users to interact with each other?** No. There are no
  accounts and no server (`CLAUDE.md`; `compliance-posture.md` §2), so there is no mechanism for
  one user to interact with another inside the app.
- **Does the app share the user's location?** No. No location permission is requested
  (`egress-audit.md` §3, "no location, no contacts, no storage permissions" beyond `INTERNET` and
  `USE_BIOMETRIC`), and no code path reads or transmits location.
- **User-generated content visible to other users?** No. All content (nodes, edges, story text) is
  private to the single local vault; there is no sharing surface, feed, or multi-user view of any
  kind. The only way content leaves the app at all is the user-initiated export/share path
  described in §A, which sends a file to a destination the user personally picks, not to other
  users of the app.
- **In-app purchases:** No, per `store-listing.md:68` ("None (revisit when sync ships)").

Expected result, per `play-store-readiness.md:93`: **Everyone**. Enter the honest per-question
answers above and let the questionnaire compute the rating; do not pre-select "Everyone" and reverse
into matching answers.

---

## C. Target audience / age declaration

**This is the most important item in this document to get right, and it is deliberately not
resolved here.**

Two existing documents disagree on where this stands:

- `store-listing.md:72` lists **"18 and over"** in a table titled "Console declaration answers
  (decided, use as-is)," with the stated rationale "avoids Families-policy obligations; a trauma
  tool is honestly adult-directed."
- `compliance-posture.md` §4 states plainly: "No age gate, age declaration, or minimum-age
  statement exists anywhere in the app, the landing site, or this repository's documentation
  today," and treats the threshold as an **open gap needing counsel**, explicitly declining to
  adopt a specific number ("asserting a number here without legal review would be worse than
  leaving it open"). `compliance-posture.md` §9's gaps register repeats this as unresolved,
  flagging it as more urgent "before app-store distribution."

These two claims cannot both be simultaneously true as stated: one document calls 18+ decided, the
other says no age determination has been made anywhere. This document does not adopt either
position. What follows is the set of choices available, not a recommendation of one.

**Two independent decisions, not one:**

1. **The Play Console "target audience" store declaration.** This is a metadata field about who
   the app targets; it does not, by itself, add any in-app enforcement.
2. **An actual in-app age gate or age-related control** (a self-declared age screen, a click-through
   notice, or nothing at all). Today, nothing exists in the codebase (`compliance-posture.md` §4).

These can be set independently: a store declaration of "18 and over" with no in-app gate is a
different posture from an in-app gate plus a matching store declaration, and different again from a
lower age target with the safeguards Play requires for that (parental controls, ads policy,
Families policy scope, etc., not detailed here since Wymber is not pursuing that path per
`store-listing.md:74`, "Made for families / children: No").

**Options, laid out without a pick:**

- **A. Declare "18 and over" at the store level, ship no in-app age gate.** Matches
  `store-listing.md`'s current position. Fastest to file. Leaves `compliance-posture.md` §4's gap
  open (no in-app statement or enforcement of the age line the store declares), which the gaps
  register already flags as unresolved and in need of counsel before store distribution.
- **B. Declare "18 and over" at the store level AND add an in-app age gate or click-through
  affirmation.** Closes part of the §4 gap by making the age line visible and self-attested inside
  the product, not just in Play metadata. Requires new UI work (out of this document's scope).
- **C. Get counsel input first, then set a number (which may or may not be 18) and align both the
  store declaration and any in-app control to it.** This is the path `compliance-posture.md` §4
  itself points toward ("an open question needing counsel"). Slowest, most defensible.
- **D. Defer: do the internal-testing preview first and settle this before the production listing.**
  `play-store-readiness.md` §2 records that internal-only releases are exempt from the Data safety
  section and do not require a complete store listing, and its §3 groups the target audience
  declaration under the "full gate (first closed test / production)" rather than internal testing.
  Note precisely what that does and does not establish: the readiness doc names Data safety and the
  store listing as the explicit internal-testing exemptions, and places target audience in the later
  gate by structure rather than by an explicit exemption sentence. Treat "target audience is not
  required for internal testing" as a strong inference from that document, not a verified rule, and
  confirm it in the console before relying on it to defer.

Whatever is chosen, update `store-listing.md:72`'s "decided" framing to reflect the actual decision
process, since as written it currently overstates where this stands relative to
`compliance-posture.md` §4. That correction is not made in this document, since it would mean
editing `store-listing.md`, outside this task's one-file scope.

---

## D. Health-apps policy mapping

Source: `play-store-readiness.md` §5 (researched against official Play policy pages,
`[answer/14738291]`, `[answer/16679511]`, `[answer/10144311]`).

| Requirement (play-store-readiness.md §5) | What the app actually does | Status |
|---|---|---|
| Health apps declaration is mandatory for all apps with health features; declare Health & Fitness → "Stress Management, Relaxation, Mental Acuity", not Medical | `store-listing.md:64-65` already records this exact answer, with the rationale that Wymber offers no counseling/treatment/clinical services | Answered, matches `store-listing.md:64-65` |
| Verbatim non-medical-device disclaimer required in the listing description | `store-listing.md:49-50` carries it verbatim: "It is not a medical device and does not diagnose, treat, cure, or prevent any medical condition." Confirmed present in the full description as drafted. | Present, confirmed |
| Consult-a-professional reminder required in-app and/or listing | `store-listing.md:51-52` carries it: "If you need support, please consult a qualified healthcare professional, and if you are in crisis, contact your local crisis line right away." Confirmed present in the listing copy. The in-app safety-bar text quoted in `compliance-posture.md` §1 ("a private wellness and reflection tool, not therapy or a crisis service") covers the in-app half. | Present, confirmed |
| Privacy policy required in the Play field **and** in-app, public non-PDF URL, with contact info, data-handling, and retention/deletion, and for health apps specifically addressing how sensitive content is handled | Play field value drafted as `https://wymber.app/privacy` (`store-listing.md:71`). **No in-app link exists.** A full-tree search of `frontend/` for `/privacy`, `privacy-policy`, and `wymber.app/privacy` returns zero matches; `frontend/index.html:162-166` has only a `.privacy-notice` div of reassurance text ("All data stays on your device, encrypted / No account, no server, no tracking / You hold the only key"), which is not a link to the policy document. Note that `store-listing.md:71` already carried the caveat "must also be reachable inside the app; verify before submitting"; this audit is that verification, and the answer is that it is not. | **Open gap 1: no in-app privacy policy link exists.** |
| Same requirement, continued: the published policy content must accurately describe the app | `landing/privacy.html:62-63` says the vault is stored "in your browser's private storage." On the Android native shell this is inaccurate: the vault is written to app-private native storage via the Capacitor Filesystem plugin (`frontend/js/native-persistence.js:33-35`, `DIRECTORY = 'DATA'`; `mobile/README.md` "The native vault backend" section), not to browser storage. The policy also contains no minimum-age statement (consistent with the §C gap) and does not describe an app-level deletion mechanism (only "if you clear your browser's site data, your vault is deleted with it," `landing/privacy.html:71-73`, which does not describe the native Android deletion path, nor the in-app "Delete everything" control that does exist at `frontend/js/app.js:1340` and that `play-store-readiness.md:83-85` calls for the policy to describe). | **Open gap 2: the published privacy policy is web-framed, storage-inaccurate for Android, and missing the age and app-level-deletion content the health-apps policy calls for.** |
| Data Safety form: "No data collected" is honestly available for locally-processed, non-transmitted data | See §A above | Answered, with the export-path caveat in §A |
| WymberSync (future, ciphertext-only) note | Not shipped; `backend/main.py`'s docstring notes only that a future sync endpoint "would live" there (`compliance-posture.md` §7). Not relevant to the current submission. | Not applicable today |
| Content rating: no mental-health/journaling item on the questionnaire; crisis-line links do not raise the rating | See §B above | Answered |

### The remaining app-content fields

The Play Console's "App content" section asks several further questions that this document does not
re-derive because `store-listing.md:60-76` already settles them. Listed here so none is missed at
the console, with the audit evidence that backs them:

| Field | Answer | Backing |
|---|---|---|
| App access (reviewer login) | All functionality available without special access | `store-listing.md:66`. No accounts exist, so there are no credentials to supply; a reviewer creates their own local vault |
| Ads | No ads | `store-listing.md:67`; no ad SDK exists (`egress-audit.md` §4) |
| In-app purchases | None | `store-listing.md:68` (revisit when sync ships) |
| Made for families / children | No | `store-listing.md:74`, and see §C |
| Government app / financial features / news | No to all | `store-listing.md:75` |
| App category | Health & Fitness | `store-listing.md:64` |

**Both gaps above are open items, not resolved by this document.** Closing gap 1 requires adding an
in-app link (a UI change to `frontend/`, outside this task's scope). Closing gap 2 requires editing
`landing/privacy.html` to describe the native storage path accurately, add a minimum-age statement
once §C is decided, and describe app-level deletion (also outside this task's scope). Both are
listed under "Owner decisions required" above as items to resolve, or explicitly accept as filed
with open gaps, before submission.
