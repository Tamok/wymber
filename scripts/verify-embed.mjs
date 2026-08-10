#!/usr/bin/env node
/**
 * Keep landing/verify.html's embedded copy of the published integrity manifest honest (ADR-0003,
 * Layers 1 and 5: the "verify this client" page's comparator tool needs the manifest data
 * available with zero network requests, since the landing ships `connect-src 'none'` and that
 * does not change for this tool).
 *
 * The landing has no build step, it deploys straight from landing/ (the same reason
 * scripts/landing-csp.mjs writes landing/_headers by hand instead of computing it at deploy
 * time): there is nowhere to fetch landing/integrity-manifest.json from at runtime even if CSP
 * allowed it, so a copy is written directly into the page instead, as a
 * `<script type="application/json" id="wymber-published-manifest">` data block. That type is not
 * one of scripts/csp.mjs's EXECUTABLE_TYPES, so the browser never runs it, CSP never gates it, and
 * it needs no `script-src` hash (see frontend/tests/csp.test.js's "does not carry hashes for data
 * blocks" test; `application/ld+json` already ships this way on every landing page).
 *
 * A written-down copy drifts the moment landing/integrity-manifest.json is republished
 * (`node scripts/integrity-manifest.mjs --publish`) without anyone remembering to also refresh
 * this one. That is what makes writing a copy down acceptable here rather than a hazard:
 * frontend/tests/verify-tool.test.js's Part B fails the suite the instant the embedded text stops
 * matching expectedEmbed(), and the fix is always the one-line command this file's own
 * scripts/integrity-manifest.mjs --publish integration already runs automatically.
 *
 * Run standalone if you ever hand-edit landing/integrity-manifest.json outside --publish (rare):
 * `node scripts/verify-embed.mjs`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(root, 'landing', 'integrity-manifest.json');
const VERIFY_PATH = join(root, 'landing', 'verify.html');

const BLOCK_ID = 'wymber-published-manifest';
const BLOCK_RE = new RegExp(
    `(<script type="application/json" id="${BLOCK_ID}">)([\\s\\S]*?)(<\\/script>)`
);

// How many spaces the embedded JSON's own top-level braces sit at, so it reads as nested content
// inside <section id="verify-tool">'s <script> tag rather than sitting flush left. Matches this
// repo's existing convention for nested markup (see landing/verify.html's .article-callout <div>,
// whose <p> sits two spaces deeper than the div itself).
const JSON_INDENT = 8;
// Where the closing </script> tag's own indentation should land, matching the opening tag.
const CLOSE_INDENT = 6;

// A browser normalizes \r\n and lone \r to \n while tokenizing HTML, before a script's text is
// ever read (see scripts/csp.mjs's normalizeNewlines for the identical rule applied to CSP
// hashing). Comparing on normalized text keeps a CRLF checkout (git core.autocrlf on Windows)
// from reporting drift that was never real.
function normalizeNewlines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function indent(text, spaces) {
    const pad = ' '.repeat(spaces);
    return text.split('\n').map((line) => (line ? pad + line : line)).join('\n');
}

/**
 * The exact text of the embedded manifest data block, pulled out of a verify.html string.
 * Newline-normalized. Returns null if the block is absent.
 * @param {string} html
 * @returns {string | null}
 */
export function embeddedManifestJson(html) {
    const match = normalizeNewlines(html).match(BLOCK_RE);
    return match ? match[2] : null;
}

/**
 * The exact text that should sit inside the data block: landing/integrity-manifest.json,
 * reindented to nest inside verify.html's markup. Pure: reads the manifest, writes nothing.
 * Deterministic, so the drift test (frontend/tests/verify-tool.test.js) is a plain string
 * comparison against embeddedManifestJson().
 * @returns {string}
 */
export function expectedEmbed() {
    const raw = normalizeNewlines(readFileSync(MANIFEST_PATH, 'utf8')).replace(/\n+$/, '');
    return `\n${indent(raw, JSON_INDENT)}\n${' '.repeat(CLOSE_INDENT)}`;
}

/**
 * Rewrite the embedded manifest data block in landing/verify.html to match expectedEmbed().
 * Idempotent: re-running with no manifest change writes nothing.
 * @returns {string} the manifest's `commit` field, for a caller to log
 */
export function writeVerifyEmbed() {
    const commit = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).commit;
    const html = readFileSync(VERIFY_PATH, 'utf8');
    if (!BLOCK_RE.test(html)) {
        throw new Error(
            `[verify-embed] no <script type="application/json" id="${BLOCK_ID}"> block found in landing/verify.html`
        );
    }
    const expected = expectedEmbed();
    const updated = html.replace(BLOCK_RE, (_match, open, _body, close) => `${open}${expected}${close}`);
    if (updated !== html) writeFileSync(VERIFY_PATH, updated);
    return commit;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
    const commit = writeVerifyEmbed();
    console.log(`[verify-embed] landing/verify.html's embedded manifest refreshed (commit ${commit})`);
}
