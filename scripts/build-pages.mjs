#!/usr/bin/env node
/**
 * Assemble the Cloudflare Pages output for the Wymber app into dist/, then make it verifiable
 * (ADR-0003, Layer 1): stamp the build indicator, inject Subresource Integrity into index.html
 * for every script/style (plus an integrity import map for ES-module imports, which can't carry
 * an `integrity` attribute), and publish a SHA-384 hash manifest of everything shipped.
 *
 * The app is fully static (local-first; the FastAPI server only serves files). This mirrors that
 * layout for Pages: index.html + sw.js + manifest at the root, everything else under /static, plus
 * a _headers file so the service worker keeps its root scope and the manifest gets the right MIME.
 * No /api is needed (the vault is client-side). Run: node scripts/build-pages.mjs
 *
 * Reproducibility: run this twice from the same commit and dist/ must come out byte-identical.
 * No timestamps, no Date.now(), no randomness, no hash-order-dependent iteration. The only
 * external input is the git commit SHA, a declared build input like any source revision.
 */
import { rmSync, mkdirSync, cpSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { writeManifest } from './integrity-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'static'), { recursive: true });

// Root files (served from / by backend/main.py; same paths here). 404.html makes Pages serve
// real 404s instead of SPA-fallbacking every path to the shell (soft-404s, #139); robots.txt
// states the crawl posture (citation welcome, no AI training).
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', '404.html']) {
    copyFileSync(join(frontend, f), join(dist, f));
}
cpSync(join(frontend, '.well-known'), join(dist, '.well-known'), { recursive: true });
// Everything the app references as /static/...
for (const d of ['css', 'js', 'libs', 'icons']) {
    cpSync(join(frontend, d), join(dist, 'static', d), { recursive: true });
}
copyFileSync(join(frontend, 'favicon.svg'), join(dist, 'static', 'favicon.svg'));
copyFileSync(join(frontend, 'og-image.png'), join(dist, 'static', 'og-image.png'));

// Cloudflare Pages headers: keep the SW's root scope + correct manifest MIME, and baseline
// security headers (the strict CSP is #112; frame-ancestors here blocks clickjacking now).
writeFileSync(join(dist, '_headers'), [
    '/*',
    '  X-Frame-Options: DENY',
    "  Content-Security-Policy: frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/sw.js',
    '  Service-Worker-Allowed: /',
    '  Cache-Control: no-cache',
    '/manifest.webmanifest',
    '  Content-Type: application/manifest+json',
    '/.well-known/security.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '',
].join('\n'));

// --- ADR-0003 Layer 1: make this build verifiable -------------------------------------------

function sriHash(bytes) {
    return 'sha384-' + createHash('sha384').update(bytes).digest('base64');
}

// (a) Resolve the commit this build represents: CI sets GITHUB_SHA; a local checkout falls back
// to `git rev-parse`; either failure mode (no git, detached/shallow clone) degrades to the
// honest 'dev' placeholder rather than failing the build.
function resolveCommit() {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
    try {
        return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
        return 'dev';
    }
}
const commit = resolveCommit();

// (a) Stamp frontend/js/build-info.js's committed 'dev' placeholder with the real commit. A
// silent no-op here would ship a build indicator that lies about being unstamped, so assert the
// placeholder was actually there before rewriting it.
const buildInfoPath = join(dist, 'static', 'js', 'build-info.js');
let buildInfoSrc = readFileSync(buildInfoPath, 'utf8');
if (!buildInfoSrc.includes("commit: 'dev'")) {
    throw new Error('[build-pages] build-info.js: "commit: \'dev\'" placeholder not found, refusing to ship an unstamped build indicator');
}
if (!buildInfoSrc.includes("origin: 'source'")) {
    throw new Error('[build-pages] build-info.js: "origin: \'source\'" placeholder not found, refusing to ship an unstamped build indicator');
}
buildInfoSrc = buildInfoSrc
    .replace("commit: 'dev'", `commit: '${commit}'`)
    .replace("origin: 'source'", "origin: 'build'");
writeFileSync(buildInfoPath, buildInfoSrc);

// (b)-(d) rewrite dist/index.html: stamp the build meta tag, inject SRI on the stylesheet + the
// module entrypoint, and inject an integrity import map for every other ES module (a <script>
// tag can carry an `integrity` attribute, but a bare `import` statement inside a module cannot;
// browsers that support import-map integrity check those imports against this map, browsers that
// don't simply ignore the unrecognised "integrity" key).
const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf8');

// (b) Build meta tag. Assert the placeholder matched before replacing it.
const metaNeedle = '<meta name="wymber-build" content="dev">';
if (!html.includes(metaNeedle)) {
    throw new Error('[build-pages] index.html: wymber-build meta placeholder not found, refusing to ship an unstamped build indicator');
}
html = html.replace(metaNeedle, `<meta name="wymber-build" content="${commit}">`);

// (c) Targeted, asserted SRI injection. Locates each tag by its exact source markup (no other
// attributes yet) and throws if it isn't found verbatim, which also catches "already has an
// integrity attribute" (that would change the markup, so the exact-match lookup would fail).
// Injected at build time, not committed: there is no content-hashing build step here, so a
// committed integrity attribute would silently break the site the moment any contributor edits
// styles.css or app.js. Hashing the bytes actually in dist/ makes staleness impossible.
function injectSri(source, tagNeedle, hash, label) {
    if (!source.includes(tagNeedle)) {
        throw new Error(`[build-pages] index.html: expected ${label} tag not found (markup changed, or it already has an integrity attribute): ${tagNeedle}`);
    }
    const withIntegrity = tagNeedle.replace('>', ` integrity="${hash}" crossorigin="anonymous">`);
    return source.replace(tagNeedle, withIntegrity);
}

const cssHash = sriHash(readFileSync(join(dist, 'static', 'css', 'styles.css')));
html = injectSri(html, '<link rel="stylesheet" href="/static/css/styles.css">', cssHash, 'stylesheet');

const appJsHash = sriHash(readFileSync(join(dist, 'static', 'js', 'app.js')));
html = injectSri(html, '<script type="module" src="/static/js/app.js"></script>', appJsHash, 'module entrypoint');

// (d) Integrity import map, covering every .js file under static/js/ and static/libs/, keys
// sorted for determinism. Must appear before the first module script; </head> satisfies that
// since the module entrypoint is in <body>.
function collectJsFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...collectJsFiles(full));
        else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
}
const jsFiles = [join(dist, 'static', 'js'), join(dist, 'static', 'libs')].flatMap(collectJsFiles);
const importMapIntegrity = {};
for (const full of jsFiles) {
    const url = '/' + relative(dist, full).split(sep).join('/');
    importMapIntegrity[url] = sriHash(readFileSync(full));
}
const sortedIntegrity = Object.fromEntries(Object.keys(importMapIntegrity).sort().map((k) => [k, importMapIntegrity[k]]));
const importMapTag = `<script type="importmap">${JSON.stringify({ integrity: sortedIntegrity })}</script>`;

const headCloseNeedle = '</head>';
if (!html.includes(headCloseNeedle)) {
    throw new Error('[build-pages] index.html: </head> not found, cannot inject the integrity import map');
}
html = html.replace(headCloseNeedle, `${importMapTag}\n${headCloseNeedle}`);

writeFileSync(indexPath, html);

// (e) Write the manifest last, so /index.html's hash covers the HTML actually served (post
// stamping + SRI + import-map injection above). This writes dist/integrity-manifest.json only
// (served from web.wymber.app). The committed landing/integrity-manifest.json is the release
// snapshot served from wymber.app, a different origin, and is refreshed deliberately with
// `node scripts/integrity-manifest.mjs --publish`: a tracked file whose commit field churns on
// every build would leave a dirty tree after an ordinary build or test run.
const manifest = writeManifest(dist, { commit });

console.log(`[build-pages] wrote dist/ (index.html + SRI + import-map, sw.js, manifest.webmanifest, _headers, static/) and integrity-manifest.json (${Object.keys(manifest.assets).length} assets, commit ${commit})`);
