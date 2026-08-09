import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
    readFileSync, writeFileSync, existsSync, statSync, openSync, closeSync, unlinkSync, cpSync, rmSync, mkdtempSync,
    readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { integrityFor } from '../js/build-info.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');

// scripts/build-pages.mjs starts by rm-ing then rebuilding dist/. This file and
// integrity-manifest.test.js both trigger that build in their own beforeAll, and Vitest may run
// separate test files concurrently in different workers, so guard the (rm + rebuild) with a
// simple cross-process file lock: without it, one worker could read dist/ mid-rebuild by another.
const BUILD_LOCK = join(tmpdir(), 'wymber-dist-build.lock');

function withBuildLock(fn) {
    const deadline = Date.now() + 60000;
    let fd;
    for (;;) {
        try {
            fd = openSync(BUILD_LOCK, 'wx');
            break;
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
            if (Date.now() > deadline) throw new Error('[csp.test] timed out waiting for the dist/ build lock');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
    }
    try {
        return fn();
    } finally {
        closeSync(fd);
        try { unlinkSync(BUILD_LOCK); } catch (_) { /* already gone */ }
    }
}

function runBuild() {
    withBuildLock(() => {
        execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], { cwd: root, stdio: 'pipe' });
    });
}

function sha256Hash(text) {
    return 'sha256-' + createHash('sha256').update(text, 'utf8').digest('base64');
}

/** Every inline (no src=) <script>...</script> body's sha256 hash, recomputed independently of
 * scripts/csp.mjs so this proves the hash in the shipped header matches the shipped bytes, not
 * just that csp.mjs agrees with itself.
 *
 * Newlines are normalized (\r\n and lone \r -> \n) before hashing, same as scripts/csp.mjs and
 * backend/main.py: a browser normalizes newlines while tokenizing HTML (WHATWG "preprocessing
 * the input stream"), BEFORE it ever sees a script's text, so it hashes LF-only content even if
 * the bytes on disk are CRLF (as this repo's files are, on a Windows checkout with
 * core.autocrlf, even though the git blob itself is LF). Hashing the raw bytes here would
 * compute a hash the browser never produces and make this "independent" check agree with a bug
 * instead of catching it. */
function independentInlineScriptHashes(html) {
    const normalized = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const hashes = [];
    for (const [, attrs, body] of normalized.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/i.test(attrs)) continue;
        hashes.push(sha256Hash(body));
    }
    return hashes;
}

/** Minimal Cloudflare Pages `_headers` parser: path blocks start at column 0, header lines are
 * indented, `#` lines are comments. Good enough for this repo's own (small, hand-written) file. */
function parseHeadersFile(text) {
    const rules = [];
    let current = null;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim() || line.trim().startsWith('#')) continue;
        if (!/^[ \t]/.test(line)) {
            current = { pattern: line.trim(), headers: [] };
            rules.push(current);
        } else if (current) {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            current.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
        }
    }
    return rules;
}

function headersForPath(rules, requestPath) {
    const out = {};
    for (const rule of rules) {
        if (rule.pattern === '/*' || rule.pattern === requestPath) {
            for (const [k, v] of rule.headers) out[k] = v;
        }
    }
    return out;
}

function directive(csp, name) {
    for (const part of csp.split(';')) {
        const trimmed = part.trim();
        if (trimmed === name || trimmed.startsWith(name + ' ')) return trimmed;
    }
    return undefined;
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
};

/** A tiny static server for a built dist/-shaped directory that applies the headers its own
 * `_headers` file declares, the same way Cloudflare Pages would. Does NOT chdir into distDir
 * (that locks the directory on Windows and a later rmSync fails with EBUSY); paths are joined. */
function serveDist(distDir, port) {
    const rules = parseHeadersFile(readFileSync(join(distDir, '_headers'), 'utf8'));
    const server = createServer((req, res) => {
        const requestPath = req.url.split('?')[0];
        const relPath = requestPath === '/' ? '/index.html' : requestPath;
        const filePath = join(distDir, ...relPath.split('/').filter(Boolean));
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const headers = headersForPath(rules, requestPath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', ...headers });
        res.end(readFileSync(filePath));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

describe('dist/_headers CSP (built via scripts/build-pages.mjs, ADR-0003 Layer 1)', () => {
    let html;
    let headersText;
    let csp;

    beforeAll(() => {
        runBuild();
        html = readFileSync(join(dist, 'index.html'), 'utf8');
        headersText = readFileSync(join(dist, '_headers'), 'utf8');
        const rules = parseHeadersFile(headersText);
        const wildcard = rules.find((r) => r.pattern === '/*');
        const cspHeader = wildcard.headers.find(([k]) => k.toLowerCase() === 'content-security-policy');
        expect(cspHeader).toBeDefined();
        csp = cspHeader[1];
    }, 30000);

    it('is a single CSP header value with the required strict directives', () => {
        for (const expected of [
            "script-src 'self' 'sha256-",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "connect-src 'self'",
            "form-action 'none'",
        ]) {
            expect(csp, `missing ${expected} in: ${csp}`).toContain(expected);
        }
    });

    it('script-src never allows unsafe-inline or unsafe-eval', () => {
        const scriptSrc = directive(csp, 'script-src');
        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).not.toContain('unsafe-inline');
        expect(scriptSrc).not.toContain('unsafe-eval');
    });

    it('every inline <script> in dist/index.html (theme guard AND importmap) has its sha256 present in script-src', () => {
        const expectedHashes = independentInlineScriptHashes(html);
        // theme guard + the generated importmap = at least 2 inline scripts once built
        expect(expectedHashes.length).toBeGreaterThanOrEqual(2);
        const scriptSrc = directive(csp, 'script-src');
        for (const hash of expectedHashes) {
            expect(scriptSrc, `missing ${hash} in script-src`).toContain(`'${hash}'`);
        }
    });

    it('ships Integrity-Policy-Report-Only, not an enforcing Integrity-Policy', () => {
        const rules = parseHeadersFile(headersText);
        const wildcard = rules.find((r) => r.pattern === '/*');
        const names = wildcard.headers.map(([k]) => k.toLowerCase());
        expect(names).toContain('integrity-policy-report-only');
        expect(names).not.toContain('integrity-policy');
    });
});

describe('integrityFor() (frontend/js/build-info.js)', () => {
    it('returns null when there is no import map on the page', () => {
        const original = document.querySelector;
        document.querySelector = () => null;
        try {
            expect(integrityFor('/static/libs/cytoscape.min.js')).toBeNull();
        } finally {
            document.querySelector = original;
        }
    });

    it('returns the sha384 hash for a known URL from a stubbed import map', () => {
        const fakeMap = { integrity: { '/static/libs/cytoscape.min.js': 'sha384-deadbeef' } };
        const original = document.querySelector;
        document.querySelector = (sel) => (sel === 'script[type="importmap"]'
            ? { textContent: JSON.stringify(fakeMap) }
            : null);
        try {
            expect(integrityFor('/static/libs/cytoscape.min.js')).toBe('sha384-deadbeef');
        } finally {
            document.querySelector = original;
        }
    });

    it('returns null for a URL not present in the import map', () => {
        const fakeMap = { integrity: { '/static/js/app.js': 'sha384-abc' } };
        const original = document.querySelector;
        document.querySelector = () => ({ textContent: JSON.stringify(fakeMap) });
        try {
            expect(integrityFor('/static/libs/cytoscape.min.js')).toBeNull();
        } finally {
            document.querySelector = original;
        }
    });

    it('never throws, even on malformed import-map JSON', () => {
        const original = document.querySelector;
        document.querySelector = () => ({ textContent: 'not json{' });
        try {
            expect(() => integrityFor('/static/libs/cytoscape.min.js')).not.toThrow();
            expect(integrityFor('/static/libs/cytoscape.min.js')).toBeNull();
        } finally {
            document.querySelector = original;
        }
    });
});

// The only place in the repo that proves SRI + import-map integrity + this CSP actually boot
// together in a real browser: the Playwright E2E suite runs against backend/main.py serving
// frontend/ (unbuilt), never against dist/ (the built, SRI-injected, CSP-headered output). A CSP
// violation, a bad SRI hash, or a blocked import map all surface here as a console/page error.
describe('dist/ boots clean under its own CSP + SRI + import-map (real Chromium)', () => {
    const PORT = 8097;
    let server;
    let browser;

    beforeAll(async () => {
        runBuild(); // dist/ from the describe block above may have been rebuilt by another file/test
        server = await serveDist(dist, PORT);
        browser = await chromium.launch();
    }, 60000);

    afterAll(async () => {
        if (browser) await browser.close();
        if (server) await closeServer(server);
    }, 30000);

    it('the login box renders, the stylesheet applies, and the build stamp is set, with zero errors', async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
        });
        page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
        page.on('requestfailed', (req) => {
            errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
        });

        await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
        await page.waitForSelector('.login-box', { state: 'visible', timeout: 15000 });

        expect(await page.isVisible('.login-box')).toBe(true);

        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg, 'stylesheet does not appear to be applied').not.toBe('rgba(0, 0, 0, 0)');
        expect(bg).not.toBe('');

        const buildMeta = await page.getAttribute('meta[name="wymber-build"]', 'content');
        expect(buildMeta).toBeTruthy();
        expect(buildMeta).not.toBe('dev');

        await page.close();
        expect(errors, `unexpected browser errors:\n${errors.join('\n')}`).toEqual([]);
    }, 60000);

    // Negative case, on a throwaway COPY of dist/ (never the repo's own dist/): tamper with a
    // shipped module after the fact and confirm the browser actually refuses to run it, so a
    // green result above is meaningful rather than vacuous (the manager verified this by hand:
    // Chromium 145 reports "Failed to find a valid digest in the 'integrity' attribute").
    it('a tampered copy of a shipped module is blocked by import-map integrity', async () => {
        const tmpDist = mkdtempSync(join(tmpdir(), 'wymber-dist-tamper-'));
        const tamperPort = PORT + 1;
        let tamperServer;
        try {
            cpSync(dist, tmpDist, { recursive: true });
            const configPath = join(tmpDist, 'static', 'js', 'config.js');
            const original = readFileSync(configPath, 'utf8');
            writeFileSync(configPath, original + '\n// tampered for the negative CSP/SRI test\n');

            tamperServer = await serveDist(tmpDist, tamperPort);
            browser = browser ?? (await chromium.launch());
            const page = await browser.newPage();
            const errors = [];
            page.on('console', (msg) => {
                if (msg.type() === 'error') errors.push(msg.text());
            });
            page.on('pageerror', (err) => errors.push(err.message));

            await page.goto(`http://localhost:${tamperPort}/`, { waitUntil: 'load' });
            await page.waitForTimeout(500); // let the failed module load surface its error
            await page.close();

            expect(errors.length, 'expected the tampered module load to be blocked and reported').toBeGreaterThan(0);
        } finally {
            if (tamperServer) await closeServer(tamperServer);
            rmSync(tmpDist, { recursive: true, force: true });
        }
    }, 30000);
});

// The landing (wymber.app) has no build step, it deploys straight from landing/, so its CSP
// hashes are written into landing/_headers by scripts/landing-csp.mjs rather than computed at
// deploy time. That is only safe with a test that catches drift: an inline script blocked by a
// stale hash throws no error a visitor would see, it just silently stops working (the homepage
// carousel's arrow buttons would go dead). So recompute the hashes here, independently of that
// script, straight from the pages.
describe('landing/_headers CSP (ADR-0003 Layer 1, the landing origin)', () => {
    const landing = join(root, 'landing');
    let csp;
    let inlineScripts;

    beforeAll(() => {
        const rules = parseHeadersFile(readFileSync(join(landing, '_headers'), 'utf8'));
        const wildcard = rules.find((r) => r.pattern === '/*');
        expect(wildcard, 'landing/_headers must have a /* rule').toBeDefined();
        const header = wildcard.headers.find(([k]) => k.toLowerCase() === 'content-security-policy');
        expect(header, 'landing/_headers must set a CSP').toBeDefined();
        csp = header[1];

        // Every inline <script> across every landing page, split into the ones a browser will
        // execute (need a hash) and the data blocks it never will (application/ld+json).
        const executableTypes = new Set(['', 'module', 'importmap', 'text/javascript', 'application/javascript']);
        inlineScripts = { executable: [], dataBlocks: [] };
        for (const file of readdirSync(landing).sort()) {
            if (!file.endsWith('.html')) continue;
            const pageHtml = readFileSync(join(landing, file), 'utf8');
            for (const [, attrs, body] of pageHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (/\bsrc\s*=/i.test(attrs)) continue;
                const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1] || '').toLowerCase();
                const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                const hash = 'sha256-' + createHash('sha256').update(normalized, 'utf8').digest('base64');
                inlineScripts[executableTypes.has(type) ? 'executable' : 'dataBlocks'].push({ file, type, hash });
            }
        }
    });

    it('has a hash for every inline script a browser will actually execute', () => {
        // If this fails, an inline script on the landing changed: run `node scripts/landing-csp.mjs`.
        for (const { file, hash } of inlineScripts.executable) {
            expect(csp, `landing/_headers is stale for the inline script in ${file}`).toContain(hash);
        }
    });

    it('does not carry hashes for data blocks (application/ld+json is never executed)', () => {
        for (const { file, type, hash } of inlineScripts.dataBlocks) {
            expect(type).not.toBe('');
            expect(csp, `${file}'s ${type} block is a data block and needs no hash`).not.toContain(hash);
        }
    });

    it('never allows unsafe-inline, unsafe-eval, or a script source', () => {
        const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).not.toContain('unsafe-inline');
        expect(scriptSrc).not.toContain('unsafe-eval');
        expect(scriptSrc).not.toContain("'self'"); // hashes only: the landing loads no script files
    });

    it('keeps the rest of the strict posture', () => {
        for (const expected of [
            "default-src 'self'",
            "base-uri 'none'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'none'",
            "connect-src 'none'",
        ]) {
            expect(csp).toContain(expected);
        }
    });

    it('is exactly what scripts/landing-csp.mjs would write (no drift)', async () => {
        // expectedLandingCsp() is pure on purpose: asserting against the generator's *output*
        // rather than running the generator keeps this test from quietly rewriting a tracked file
        // when it is stale. A failing test should report, not repair.
        const { expectedLandingCsp } = await import('../../scripts/landing-csp.mjs');
        expect(csp, 'landing/_headers is stale: run `node scripts/landing-csp.mjs`').toBe(expectedLandingCsp());
    });
});
