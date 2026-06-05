#!/usr/bin/env node
/**
 * Assemble the Cloudflare Pages output for the Wymber app into dist/.
 *
 * The app is fully static (local-first; the FastAPI server only serves files). This mirrors that
 * layout for Pages: index.html + sw.js + manifest at the root, everything else under /static, plus
 * a _headers file so the service worker keeps its root scope and the manifest gets the right MIME.
 * No /api is needed (the vault is client-side). Run: node scripts/build-pages.mjs
 */
import { rmSync, mkdirSync, cpSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'static'), { recursive: true });

// Root files (served from / by backend/main.py; same paths here).
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
    copyFileSync(join(frontend, f), join(dist, f));
}
// Everything the app references as /static/...
for (const d of ['css', 'js', 'libs', 'icons']) {
    cpSync(join(frontend, d), join(dist, 'static', d), { recursive: true });
}
copyFileSync(join(frontend, 'favicon.svg'), join(dist, 'static', 'favicon.svg'));
copyFileSync(join(frontend, 'og-image.png'), join(dist, 'static', 'og-image.png'));

// Cloudflare Pages headers: keep the SW's root scope + correct manifest MIME.
writeFileSync(join(dist, '_headers'), [
    '/sw.js',
    '  Service-Worker-Allowed: /',
    '  Cache-Control: no-cache',
    '/manifest.webmanifest',
    '  Content-Type: application/manifest+json',
    '',
].join('\n'));

console.log('[build-pages] wrote dist/ (index.html, sw.js, manifest.webmanifest, _headers, static/)');
