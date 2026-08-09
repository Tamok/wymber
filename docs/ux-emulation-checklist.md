# UX emulation checklist

A repeatable way to catch visual/UX regressions that a green test run wouldn't. Green assertions
prove behaviour (a button exists, a value saved, an ARIA attribute is right); they cannot tell you
a node's text got illegible, a colour reads alarming instead of calm, or a mobile layout hides a
control behind another one. This document is that missing pass: partly scripted (a screenshot
tour you run), partly a checklist a person works through with their own eyes.

It generalizes what `docs/user-stories/first-run-and-map-editing.md` did once by hand into
something repeatable, so it can be re-run after a change instead of re-invented.

## When to run it

Run it after any **significant, user-facing change**:

- A new user-facing surface (a screen, modal, or panel nobody has looked at yet).
- A change to the map or the outline twin (rendering, layout, node/edge visuals).
- A change to auth or vault flows (create, unlock, recovery, restore).
- A change to theming or the colour palette (`frontend/js/config.js`'s `PALETTES`, CSS tokens).
- A change to copy on a safety surface (the disclaimer, crisis modal, grounding modal): the
  content rules live in `docs/CONTENT-GUIDELINES.md`, but *how it reads* is a human judgment
  the tour supports.
- Any CSS/layout change that could ripple (a shared token, a modal shell, the app shell/footer).

**Not needed** for a change contained to logic with no visual surface: a pure refactor, a backend
change with no template touched, a test-only change, a copy tweak inside an existing string
(unless it's on a safety surface, per above).

## How to run the automated part

```bash
# Full suite (what CI runs)
npx playwright test

# Just the screenshot tour
npx playwright test e2e/ux-tour.spec.js

# If port 8089 is already taken (e.g. another worktree's suite is running), override it:
E2E_PORT=8199 npx playwright test e2e/ux-tour.spec.js   # bash
# PowerShell: $env:E2E_PORT=8199; npx playwright test e2e/ux-tour.spec.js
```

Screenshots land under `test-results/ux-tour/<desktop|mobile>/NN-<screen>-<viewport>.png`
(`test-results/` is gitignored, nothing binary ever gets committed). Every shot is also attached
to the Playwright HTML report, and `.github/workflows/ci.yml` already uploads `playwright-report/`
as a build artifact on every CI run, pass or fail, so the tour images ride along in CI for free.

To look at the report:

```bash
npx playwright show-report
```

Open the failed or passed test, expand its attachments, and step through the numbered shots in
order (`01-create-*` through `14-whats-new-*`, plus the `map-theme-*` set). The tour covers each
key screen at **two viewports** (desktop 1280x800, mobile 390x844) and the **map screen under all
three themes** (light / dark / soft), because a palette or layout regression is invisible to text
assertions.

## The checklist

Work through the section relevant to what changed. Each line is something a person can judge
pass/fail by looking; check it against the tour's screenshots, or against the running app if you'd
rather drive it live. Where a line is already covered by an automated spec, it says so, so you
don't have to re-verify it by eye.

### First run
- [ ] The create screen reads calm, not clinical: one password field, no account jargon.
      *(Automated: `e2e/auth.spec.js`, `e2e/journeys.spec.js` check the copy and flow exist and
      behave; they can't judge whether it feels calm.)*
- [ ] The recovery sheet's warning ("we can't recover it for you") reads honest, not scary.
- [ ] The soft-start screen feels like a pause, not a wall between the user and the map.
- [ ] The "How it works" walkthrough steps read gently and don't rush the reader.

### The map
- [ ] Nodes render legibly: text isn't clipped, doesn't overflow its shape, and isn't crowded by
      a neighbour. **Known issue as of this writing**: the tour's own `05-map-linked-*`
      screenshots show the cose layout placing a handful of nodes from more than one disjoint
      pair close enough to visibly overlap and obscure each other's text (both desktop and
      mobile). See "Known issues" below; re-check this line specifically whenever
      `frontend/js/mindmap.js`'s layout call changes.
- [ ] Edges are visually distinguishable from the background and from each other where they cross.
- [ ] The colour-key ("What the colours mean") legend colours visibly match the nodes on canvas.
- [ ] Zoom controls (+ / − / Fit) behave sensibly and don't leave the map oddly cropped.
- [ ] The empty-map state reads inviting, not like an error or a dead end.
      *(Automated for correctness, not tone: `e2e/outline-lockstep.spec.js`.)*

### Node editing
- [ ] The add-node modal's type chips are visually distinct and their colours match the map.
      *(Automated: `e2e/mindmap.spec.js`, `e2e/keyboard.spec.js` check selection and keyboard
      operation; not how the chips look.)*
- [ ] The node detail drawer's fields are legible and the prompts read gentle, not directive.
- [ ] The Trigger pairing nudge reads supportive, not alarming, and doesn't feel like a demand.
      *(Automated: `e2e/mindmap.spec.js`'s "gentle pairing nudge" test checks it appears and
      links correctly; not its tone.)*

### Safety affordances
- [ ] The non-therapy disclaimer is visible without hunting for it, on both viewports.
      *(Automated: `e2e/safety.spec.js`.)*
- [ ] The crisis modal's call/text links read clear and immediate, not clinical.
      *(Automated for presence: `e2e/safety.spec.js`, `e2e/mindmap.spec.js`. Colour contrast on
      this modal has a known, documented `test.fixme` in `e2e/keyboard.spec.js`: see that file's
      comment before re-checking it by hand.)*
- [ ] The grounding modal's breathing guide is genuinely calming to look at (colour, motion,
      pacing), not just present.

### Settings and theming
- [ ] All three themes (light / dark / soft) render every visible surface with readable text and
      no leftover hardcoded colour that ignores the active theme. Check the `map-theme-*` shots
      first; if something looks off there, drive the rest of the app manually under that theme.
      *(Automated: `e2e/features.spec.js` checks the theme attribute gets set and persists; it
      cannot judge whether "soft" actually reads soft rather than washed-out, or whether "dark"
      has a control that's still light-mode-only.)*
- [ ] Font-size scaling doesn't break layout at the largest setting.

### Export and backup
- [ ] The export modal's choices (vault / JSON / text) read clear about what each does.
      *(Automated: `e2e/journeys.spec.js`, `e2e/features.spec.js` check the files that come out
      are correct; not the modal's copy.)*
- [ ] The vault-restore confirmation gate reads appropriately serious for a destructive action,
      without being alarming. *(Automated: `e2e/features.spec.js`.)*

### Keyboard and screen-reader surface
- [ ] Automation here is unusually strong already; this section is mostly a sanity spot-check,
      not a fresh pass. **Fully automated**: tab order reachability, `Enter`/`Space` activation,
      focus-visible rings, the outline's `aria-pressed`/`aria-label` contract, and Escape-closes-
      every-modal, all in `e2e/keyboard.spec.js`; serious/critical axe-core violations across
      every modal and screen, in `e2e/a11y.spec.js` and `e2e/keyboard.spec.js` (two known,
      documented `test.fixme` colour-contrast findings live in `e2e/keyboard.spec.js`; don't
      re-file them).
- [ ] What automation **cannot** judge, and still needs a real pass with a real screen reader
      (NVDA / VoiceOver / TalkBack) occasionally, not every run: whether the announcement order
      makes emotional sense reading through a whole task (not just that *an* announcement fired),
      whether the reading order of the map outline feels sensible to a listener building a mental
      model, and whether anything sounds alarming or clinical when spoken aloud rather than read.
      This is tracked separately as a periodic manual AT audit (ADR-0004, `#36`), not something to
      block a routine tour run on.

### Mobile layout (390x844)
- [ ] Nothing readable is clipped by the viewport edge or the fixed bottom safety bar.
      **Known issue as of this writing**: the `14-whats-new-mobile` shot exists only because the
      tour worked around a real bug to reach it (see "Known issues" below).
- [ ] Modals and drawers are scrollable and don't trap content below the fold with no way to
      reach it.
- [ ] Tap targets (buttons, chips, outline rows) look large enough to hit reliably, not just
      technically clickable.
- [ ] The map canvas is usable at this width: nodes aren't so cramped that panning/zooming
      becomes mandatory just to read one dot.

## Known issues (found by this tour, not fixed by it)

Two real, reproducible issues surfaced while building this checklist. They are recorded here
rather than worked around in the app, per this task's scope; re-verify they're still (or no
longer) present next time you run the tour, and file/update an issue if they aren't already
tracked.

1. **Nodes can overlap and become illegible when the map has more than one disjoint pair.**
   `frontend/js/mindmap.js` runs `cose` with `animate: false, idealEdgeLength: 110,
   nodeRepulsion: 9000`. With four nodes forming two separate connected pairs (no edge between
   the pairs), the layout places them close enough that one node's pill visibly overlaps and
   obscures another's text. Reproduced on both viewports: see `05-map-linked-desktop.png` and
   `05-map-linked-mobile.png` in the tour output ("Step outside and breathe" sits on top of "A
   wave of anger" and partly over "A tight chest"). Not visible in the theme-sweep shots, which
   only ever have a single connected pair plus one isolate: worth confirming whether the trigger
   is specifically *multiple disjoint components* before filing.

2. **The fixed bottom safety bar can cover the footer on narrow viewports, blocking taps.**
   `frontend/css/styles.css` compensates for `.safety-bar { position: fixed; bottom: 0 }`
   wrapping to two rows on narrow screens with a flat `body { padding-bottom: 4rem }` (the CSS
   comment there already flags the wrap; the fixed reserve doesn't flex with it). At 390px wide
   the wrapped bar's real height exceeds that reserve, so the bar visually sits on top of the
   footer and intercepts pointer events meant for it. Reproduced on `#whats-new-btn`: a plain
   Playwright `page.click()` timed out after retries, and even `{ force: true }` still resolved
   to the overlapping safety-bar element rather than the button, meaning a real thumb tap would
   be caught the same way. `e2e/ux-tour.spec.js`'s mobile test documents this in a code comment
   at the "What's new" step and uses a direct DOM `.click()` (bypassing hit-testing, not a real
   user path) only so the tour can still capture that screen. The bug itself is pinned by a
   `test.fixme` in the same file ("Mobile layout regressions"), so once the CSS is fixed that
   test starts passing and can be promoted to a permanent guard, rather than the fix going
   unnoticed because the tour was already green.

## What's already automated vs what needs a human

**Fully automated, don't re-check by hand:**
- Auth/vault flows, recovery, restore-safety gate (`e2e/auth.spec.js`, `e2e/journeys.spec.js`,
  `e2e/features.spec.js`).
- Node CRUD, linking/unlinking/dedupe, the discovery ("possible connections") flow, the pairing
  nudge, story/keyword persistence (`e2e/mindmap.spec.js`, `e2e/journeys.spec.js`).
- Outline-twin/canvas lockstep on every kind of edit (`e2e/outline-lockstep.spec.js`).
- Keyboard-only operability, focus-visible, the outline's ARIA contract, Escape-closes-everything
  (`e2e/keyboard.spec.js`).
- Axe-core serious/critical WCAG 2 A/AA violations on every screen and modal (`e2e/a11y.spec.js`,
  plus the states-not-covered set in `e2e/keyboard.spec.js`).
- Safety affordances reachable pre-login, export file contents, settings persistence, auto-lock
  (`e2e/safety.spec.js`, `e2e/features.spec.js`, `e2e/journeys.spec.js`).

**Genuinely needs a human, every time it's judged, not just once:**
- Whether copy feels gentle and non-directive rather than clinical or bossy (axe-core and text
  assertions check presence/contrast, never tone).
- Whether motion feels calm rather than jarring (`prefers-reduced-motion` compliance is
  structural and testable; the felt pace of the motion that remains is not).
- Whether a colour genuinely reads as soft/calming vs. clinical or alarming (contrast ratios are
  testable; the emotional read of a hue is not).
- Whether the reading/tab order makes emotional sense across a whole task, not just that each
  individual stop is reachable and focus-visible.
- Whether a real screen reader announces a real task sensibly end to end (axe-core checks rules
  against a snapshot; it never plays a real AT session).

Automation here is unusually good in this codebase already (the a11y/keyboard suites are dense).
That is precisely why this document is short on "click every button" and long on the handful of
things that are structurally impossible to assert your way to.

## Report template

Fill this in after a run and keep it with the PR or issue the change belongs to, so runs are
comparable over time.

```
Date:
Branch / commit:
What changed (1-2 lines):
Automated run: PASS / FAIL (<pass count>/<fail count>/<skip count>, e.g. "76/0/8")
Tour screenshots reviewed: yes / no (report link or path)
Checklist sections checked: <list the sections from above you actually walked>
Anything that looked off:
  - <one line + the screenshot filename it's visible in, e.g. "05-map-linked-desktop.png:
    two nodes overlap and their text is unreadable">
Follow-up filed: <issue link, or "none needed">
```

## See also

- `docs/user-stories/first-run-and-map-editing.md`: the narrative example of a completed manual
  pass with screenshots, the thing this document turns into something repeatable.
- `docs/adr/0004-accessibility-as-architecture.md`: why the keyboard/screen-reader section gets
  its own treatment, and what's tracked but not yet done (`#35`, `#36`, `#126`).
