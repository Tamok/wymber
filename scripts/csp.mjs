#!/usr/bin/env node
/**
 * The app's Content-Security-Policy (ADR-0003, Layer 1: "strict Content-Security-Policy: no
 * inline script, connect-src 'self', pinned sources").
 *
 * `script-src` allows 'self' plus a `sha256-` hash per inline <script> block actually present in
 * the served HTML: the pre-paint theme guard in frontend/index.html's <head>, and (once
 * scripts/build-pages.mjs has injected it) the generated `<script type="importmap">`. The hashes
 * are DERIVED from the exact HTML being served, never hardcoded: a hardcoded hash goes stale the
 * moment anyone edits the inline script, and a stale script-src hash silently breaks it (the
 * theme guard would simply stop running, with no visible error). Deriving from the actual bytes
 * makes staleness structurally impossible, mirroring the reasoning behind the SRI injection this
 * file sits next to (see build-pages.mjs and docs/adr/0003-client-integrity-and-anti-phishing.md).
 *
 * backend/main.py implements the identical rule in Python, independently (hashlib + base64,
 * dependency-free), because the app is served by two different runtimes (this build's
 * Cloudflare Pages output, and FastAPI for self-hosting / the E2E suite). That duplication is
 * intentional: there is no shared runtime to share code through, and each side derives its hash
 * from the HTML *it* actually serves, which is the whole point.
 *
 * `style-src` keeps 'unsafe-inline': the app's <body> uses inline `style="..."` attributes, and
 * hashing every one of those (they vary per element, not per static block) isn't practical the
 * way a handful of <script> blocks are. Script injection, not style injection, is the threat this
 * policy is written against, so that's an accepted, narrow trade-off.
 *
 * `Integrity-Policy-Report-Only: blocked-destinations=(script)` is emitted separately (not part of
 * this CSP string) by whoever calls this module, report-only rather than enforced, because
 * frontend/js/mindmap.js still loads Cytoscape via a classic <script> element with no `integrity`
 * attribute (out of bounds for this change; see frontend/js/build-info.js's integrityFor() for the
 * seam that would unblock enforcing it).
 */
import { createHash } from 'node:crypto';

// Matches every <script ...>...</script> block, capturing its attributes and its exact inner
// text (no added/stripped whitespace) so the hash covers precisely what the browser executes.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * Every inline (no `src=` attribute) <script> block in `html`, hashed as 'sha256-<base64>' of
 * its exact inner text. External <script src="...">, same-origin, is already covered by
 * `script-src 'self'` and needs no hash.
 * @param {string} html
 * @returns {string[]} one hash per inline script block, in document order
 */
export function inlineScriptHashes(html) {
    const hashes = [];
    for (const match of html.matchAll(SCRIPT_RE)) {
        const [, attrs, body] = match;
        if (/\bsrc\s*=/i.test(attrs)) continue; // external script: no inline body to hash
        hashes.push('sha256-' + createHash('sha256').update(normalizeNewlines(body), 'utf8').digest('base64'));
    }
    return hashes;
}

/**
 * The WHATWG HTML spec normalizes newlines while "preprocessing the input stream", BEFORE
 * tokenizing: every `\r\n` and lone `\r` becomes `\n`
 * (https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream). A
 * browser therefore computes a script's CSP hash from LF-only text, even when the bytes on disk
 * (and in this checkout) use CRLF. Git's `core.autocrlf` rewrites this repo's LF blobs to CRLF on
 * a Windows checkout, so hashing the raw file bytes without this normalization computes the
 * WRONG hash there: the CSP would list a hash the browser never produces, and the theme guard
 * (and the importmap script sitting right next to it) would be silently blocked, breaking the
 * app on exactly the platform most people self-host from. backend/main.py normalizes the same
 * way, independently, for the same reason.
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * The app's full Content-Security-Policy header value, as a single semicolon-separated line,
 * with `script-src` hashes derived from the inline <script> blocks actually present in `html`.
 * @param {string} html the exact HTML being served (post any build-time stamping/injection)
 * @returns {string}
 */
export function appCspHeader(html) {
    const scriptSrc = ["'self'", ...inlineScriptHashes(html).map((h) => `'${h}'`)].join(' ');
    return [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
    ].join('; ');
}
