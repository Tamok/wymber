# ADR-0002: Graph model + discovery engine (own the taxonomy, rent the renderer)

- Status: Accepted (2026-06-01), renderer selection pending the spike in this PR
- Decider: [@tamok](https://github.com/tamok)

## Context

Wymber currently renders the map with MindElixir.js, a **tree** library (one root, branches
out). But trauma isn't a tree. The lived structure is a **web**: an event anchors several
emotions; a trigger reactivates an old event; a coping skill answers a trigger; one person
appears in many places. The product's core value isn't drawing a neat hierarchy, it's helping
someone **discover a connection they hadn't seen yet** ("oh… those *are* linked"), and only then
make it real.

Two facts about the current code matter:

- The data is **already graph-native**: the vault stores `nodes[]` + `edges[]` (arbitrary
  node-to-node). MindElixir is a *lossy tree view* over that graph:
  `convertToMindElixirFormat()` picks `nodes[0]` as a root, flattens the rest into children, and
  overlays the real edges as decorative links. A tree literally cannot draw "anything links to
  anything." This is *why* the tree feels wrong.
- Because the data is graph-native, replacing the renderer is a **view change, not a data
  migration.** Nothing in the vault moves.

## Decision

Wymber's map is a **graph**, and its differentiator is a **discovery engine** driven by a
**hidden relationship taxonomy**. We split the system into two layers with deliberately opposite
build/buy answers.

### Layer 1, The semantic layer (we OWN this; it's the moat)

A **hidden taxonomy** models how the eight node types *tend* to relate (events anchor emotions;
triggers reactivate events and call for coping; insight/growth emerge from the rest). From it a
**discovery engine** surfaces **suggested links**, "this trigger and this emotion often go
together; connect them?", that the user confirms or dismisses. No library provides this; it is
ours regardless of how we draw pixels.

- **Now:** rule-based suggestions (typed heuristics + simple graph signals like shared neighbours
  / co-occurrence). Deterministic, explainable, and nothing leaves the device.
- **Later:** the same `suggestLinks(graph)` seam is where **on-device AI** plugs in, it reads the
  locally-decrypted text and proposes content-aware connections. Privacy holds because inference
  is local (consistent with [[ADR-0001]]).
- Suggestions are **always opt-in and reversible.** A suggested link is a *question*, never an
  automatic edit, trauma-informed: the user stays in control of their own meaning-making.

### Layer 2, The rendering layer (we RENT this; it's plumbing)

Graph layout, hit-testing, pan/zoom, and performance at scale are solved problems and *not* a
differentiator. Building a renderer from scratch is a tar pit (layout math, perf, and especially
accessibility). We render on top of a proven engine that we **skin** into Wymber's gentle
"building-blocks" look, rather than owning the math.

- **Candidate: Cytoscape.js**, graph-native, fully stylable, vanilla/buildless (fits the no-build
  frontend), and ships graph-analysis primitives the discovery engine can reuse.
- **Renderer selection is pending the spike in this PR** (below). Fallback if it fails the *feel*
  test: a thin custom renderer over SVG + a force layout (e.g. d3-force), but we only earn that
  cost if a library provably can't deliver the experience.

### Non-negotiable constraints on the renderer choice

- **Accessibility is a selection criterion, not a follow-up** (consistent with our standing
  position that a11y is architecture). A free-form graph is far harder for a screen reader than a
  tree, so the map **must** ship with a parallel **non-visual representation**, an outline/list
  view plus **keyboard link-creation**, from day one. A library that can't support an accessible
  alternate view is disqualified.
- **Trauma-informed by construction.** A dense web can overwhelm, and visual overload is
  dysregulating. Calm by default: progressive disclosure (reveal connections gently, don't dump
  the whole web at once), no bouncing physics or jarring auto-layout, soft "cute" building-block
  nodes. The gentle look is a *safety feature*, not decoration.

## The spike (this PR)

A throwaway exploration under `spikes/graph-cytoscape/` that answers exactly three questions,
nothing more:

1. **Feel:** can Cytoscape be skinned to look *gentle / cute* (rounded soft "blocks", pastel
   type-colours), not a clinical network diagram?
2. **Discovery:** can we render a **suggested** link visibly distinct from a **real** one
   (dashed / ghost), and let a click promote suggestion → real edge?
3. **Accessibility:** can we stand up a parallel **outline view** + a **keyboard** path to create a
   link, proving the non-visual representation is reachable?

Pass → adopt Cytoscape for the v2 map. Fail the *feel* test specifically → fall back to the
custom-SVG route. Findings are recorded at the bottom of this ADR.

## Sequencing (low overhead, don't block alpha)

- **Alpha ships on MindElixir, untouched.** The data is already graph-native, so the swap is
  deferred at zero data cost.
- The **graph + discovery is the "v2 map"**: design now (this ADR + spike), build after alpha
  validates the core loop. No premature rebuild.

## Consequences

- A new `suggestLinks()` / taxonomy module becomes a first-class owned asset and the future AI seam.
- The map view becomes swappable behind the existing `api.js` / vault seam; MindElixir stays until
  the graph renderer is ready.
- Accessibility work (outline view + keyboard linking) is pulled into the renderer's definition of
  done, not bolted on.

## Alternatives considered

- **Keep MindElixir as the long-term map** (tree): cannot represent arbitrary links, so it cannot
  express the core "web you discover" model. Fine for alpha, wrong for v2. Rejected as the endpoint.
- **Build a fully custom graph renderer now**: maximal control over the "cute" feel, but
  re-implements solved layout / perf / a11y work that isn't our differentiator. Held as the
  fallback *only if* the spike proves a library can't deliver the felt experience.
- **Automatic AI-created links** (no confirmation step): faster, but it takes meaning-making away
  from the user and risks asserting a connection that isn't theirs, anti-trauma-informed.
  Rejected; suggestions stay opt-in.

## Spike findings

**Verdict: PASS on all three questions. Adopt Cytoscape.js for the v2 map** (no custom-SVG
fallback needed, the feel test passed). Driven through a browser end-to-end; screenshots in
`spikes/graph-cytoscape/`.

1. **Feel, ✓.** `round-rectangle` nodes + the real pastel type-colours on a warm canvas read as
   gentle "building blocks," not a clinical network diagram. Fully controllable through Cytoscape's
   style array; no fighting the library to get there.
2. **Discovery, ✓.** Suggested links render as dashed, muted-purple edges, clearly distinct from
   solid real links. Tapping an edge *or* pressing the outline button promotes suggestion → real
   through one shared `promote()` path; both the graph and the outline update together because both
   read the same node/edge model.
3. **Accessibility, ✓.** As expected, Cytoscape draws to `<canvas>`, which is invisible to
   assistive tech, so the **outline twin is mandatory, and it is sufficient**: the first Tab lands
   on the suggestion button (visible focus ring), Enter confirms, and an `aria-live` region
   announces "Connected A to B." Keyboard link-creation is proven, not aspirational.

**Carry into the real build:**
- The `<canvas>` has no native a11y, so the outline view is **not optional**, it is the primary
  a11y surface and must stay in lockstep with the graph. Keep a single source of truth (the
  node/edge model), as the spike does.
- `width/height: 'label'` is deprecated in current Cytoscape, switch to explicit/auto node
  sizing. The custom wheel-sensitivity warning is cosmetic.
- Footprint: `cytoscape.min.js` ≈ 424 KB minified, buildless. Acceptable; lazy-load it with the
  map view rather than on first paint.

**Net:** rent Cytoscape for rendering; the taxonomy, `suggestLinks()`, and the outline twin are
ours to build.
