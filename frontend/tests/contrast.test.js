import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { relativeLuminance, contrastRatio } from '../js/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '../css/styles.css');

const HEX_RE = /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/;
const VAR_REF_RE = /^var\(--([\w-]+)\)$/;

/** Pull the custom-property declarations out of a single top-level CSS block's body. */
function parseCustomProps(blockBody) {
    const props = {};
    const re = /--([\w-]+):\s*([^;]+);/g;
    let m;
    while ((m = re.exec(blockBody))) {
        props[m[1]] = m[2].trim();
    }
    return props;
}

/**
 * Extract a top-level block's body by selector, e.g. ':root' or '[data-theme="dark"]'.
 * Anchored to the start of a line (no leading whitespace) so nested blocks with the same
 * selector inside a @media query (the reduced-motion token collapse) are not picked up.
 */
function extractBlock(css, selectorPattern) {
    const re = new RegExp(`^${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const match = css.match(re);
    if (!match) throw new Error(`Could not find a top-level "${selectorPattern}" block in styles.css`);
    return match[1];
}

/** Resolve var(--x) references against an already-merged theme token map. */
function resolveVar(value, themeVars, depth = 0) {
    const ref = VAR_REF_RE.exec(value);
    if (!ref) return value;
    if (depth > 5) throw new Error(`var() reference cycle resolving ${value}`);
    const next = themeVars[ref[1]];
    if (next === undefined) throw new Error(`--${ref[1]} referenced by var() but never defined`);
    return resolveVar(next, themeVars, depth + 1);
}

let themes;

beforeAll(() => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const rootRaw = parseCustomProps(extractBlock(css, ':root'));
    const darkRaw = parseCustomProps(extractBlock(css, '\\[data-theme="dark"\\]'));
    const softRaw = parseCustomProps(extractBlock(css, '\\[data-theme="soft"\\]'));

    // Real CSS custom-property cascade: a theme block only overrides what it declares, and
    // inherits the rest from :root. Merge, then resolve any var(--x) aliases (e.g. --focus).
    const build = (overrides) => {
        const merged = { ...rootRaw, ...overrides };
        const resolved = {};
        for (const key of Object.keys(merged)) resolved[key] = resolveVar(merged[key], merged);
        return resolved;
    };

    themes = {
        light: build({}),
        dark: build(darkRaw),
        soft: build(softRaw),
    };
});

describe('contrastRatio / relativeLuminance (frontend/js/utils.js)', () => {
    it('white vs black is the maximum ratio, 21:1', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    });

    it('a colour against itself is 1:1 (no contrast)', () => {
        expect(contrastRatio('#5F5185', '#5F5185')).toBeCloseTo(1, 5);
        expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    });

    it('is order-independent', () => {
        expect(contrastRatio('#123456', '#fafafa')).toBeCloseTo(contrastRatio('#fafafa', '#123456'), 10);
    });

    it('relativeLuminance: black is 0, white is 1', () => {
        expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    });
});

// Every pair the stylesheet actually renders: a foreground token used as text (or a UI
// boundary like the focus ring / strength-meter fill) against the background token it sits on
// in real markup. 'text' pairs must clear 4.5:1 (WCAG 1.4.3), 'ui' pairs must clear 3:1
// (WCAG 1.4.11 non-text contrast). Reused across all three themes so a regression in any one
// theme's token values fails here instead of shipping.
const PAIRS = [
    // Body copy: the most-used pairs in the whole app, so they are checked first.
    { fg: 'text-primary', bg: 'bg-primary', role: 'text', why: 'body copy on the page background' },
    { fg: 'text-primary', bg: 'bg-secondary', role: 'text', why: 'body copy on card backgrounds' },
    { fg: 'text-secondary', bg: 'bg-primary', role: 'text', why: 'secondary copy (hints, notes) on the page background' },
    { fg: 'text-secondary', bg: 'bg-secondary', role: 'text', why: 'secondary copy on card backgrounds' },

    { fg: 'accent', bg: 'bg-primary', role: 'text', why: 'links/active borders on the page background' },
    { fg: 'accent', bg: 'bg-secondary', role: 'text', why: 'links/active borders on card backgrounds' },
    { fg: 'accent-hover', bg: 'bg-primary', role: 'text', why: 'a hovered link on the page background' },
    { fg: 'accent-hover', bg: 'bg-secondary', role: 'text', why: 'a hovered link on card backgrounds' },
    { fg: 'accent-on-surface', bg: 'accent-surface', role: 'text', why: 'label on a filled primary button, and .crisis-bar text/links (#107)' },
    { fg: 'accent-on-surface', bg: 'accent-surface-hover', role: 'text', why: 'label on a hovered primary button' },
    { fg: 'danger-text', bg: 'bg-primary', role: 'text', why: '.save-indicator.error, .btn-text-danger' },
    { fg: 'danger-text', bg: 'bg-secondary', role: 'text', why: 'danger text on card backgrounds' },
    { fg: 'danger-text', bg: 'danger-soft', role: 'text', why: '.error-message, .notification-error' },
    { fg: 'danger-on-surface', bg: 'danger-surface', role: 'text', why: '.btn-danger label on its fill' },
    { fg: 'success-text', bg: 'bg-primary', role: 'text', why: '.save-indicator' },
    { fg: 'success-text', bg: 'success-soft', role: 'text', why: '.notification-success' },
    { fg: 'warning-text', bg: 'bg-primary', role: 'text', why: '.save-indicator.saving' },
    { fg: 'warning-text', bg: 'bg-secondary', role: 'text', why: '.save-indicator.saving on a card' },
    { fg: 'strength-1', bg: 'border', role: 'ui', why: 'the weak password-strength fill vs its own track' },
    { fg: 'strength-2', bg: 'border', role: 'ui', why: 'the fair password-strength fill vs its own track' },
    { fg: 'strength-3', bg: 'border', role: 'ui', why: 'the good password-strength fill vs its own track' },
    { fg: 'strength-4', bg: 'border', role: 'ui', why: 'the strong password-strength fill vs its own track' },
    { fg: 'focus-ring-color', bg: 'bg-primary', role: 'ui', why: 'the focus ring vs the page background (SC 1.4.11)' },
    { fg: 'focus-ring-color', bg: 'bg-secondary', role: 'ui', why: 'the focus ring vs card backgrounds (SC 1.4.11)' },
];

const THRESHOLD = { text: 4.5, ui: 3 };

describe.each(['light', 'dark', 'soft'])('theme "%s": token contrast (frontend/css/styles.css)', (themeName) => {
    it('every text/UI pair clears its WCAG threshold', () => {
        const vars = themes[themeName];
        for (const { fg, bg, role, why } of PAIRS) {
            const fgVal = vars[fg];
            const bgVal = vars[bg];
            expect(fgVal, `--${fg} is not defined in the "${themeName}" theme (needed for ${why})`).toBeDefined();
            expect(bgVal, `--${bg} is not defined in the "${themeName}" theme (needed for ${why})`).toBeDefined();
            expect(fgVal, `--${fg}: ${fgVal} is not a resolvable hex colour in "${themeName}"`).toMatch(HEX_RE);
            expect(bgVal, `--${bg}: ${bgVal} is not a resolvable hex colour in "${themeName}"`).toMatch(HEX_RE);

            const ratio = contrastRatio(fgVal, bgVal);
            const threshold = THRESHOLD[role];
            expect(
                ratio,
                `[${themeName}] --${fg} (${fgVal}) on --${bg} (${bgVal}) = ${ratio.toFixed(2)}:1, ` +
                `needs >= ${threshold}:1 (${why})`
            ).toBeGreaterThanOrEqual(threshold);
        }
    });
});
