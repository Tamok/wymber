import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
    readFileSync, writeFileSync, existsSync, statSync, openSync, closeSync, unlinkSync,
    mkdtempSync, rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { embeddedManifestJson, expectedEmbed } from '../../scripts/verify-embed.mjs';

// This suite proves landing/verify.html's comparator tool (ADR-0003, Layers 1/2/5) does what it
// claims: hashes files locally with WebCrypto, diffs them against the manifest embedded in the
// page, and never touches the network, all while running under the landing's actual shipped CSP
// (connect-src 'none'). Four parts, increasing in how much they actually prove:
//   A. the pure functions, evaluated from the exact shipped bytes (not a copy)
//   B. the embedded manifest hasn't drifted from landing/integrity-manifest.json
//   C. a static grep for network-capable APIs (a floor, not proof)
//   D. a real Chromium boot under the shipped landing/_headers (the load-bearing proof)

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const landing = join(root, 'landing');
const dist = join(root, 'dist');

function readVerifyHtml() {
    return readFileSync(join(landing, 'verify.html'), 'utf8');
}

// The single bare `<script>` on the page (no `type=`, no `src=`) is the tool's own logic. The
// other two <script> blocks on this page (`application/ld+json`, and the manifest data block
// `application/json`) both carry an explicit `type=`, so this pattern picks out exactly one match.
function extractToolScriptBody(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    return match ? match[1] : null;
}

describe('Part A: pure functions, evaluated from the shipped bytes', () => {
    let WymberVerify;

    beforeAll(() => {
        const html = readVerifyHtml();

        // Inject the real shipped <body> (container, inputs, and the embedded manifest data
        // block included) so the script under test sees exactly what a browser would: the
        // manifest data block populated for real, and #verify-tool present so the DOM-wiring
        // branch actually runs too (not just the pure-function definitions).
        const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
        expect(bodyMatch, 'landing/verify.html has no <body>').not.toBeNull();
        document.body.innerHTML = bodyMatch[1];

        const scriptBody = extractToolScriptBody(html);
        expect(scriptBody, 'landing/verify.html has no bare inline <script>').not.toBeNull();

        // eslint-disable-next-line no-new-func -- evaluating the exact shipped bytes is the point
        new Function(scriptBody)();

        WymberVerify = globalThis.WymberVerify;
        expect(WymberVerify, 'the shipped script did not assign globalThis.WymberVerify').toBeDefined();
    });

    it('the DOM wiring ran: #verify-tool had its hidden attribute removed', () => {
        expect(document.getElementById('verify-tool').hidden).toBe(false);
    });

    describe('normalizePath', () => {
        const keys = ['/static/js/app.js', '/index.html'];

        it('resolves a path nested under an extra leading folder', () => {
            expect(WymberVerify.normalizePath('dist/static/js/app.js', keys)).toBe('/static/js/app.js');
        });

        it('resolves a path with no extra folder', () => {
            expect(WymberVerify.normalizePath('static/js/app.js', keys)).toBe('/static/js/app.js');
        });

        it('resolves a path nested under an arbitrarily named folder', () => {
            expect(WymberVerify.normalizePath('whatever/static/js/app.js', keys)).toBe('/static/js/app.js');
        });

        // A file chosen one at a time through the file picker has no webkitRelativePath, so the
        // page only ever sees "app.js". Without this fallback the most obvious control on the
        // page matches nothing at all. Found by driving the real page in Chromium, not by the
        // synthetic paths the rest of these cases use.
        it('resolves a bare file name with no folder part at all', () => {
            const keys = ['/static/js/app.js', '/static/css/styles.css', '/sw.js'];
            expect(WymberVerify.normalizePath('app.js', keys)).toBe('/static/js/app.js');
            expect(WymberVerify.normalizePath('styles.css', keys)).toBe('/static/css/styles.css');
        });

        it('refuses a bare file name that belongs to more than one published entry', () => {
            const keys = ['/a/dup.js', '/b/dup.js', '/static/js/app.js'];
            expect(WymberVerify.normalizePath('dup.js', keys)).toBeNull();
        });

        // The fallback must not fire when there IS a folder part: a copy that happens to contain
        // its own unrelated app.js must not be quietly checked against the published one.
        it('does not fall back to the file name when the path has a folder part', () => {
            const keys = ['/static/js/app.js'];
            expect(WymberVerify.normalizePath('docs/examples/app.js', keys)).toBeNull();
        });

        it('returns null for a path matching nothing in the manifest', () => {
            expect(WymberVerify.normalizePath('not/a/real/path.js', keys)).toBeNull();
        });
    });

    describe('sriFromBuffer', () => {
        it('reproduces a known SHA-384, cross-checked against node:crypto', async () => {
            const bytes = new TextEncoder().encode('wymber-verify-tool-fixture');
            const expected = 'sha384-' + createHash('sha384').update(Buffer.from(bytes)).digest('base64');
            const actual = await WymberVerify.sriFromBuffer(bytes.buffer);
            expect(actual).toBe(expected);
        });
    });

    describe('readManifest', () => {
        it('handles a schema-1 manifest (bare hash strings) without throwing, tiers reported as unclassified', () => {
            const schema1 = { schema: 1, algorithm: 'sha384', commit: 'abc1234', assets: { '/a.js': 'sha384-AAAAAAAA' } };
            let manifest;
            expect(() => { manifest = WymberVerify.readManifest(schema1); }).not.toThrow();
            expect(manifest.hashOf('/a.js')).toBe('sha384-AAAAAAAA');
            expect(manifest.severityOf('/a.js')).toBe('unclassified');
            expect(manifest.order).toContain('unclassified');
            expect(manifest.tiers.unclassified).toBeDefined();
            expect(manifest.tiers.unclassified.meaning).toMatch(/severity/i);
        });

        it('handles a schema-2 manifest normally, no unclassified tier introduced', () => {
            const schema2 = {
                schema: 2,
                severity: { order: ['critical', 'low'], tiers: { critical: { label: 'Critical', meaning: 'x' }, low: { label: 'Low', meaning: 'y' } }, note: 'n' },
                assets: { '/a.js': { hash: 'sha384-AAAA', severity: 'critical' } },
            };
            const manifest = WymberVerify.readManifest(schema2);
            expect(manifest.severityOf('/a.js')).toBe('critical');
            expect(manifest.order).not.toContain('unclassified');
        });
    });

    describe('compare + summarize (the low-severity-still-differs design)', () => {
        const sample = {
            schema: 2,
            severity: {
                order: ['critical', 'high', 'moderate', 'low'],
                tiers: {
                    critical: { label: 'Critical', meaning: 'reaches your key' },
                    high: { label: 'High', meaning: 'reaches your map' },
                    moderate: { label: 'Moderate', meaning: 'changes what is said' },
                    low: { label: 'Low', meaning: 'cannot read your vault' },
                },
                note: 'Severity is triage, not permission.',
            },
            assets: {
                '/critical.js': { hash: 'sha384-CCCC', severity: 'critical' },
                '/style.css': { hash: 'sha384-LLLL', severity: 'low' },
            },
        };

        function manifest() {
            return WymberVerify.readManifest(sample);
        }

        it('a changed file reports "differs"', () => {
            const results = WymberVerify.compare(
                [{ path: '/critical.js', hash: 'sha384-CCCC' }, { path: '/style.css', hash: 'sha384-DIFFERENT' }],
                manifest(),
            );
            const row = results.find((r) => r.path === '/style.css');
            expect(row.status).toBe('differs');
        });

        it('a missing file reports "missing"', () => {
            const results = WymberVerify.compare([{ path: '/critical.js', hash: 'sha384-CCCC' }], manifest());
            const row = results.find((r) => r.path === '/style.css');
            expect(row.status).toBe('missing');
        });

        it('an unexpected extra file reports "unexpected"', () => {
            const results = WymberVerify.compare(
                [
                    { path: '/critical.js', hash: 'sha384-CCCC' },
                    { path: '/style.css', hash: 'sha384-LLLL' },
                    { path: '/not-in-manifest.txt', hash: 'sha384-ZZZZ' },
                ],
                manifest(),
            );
            const row = results.find((r) => r.path === '/not-in-manifest.txt');
            expect(row.status).toBe('unexpected');
            expect(row.severity).toBeNull();
        });

        it('a second file resolving to the same entry is reported, not silently dropped', () => {
            const results = WymberVerify.compare(
                [
                    { path: 'one/critical.js', hash: 'sha384-CCCC' },
                    { path: 'two/critical.js', hash: 'sha384-CCCC' },
                ],
                manifest(),
            );
            expect(results.filter((r) => r.status === 'unexpected')).toHaveLength(1);
        });

        it('a low-severity-only difference still reports as differing: everythingMatched is false', () => {
            // /critical.js matches exactly; only the LOW-severity /style.css differs. The whole
            // point of this design is that this must never read as an overall pass.
            const results = WymberVerify.compare(
                [{ path: '/critical.js', hash: 'sha384-CCCC' }, { path: '/style.css', hash: 'sha384-DIFFERENT' }],
                manifest(),
            );
            const summary = WymberVerify.summarize(results);
            expect(summary.everythingMatched).toBe(false);
            expect(summary.worstTier).toBe('low');
            expect(summary.counts.differs).toBe(1);
        });

        it('an all-matching set reports everythingMatched === true', () => {
            const results = WymberVerify.compare(
                [{ path: '/critical.js', hash: 'sha384-CCCC' }, { path: '/style.css', hash: 'sha384-LLLL' }],
                manifest(),
            );
            const summary = WymberVerify.summarize(results);
            expect(summary.everythingMatched).toBe(true);
            expect(summary.counts.differs).toBe(0);
            expect(summary.counts.missing).toBe(0);
            expect(summary.counts.unexpected).toBe(0);
        });
    });

    // summaryState is what the page actually says out loud, and it draws a line summarize() does
    // not: "missing" alone means an incomplete check, while "differs" or "unexpected" means the
    // copy is not what was published. Conflating the two would make the tool cry wolf on its most
    // ordinary use (checking a single file), which in a trauma-informed product is its own harm.
    // everythingMatched keeps its stricter meaning either way, and a differing LOW-severity file
    // must still land in 'differs'.
    describe('summaryState (what the page says out loud)', () => {
        // Same two-asset fixture as above, one critical and one low, redeclared here so this block
        // stands on its own rather than reaching into a sibling describe's scope.
        const twoAssets = {
            schema: 2,
            severity: {
                order: ['critical', 'high', 'moderate', 'low'],
                tiers: { critical: { label: 'Critical', meaning: '' }, low: { label: 'Low', meaning: '' } },
                note: '',
            },
            assets: {
                '/critical.js': { hash: 'sha384-CCCC', severity: 'critical' },
                '/style.css': { hash: 'sha384-LLLL', severity: 'low' },
            },
        };
        const manifest = () => WymberVerify.readManifest(twoAssets);
        const state = (checked, total) => WymberVerify.summaryState(
            WymberVerify.summarize(WymberVerify.compare(checked, manifest())),
            total,
        );

        it('a partial check where everything given matched is "partial", not "differs"', () => {
            expect(state([{ path: '/critical.js', hash: 'sha384-CCCC' }], 2)).toBe('partial');
        });

        it('a low-severity-only difference is "differs", never "partial" or "clean"', () => {
            expect(state(
                [{ path: '/critical.js', hash: 'sha384-CCCC' }, { path: '/style.css', hash: 'sha384-DIFFERENT' }],
                2,
            )).toBe('differs');
        });

        it('a low-severity difference inside an otherwise partial check is still "differs"', () => {
            expect(state([{ path: '/style.css', hash: 'sha384-DIFFERENT' }], 2)).toBe('differs');
        });

        it('an unexpected extra file alone is "differs"', () => {
            expect(state(
                [
                    { path: '/critical.js', hash: 'sha384-CCCC' },
                    { path: '/style.css', hash: 'sha384-LLLL' },
                    { path: '/stray.txt', hash: 'sha384-ZZZZ' },
                ],
                2,
            )).toBe('differs');
        });

        it('a complete, all-matching check is "clean"', () => {
            expect(state(
                [{ path: '/critical.js', hash: 'sha384-CCCC' }, { path: '/style.css', hash: 'sha384-LLLL' }],
                2,
            )).toBe('clean');
        });

        it('files that match nothing in the published list are "none-recognised", not an alarm', () => {
            expect(state([{ path: '/nowhere/at/all.txt', hash: 'sha384-ZZZZ' }], 2)).toBe('none-recognised');
        });
    });

    describe('TIER_ORDER', () => {
        it('is drawn from the embedded manifest\'s severity.order', () => {
            expect(WymberVerify.TIER_ORDER).toEqual(['critical', 'high', 'moderate', 'low']);
        });
    });
});

describe('Part B: the embedded manifest has not drifted', () => {
    it("landing/verify.html's embedded manifest text matches expectedEmbed()", () => {
        const html = readVerifyHtml();
        const embedded = embeddedManifestJson(html);
        expect(embedded, 'no embedded manifest data block found in landing/verify.html').not.toBeNull();
        expect(embedded, 'stale embed: run `node scripts/verify-embed.mjs` to refresh it').toBe(expectedEmbed());
    });

    it('the embedded manifest parses as JSON and its commit matches landing/integrity-manifest.json', () => {
        const html = readVerifyHtml();
        const embedded = JSON.parse(embeddedManifestJson(html));
        const published = JSON.parse(readFileSync(join(landing, 'integrity-manifest.json'), 'utf8'));
        expect(embedded.commit).toBe(published.commit);
        expect(embedded.assets).toEqual(published.assets);
    });
});

// A grep is a floor, not a proof: it catches an obvious network call typed directly into the
// script, but says nothing about what the browser actually does under the shipped CSP (a
// dynamically-built string, or a violation of connect-src itself, would slip straight past it).
// Part D is the real check: it runs the exact shipped bytes in real Chromium and watches the wire.
describe('Part C: static no-network guard (a floor, not proof)', () => {
    const BANNED = [
        'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource',
        'import(', 'new Image', '.src =', 'navigator.connection',
    ];

    it('the shipped inline script contains none of the network-capable APIs', () => {
        const scriptBody = extractToolScriptBody(readVerifyHtml());
        expect(scriptBody).not.toBeNull();
        for (const token of BANNED) {
            expect(scriptBody, `found banned token "${token}" in the shipped script`).not.toContain(token);
        }
    });
});

// --- Part D helpers, copied from frontend/tests/csp.test.js (same shapes, pointed at landing/
// instead of dist/): a minimal Cloudflare Pages `_headers` parser and a static server that
// applies them the way Cloudflare Pages would, so the CSP this test boots under is the one that
// actually ships. ---

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
            if (Date.now() > deadline) throw new Error('[verify-tool.test] timed out waiting for the dist/ build lock');
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
    '.jsonl': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
};

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

const browserAvailable = (() => {
    try {
        return existsSync(chromium.executablePath());
    } catch {
        return false;
    }
})();
if (!browserAvailable && !process.env.CI) {
    console.warn('[verify-tool.test] skipping the real-Chromium boot test: run `npx playwright install chromium` to enable it');
}

describe.skipIf(!browserAvailable && !process.env.CI)('Part D: verify.html boots clean under the shipped landing CSP (real Chromium)', () => {
    const PORT = 8101;
    let server;
    let browser;
    let tmpFilesDir;

    beforeAll(async () => {
        // dist/ supplies fixture bytes that are actually shipped (not hand-typed guesses), so the
        // "matches" case exercises a real match rather than a coincidence.
        runBuild();

        const published = JSON.parse(readFileSync(join(landing, 'integrity-manifest.json'), 'utf8'));
        const distRobots = readFileSync(join(dist, 'robots.txt'));
        const distManifestWebmanifest = readFileSync(join(dist, 'manifest.webmanifest'));

        const robotsHash = 'sha384-' + createHash('sha384').update(distRobots).digest('base64');
        expect(
            robotsHash,
            'dist/robots.txt has drifted from the published landing/integrity-manifest.json; this fixture needs a currently-matching asset',
        ).toBe(published.assets['/robots.txt'].hash);

        // Both fixture assets are top-level manifest keys (single path segment) on purpose: a
        // file chosen through a plain multi-file <input type="file"> carries only its bare
        // filename (browsers strip folder info there for privacy), and normalizePath needs that
        // bare name to already resolve to a manifest key without any directory context.
        tmpFilesDir = mkdtempSync(join(tmpdir(), 'wymber-verify-tool-'));
        writeFileSync(join(tmpFilesDir, 'robots.txt'), distRobots);
        writeFileSync(
            join(tmpFilesDir, 'manifest.webmanifest'),
            Buffer.concat([distManifestWebmanifest, Buffer.from('\n/* tampered for the verify-tool test */\n')]),
        );
        writeFileSync(join(tmpFilesDir, 'not-a-real-file.txt'), 'this file is not part of the published app\n');

        server = await serveDist(landing, PORT);
        browser = await chromium.launch();
    }, 60000);

    afterAll(async () => {
        if (browser) await browser.close();
        if (server) await closeServer(server);
        if (tmpFilesDir) rmSync(tmpFilesDir, { recursive: true, force: true });
    }, 30000);

    it('the tool becomes visible, checks local files correctly, and makes zero network requests beyond the initial page load', async () => {
        const page = await browser.newPage();
        const errors = [];
        const requests = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
        });
        page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
        page.on('request', (req) => requests.push(req.url()));

        await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: 'load' });

        // Proof the inline script actually ran under the shipped CSP rather than being silently
        // blocked: the tool ships with `hidden` and only the script removes it.
        await page.waitForFunction(() => {
            const el = document.getElementById('verify-tool');
            return !!el && !el.hidden;
        }, { timeout: 15000 });
        expect(await page.evaluate(() => document.getElementById('verify-tool').hidden)).toBe(false);

        const requestCountAfterLoad = requests.length;

        await page.setInputFiles('#verify-file-input', [
            join(tmpFilesDir, 'robots.txt'),
            join(tmpFilesDir, 'manifest.webmanifest'),
            join(tmpFilesDir, 'not-a-real-file.txt'),
        ]);

        await page.waitForFunction(() => {
            const el = document.getElementById('verify-results');
            return !!el && /matches|differs|unexpected/.test(el.textContent || '');
        }, { timeout: 15000 });

        const resultsText = await page.evaluate(() => document.getElementById('verify-results').textContent);
        expect(resultsText, 'expected the unchanged file to be reported as matching').toContain('matches');
        expect(resultsText, 'expected the tampered file to be reported as differing').toContain('differs');
        expect(resultsText, 'expected the extra file to be reported as unexpected').toContain('unexpected');

        expect(
            requests.length,
            `a request was made after the initial page load; the tool must make none:\n${requests.join('\n')}`,
        ).toBe(requestCountAfterLoad);

        await page.close();
        expect(errors, `unexpected browser errors:\n${errors.join('\n')}`).toEqual([]);
    }, 60000);
});
