# ADR-0004: Accessibility as architecture (the semantic model, focus, live regions, keyboard-first)

- Status: Accepted (2026-06-08)
- Decider: [@tamok](https://github.com/tamok)

## Context

Wymber's users include people in distress, on low vision, with motor differences, or on assistive
tech, and they are first-class users, not an edge case. Accessibility here is also load-bearing for
the product's ethics: a privacy-first tool that a screen-reader user cannot operate has quietly
excluded exactly the people most likely to need a private place to put hard things.

So we treat a11y as **structure decided up front**, not a WCAG pass bolted on at the end. Two facts
force the issue:

- **The map draws to `<canvas>`.** Cytoscape renders the graph to a canvas element, which is
  **invisible to assistive technology** ([[ADR-0002]] spike finding 3). A free-form graph is already
  far harder for a screen reader than a tree; a canvas one is simply unreadable. There is no ARIA you
  can sprinkle on a canvas to fix this.
- **There is no server to lean on.** Every surface, including the unlock flow that gates all the
  data, is client-rendered. If the client isn't accessible, nothing is.

This ADR records the model we already ship (issue #34 closed on it), so future work extends a
decided architecture instead of re-litigating it. WCAG 2.1 AA is the floor, not the design.

## Decision

Accessibility is expressed as four standing commitments. Each is a rule about *how surfaces are
built*, enforced in code today, not a checklist to revisit per feature.

### 1. Semantic model: the canvas has a non-visual twin that is the real surface

The map ships with a parallel **outline/list view** (`#map-outline`, "Your map as a list") that is
**not a fallback, it is the primary a11y surface**, kept in lockstep with the graph. Both the canvas
and the list read the **same node/edge model** (single source of truth), so they cannot drift.

- Every node is a `<button>` in the list, carrying its type and title, its connections in plain text
  ("Connected to: X, Y"), and selection state via `aria-pressed`.
- The button's accessible name **changes with mode**: in Link mode it reads "…Choose to connect," in
  normal mode "…Select." The interaction model is legible without seeing the canvas.
- Selecting, editing, and **creating links** all work from the list. Keyboard link-creation is
  proven, not aspirational ([[ADR-0002]] spike).
- The canvas is `role="application"` with a descriptive label and is focusable, but it is never the
  *only* way to reach anything. Decorative bits (`#breathing-orb`, type chips) are `aria-hidden`.

Rule going forward: **if a feature touches the graph, it lands in the outline twin in the same PR.**
A canvas-only feature is, by definition, an inaccessible feature.

### 2. Focus model: one visible ring, suppressed for mice, and `inert` for what's offscreen

- A single global focus treatment (`*:focus` → `--focus` outline + `--focus-ring`), **suppressed for
  pointer users** via `:focus:not(:focus-visible)` and kept crisp for keyboard users with explicit
  `:focus-visible` rules on every interactive control. Focus is always visible to the people who
  navigate by it.
- **Opening a surface moves focus into it** (the detail drawer focuses its title field; modals focus
  their first field) so keyboard and SR users are placed where the action is, not stranded at the top
  of the page.
- The node detail drawer is marked **`inert` while closed**, so it is removed from the tab order and
  the accessibility tree entirely until it slides in. No phantom focus stops.
- **Escape closes any open overlay from anywhere, even mid-typing in a field**, and returns focus to
  a sensible anchor. Predictable exit is a trauma-informed requirement, not just an a11y nicety.

### 3. Live regions: state changes are announced, quietly and atomically

Graph edits and status changes are spoken without stealing focus:

- A shared `announceToScreenReader()` injects an ephemeral `sr-only` `aria-live="polite"`
  `aria-atomic="true"` node and removes it after a beat. It announces selection, add/remove,
  **"Connected A to B"**, **"Unlinked A and B"**, and "already connected."
- Standing live regions cover the rest: password-strength (`aria-live="polite"`), the breathing
  guide during grounding, toast notifications (`role="status"`), and form errors (`role="alert"`).
- `polite`, never `assertive`, by default: announcements wait their turn rather than interrupting,
  consistent with "no jarring anything."

### 4. Keyboard-first: every path works with no pointer

The pointer is an enhancement, not a requirement. The whole app is operable from the keyboard, and
the shortcuts are surfaced in the footer (`Ctrl+N` new, `Delete` remove, `Tab` navigate, `Esc`
close). The outline twin (pillar 1) is what makes the *map specifically* keyboard-operable; the rest
of the app is ordinary, fully tabbable HTML controls by construction (no custom widgets that trap or
swallow keys).

### Cross-cutting: a11y lives in design tokens, not per-component patches

Contrast, focus, motion, and sizing are **tokens**, so accessibility is inherited rather than
re-implemented: the `--focus` / `--focus-ring` ring, three themes (`light` / `dark` / `soft`, where
`soft` is a deliberately lower-contrast, low-stimulation palette), a user font-size scale
(`[data-font-size]`), an `.sr-only` utility, and a global `prefers-reduced-motion` block that
collapses every transition and animation to ~0ms (the gentle 0.3s motion is itself opt-out). The
formal token/contrast-AA work is tracked separately in #35.

## What ships today vs what's tracked

- **Shipped (this ADR documents it):** the outline twin + keyboard link-creation, focus model,
  live-region announcements, reduced-motion, themes, font scaling. Closed #34 on this basis.
- **Tracked, not yet done:**
  - #126, native arrow-key navigation **on the canvas layer itself**. An *enhancement*, because
    keyboard/SR users already have a complete path through the outline twin; the canvas is the nicety,
    the list is the guarantee.
  - #35, contrast (AA) / focus-visible / reduced-motion formalized as audited design tokens.
  - #36, a manual AT audit (NVDA / VoiceOver / TalkBack) of the core journeys. Automated checks and a
    hand-built semantic model are necessary but not sufficient; real AT on real journeys is the proof.

These are the open children of the accessibility epic #37.

## Consequences

- "Definition of done" for any graph feature now includes its outline-twin behaviour and its
  announcement. Reviewers can reject a canvas-only change on architectural grounds.
- The single node/edge source of truth is a hard constraint, not a convenience: two renderers
  (canvas + list) depend on it never forking.
- New a11y affordances should be added as **tokens/utilities** first, so they propagate, rather than
  as one-off styles.
- No part of this adds network traffic or telemetry; every surface stays local-by-construction
  ([[ADR-0001]]).

## Alternatives considered

- **Make the `<canvas>` itself screen-reader accessible** (ARIA over canvas, off-DOM hit regions):
  canvas has no meaningful native semantics, and hand-maintaining a shadow accessibility tree on top
  of it is more fragile than maintaining one honest list. Rejected in favour of the outline twin as
  the *primary* surface.
- **Treat the list as a secondary "accessibility mode" toggle.** A separate-but-equal mode rots,
  because sighted developers don't exercise it. Keeping the list always-present and always-in-sync is
  what keeps it correct. Rejected.
- **Defer a11y to a post-launch hardening pass.** This is the failure mode the whole ADR exists to
  prevent: retrofitting semantics onto a canvas-first map is a rebuild, not a patch. Rejected.
- **Ship `aria-live="assertive"` for edits** so nothing is missed: interrupts the user mid-thought,
  the opposite of trauma-informed. Rejected in favour of `polite`.
