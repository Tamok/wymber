#!/usr/bin/env node
/**
 * Hash every file in the Cloudflare Pages output (dist/) and emit a SHA-384 (SRI-format) manifest
 * (ADR-0003, Layer 1: "a committed manifest of SHA-384 hashes for every shipped asset ... so
 * anyone can confirm wymber.app serves exactly the source in the repo").
 *
 * The manifest is written to two places on purpose:
 *   - dist/integrity-manifest.json, published at web.wymber.app (the app origin), and
 *   - landing/integrity-manifest.json, committed to the repo and published at wymber.app (the
 *     landing origin, a *different* origin from web.wymber.app). Cross-checking the two is
 *     ADR-0003 Layer 1/2: a match is tamper-evidence for the official deploy, not proof either
 *     origin is honest.
 *
 * This module is reusable (scripts/build-pages.mjs imports writeManifest as its final step, so
 * the manifest hashes the HTML actually served, including its build-time SRI injections) and
 * also runnable standalone: `node scripts/integrity-manifest.mjs` builds dist/ first, then writes
 * the manifest.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files that live in dist/ but are not "shipped app assets": _headers is Cloudflare Pages
// config, never fetched by a browser; the manifest obviously can't hash itself.
const EXCLUDE = new Set(['_headers', 'integrity-manifest.json']);

function walk(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            out.push(...walk(full, base));
        } else {
            out.push(relative(base, full));
        }
    }
    return out;
}

function sriHash(bytes) {
    return 'sha384-' + createHash('sha384').update(bytes).digest('base64');
}

/**
 * Walk distDir, hash every non-excluded file, and write the manifest to distDir and to
 * landing/integrity-manifest.json (committed).
 * @param {string} distDir absolute path to the built Pages output (dist/)
 * @param {{ commit: string }} options the resolved build commit (short SHA, or 'dev')
 * @returns {object} the manifest that was written
 */
export function writeManifest(distDir, { commit }) {
    const relPaths = walk(distDir)
        // Normalise Windows backslashes to forward slashes so the manifest is platform-independent.
        .map((p) => p.split(sep).join('/'))
        .filter((p) => !EXCLUDE.has(p))
        .sort();

    const assets = {};
    for (const rel of relPaths) {
        const bytes = readFileSync(join(distDir, ...rel.split('/')));
        assets['/' + rel] = sriHash(bytes);
    }

    const manifest = {
        schema: 1,
        algorithm: 'sha384',
        commit,
        note: "SHA-384 hashes (SRI format: 'sha384-' + base64 digest) of every file served at " +
            "web.wymber.app, generated from and describing the build of the commit named in " +
            "this file's own \"commit\" field above. Compare against the same file published " +
            'from wymber.app (a different origin) to check the deployed app matches the ' +
            'published source. A match is tamper-evidence for the official deploy; it is not ' +
            'proof the origin itself is honest (see docs/adr/0003-client-integrity-and-anti-phishing.md).',
        assets,
    };

    const json = JSON.stringify(manifest, null, 2) + '\n';
    writeFileSync(join(distDir, 'integrity-manifest.json'), json);
    writeFileSync(join(root, 'landing', 'integrity-manifest.json'), json);
    return manifest;
}

function resolveCommitLocal() {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
    try {
        return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
        return 'dev';
    }
}

// Standalone entry point: `node scripts/integrity-manifest.mjs`. Invokes build-pages.mjs as a
// subprocess (not a static/dynamic import: build-pages.mjs itself imports writeManifest from
// this file, so an in-process import here would form a module cycle) to build dist/ first
// (build-pages.mjs already calls writeManifest as its own final step, so this mostly re-confirms
// the same output), then writes the manifest explicitly so this file works standalone.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], { cwd: root, stdio: 'inherit' });
    const manifest = writeManifest(join(root, 'dist'), { commit: resolveCommitLocal() });
    console.log(`[integrity-manifest] wrote ${Object.keys(manifest.assets).length} asset hashes (commit ${manifest.commit})`);
}
