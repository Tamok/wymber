#!/usr/bin/env node
/**
 * Regenerate the `Content-Security-Policy` line in landing/_headers from the inline scripts the
 * landing pages actually ship (ADR-0003, Layer 1).
 *
 * The app gets its CSP hashes computed during scripts/build-pages.mjs, so they can never go stale.
 * The landing has no build step at all, it deploys straight from landing/, so there is nowhere to
 * compute them at deploy time. This script writes them instead, and frontend/tests/csp.test.js
 * recomputes them independently and fails if landing/_headers has drifted. That test is the whole
 * reason a written-down hash is acceptable here: without it, editing an inline script on the
 * landing would silently kill it in production (a blocked inline script throws no error a visitor
 * would ever see, the carousel arrows would just stop responding).
 *
 * Run after editing any inline <script> on the landing: `node scripts/landing-csp.mjs`
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inlineScriptHashes, landingCspHeader } from './csp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const landing = join(root, 'landing');

/** Every inline executable script hash across every landing page, deduped and sorted (stable). */
export function landingScriptHashes() {
    const hashes = new Set();
    for (const file of readdirSync(landing).sort()) {
        if (!file.endsWith('.html')) continue;
        for (const hash of inlineScriptHashes(readFileSync(join(landing, file), 'utf8'))) {
            hashes.add(hash);
        }
    }
    return [...hashes].sort();
}

const HEADERS_PATH = join(landing, '_headers');
const CSP_LINE_RE = /^(\s*)Content-Security-Policy:.*$/m;

/** The policy landing/_headers should contain, derived from the pages. Pure: writes nothing. */
export function expectedLandingCsp() {
    return landingCspHeader(landingScriptHashes());
}

/** Rewrite the CSP line in landing/_headers. Idempotent; returns the policy that is now written. */
export function writeLandingHeaders() {
    const policy = expectedLandingCsp();
    const current = readFileSync(HEADERS_PATH, 'utf8');
    if (!CSP_LINE_RE.test(current)) {
        throw new Error('[landing-csp] no Content-Security-Policy line found in landing/_headers');
    }
    const updated = current.replace(CSP_LINE_RE, `$1Content-Security-Policy: ${policy}`);
    if (updated !== current) writeFileSync(HEADERS_PATH, updated);
    return policy;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
    const policy = writeLandingHeaders();
    const count = landingScriptHashes().length;
    console.log(`[landing-csp] landing/_headers CSP updated (${count} inline script hash${count === 1 ? '' : 'es'})`);
    console.log(`[landing-csp] ${policy}`);
}
