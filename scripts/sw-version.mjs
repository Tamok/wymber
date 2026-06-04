#!/usr/bin/env node
/**
 * Derive the service-worker cache VERSION from a content hash of the cached shell files, so it
 * changes automatically whenever the shell changes, and never when it doesn't. This removes the
 * "remember to bump sw.js VERSION" footgun: the pre-commit hook runs this and re-stages sw.js.
 *
 * Single source of truth: the CORE list inside frontend/sw.js (the files the SW caches). sw.js
 * itself is never hashed (it isn't cached, and that would be a feedback loop). Run manually with
 * `node scripts/sw-version.mjs`; it's idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'frontend', 'sw.js');
if (!existsSync(swPath)) {
    console.log('[sw-version] no frontend/sw.js, skipping');
    process.exit(0);
}

const sw = readFileSync(swPath, 'utf8');

// Pull the cached URLs straight out of the CORE array so the list never drifts.
const coreMatch = sw.match(/const CORE = \[([\s\S]*?)\];/);
const urls = coreMatch ? [...coreMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

const urlToPath = (url) => {
    if (url === '/') return join(root, 'frontend', 'index.html');
    if (url === '/manifest.webmanifest') return join(root, 'frontend', 'manifest.webmanifest');
    if (url.startsWith('/static/')) return join(root, 'frontend', url.slice('/static/'.length));
    return null;
};

const hash = createHash('sha256');
let counted = 0;
for (const url of urls) {
    const p = urlToPath(url);
    if (p && existsSync(p)) {
        hash.update(url + '\0');
        hash.update(readFileSync(p)); // bytes, so binary assets (icons) hash too
        counted += 1;
    } else {
        console.warn(`[sw-version] WARNING: CORE lists ${url} but no file was found`);
    }
}

if (counted === 0) {
    console.warn('[sw-version] no shell files found, leaving VERSION untouched');
    process.exit(0);
}

const version = `wymber-shell-${hash.digest('hex').slice(0, 12)}`;
const updated = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);

if (!/const VERSION = '[^']*';/.test(sw)) {
    console.warn('[sw-version] could not find a VERSION line to update');
    process.exit(0);
}

if (updated !== sw) {
    writeFileSync(swPath, updated);
    console.log(`[sw-version] VERSION -> ${version} (over ${counted} shell files)`);
} else {
    console.log(`[sw-version] VERSION already current (${version})`);
}
