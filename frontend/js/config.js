/**
 * Node colour palettes. "wymber" is the signature palette, designed (not inherited): one
 * hue-lightness slot per type so no two types share both hue family and lightness, anchored on
 * the blue-orange axis that survives most colour-vision deficiencies, with no red-green
 * opposition (trigger is amber: caution without alarm; red would shout). Semantics: earth tones
 * ground what happened (event, place), blues and teal calm (emotion, support), warm corals and
 * roses are human (body, person), the green family restores (coping, growth), violets reflect
 * inward (need, insight). Colour never stands alone: every dot ships with its label (WCAG 1.4.1),
 * and the dark label text keeps >= 4.5:1 on every swatch.
 *
 * Users will pick presets / define their own (the palette feature); colours therefore resolve
 * through typeColor()/setPalette(), persisted in vault settings, never hard-coded at call sites.
 */
export const PALETTES = {
    wymber: {
        event:   "#EDDCB8", // sand: the neutral ground of what happened
        emotion: "#B7D5F0", // sky blue: feelings as weather
        body:    "#F6C2AD", // peach: physical warmth
        person:  "#F3BFD2", // rose: relational warmth
        place:   "#D9CCC3", // taupe: earth, location
        trigger: "#F5DD9A", // amber: caution without alarm
        coping:  "#A9D6AC", // green: steadying
        support: "#A8DAD3", // teal: calm water to lean on
        need:    "#C9C3EE", // lavender-blue: longing
        insight: "#E3BBE9", // orchid: illumination
        growth:  "#D8ECB4", // spring green: new growth
    },
};

let activePalette = { ...PALETTES.wymber };

/** The current colour for a node type. All UI colour lookups go through here. */
export const typeColor = (t) => activePalette[t] || "#cfc7ba";

/**
 * Publish the active palette as CSS custom properties (--type-event, --type-emotion, ...) so
 * styles.css never hard-codes a pastel: it reads var(--type-*) and stays in lockstep with
 * whatever palette is active. Guarded because config.js is also imported by Vitest under the
 * node environment, where `document` doesn't exist.
 */
function publishPaletteVars() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    for (const [type, hex] of Object.entries(activePalette)) {
        root.style.setProperty(`--type-${type}`, hex);
    }
}

/**
 * Activate a palette: a preset name, or a partial { type: '#hex' } map layered over the default
 * (how user-defined palettes will work). Call before rendering; re-render the map after.
 */
export function setPalette(palette) {
    const overrides = typeof palette === "string" ? (PALETTES[palette] || {}) : (palette || {});
    activePalette = { ...PALETTES.wymber, ...overrides };
    publishPaletteVars();
}

// Publish the default palette immediately, so the --type-* tokens exist for CSS before the
// vault unlocks and setPalette() is called with the user's actual settings.
publishPaletteVars();

export const NODE_TYPES = {
    event: {
        color: "#EDDCB8",
        icon: "circle",
        label: "Event",
        description: "Something significant that happened",
        tooltip: "Trauma incidents, flashback memories, or important life events",
        prompt: "Something that happened. Share only as much as feels okay."
    },
    emotion: {
        color: "#B7D5F0",
        icon: "heart",
        label: "Emotion",
        description: "Feelings and emotional states you've experienced",
        tooltip: "Fear, sadness, anger, joy, hope. All feelings are valid",
        prompt: "A feeling that came up. There's no wrong feeling here."
    },
    body: {
        color: "#F6C2AD",
        icon: "activity",
        label: "Body",
        description: "Physical sensations you noticed",
        tooltip: "Tension, calm, a knot in your stomach. What your body felt",
        prompt: "What did you notice in your body? Skip if you'd rather not."
    },
    person: {
        color: "#F3BFD2",
        icon: "user",
        label: "Person",
        description: "Important people in your experiences",
        tooltip: "Family, friends, therapists, or anyone else involved",
        prompt: "Someone connected to this. You can use initials or a nickname."
    },
    place: {
        color: "#D9CCC3",
        icon: "map-pin",
        label: "Place",
        description: "Locations that hold significance for you",
        tooltip: "Somewhere safe, somewhere hard, or any place that matters",
        prompt: "A place that's part of this."
    },
    trigger: {
        color: "#F5DD9A",
        icon: "zap",
        label: "Trigger",
        description: "Things that bring up strong reactions or memories",
        tooltip: "Sights, sounds, situations that activate your trauma response",
        prompt: "Something that brings the feeling back. Want to add a calming anchor too?"
    },
    coping: {
        color: "#A9D6AC",
        icon: "shield",
        label: "Coping",
        description: "Strategies and skills that help you",
        tooltip: "Healthy coping mechanisms, grounding skills, therapeutic practices",
        prompt: "Something that helps you get through. Even small things count."
    },
    support: {
        color: "#A8DAD3",
        icon: "anchor",
        label: "Support",
        description: "Someone or something you can lean on",
        tooltip: "People, places, or practices that help you feel steadier",
        prompt: "Someone or something you can lean on."
    },
    need: {
        color: "#C9C3EE",
        icon: "target",
        label: "Need",
        description: "What you needed, or need now",
        tooltip: "Met or unmet needs that underlie the experience",
        prompt: "What did you need then, or need now?"
    },
    insight: {
        color: "#E3BBE9",
        icon: "lightbulb",
        label: "Insight",
        description: "Realizations and understanding you've gained",
        tooltip: "Patterns you've noticed, connections you've made, wisdom you've developed",
        prompt: "Something you've come to understand. No pressure to have answers."
    },
    growth: {
        color: "#D8ECB4",
        icon: "trending-up",
        label: "Growth",
        description: "Positive changes and progress",
        tooltip: "Ways you've grown, strengths you've developed, progress you've made",
        prompt: "A way you've grown or coped, however small."
    }
};
