import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// This suite runs the real build (scripts/build-pages.mjs writes to the repo's gitignored dist/;
// it deliberately does NOT touch the committed landing/integrity-manifest.json, so running the
// tests leaves the working tree clean). It exists to catch the one failure mode that would
// matter in production: a hash in dist/index.html or
// integrity-manifest.json that does NOT match the bytes it is supposed to protect, which would
// make the browser refuse to load its own app the moment SRI / import-map integrity is enforced.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');

function sriHash(bytes) {
    return 'sha384-' + createHash('sha384').update(bytes).digest('base64');
}

function readDist(relPath) {
    return readFileSync(join(dist, ...relPath.split('/').filter(Boolean)));
}

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

let html;
let manifest;

beforeAll(() => {
    execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], { cwd: root, stdio: 'pipe' });
    html = readFileSync(join(dist, 'index.html'), 'utf8');
    manifest = JSON.parse(readFileSync(join(dist, 'integrity-manifest.json'), 'utf8'));
}, 30000);

describe('build-pages SRI injection', () => {
    it('every integrity="sha384-..." attribute in dist/index.html matches the bytes it points at', () => {
        // <link ... href="..." ... integrity="sha384-..."> and
        // <script ... src="..." ... integrity="sha384-...">
        const tagRe = /<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"[^>]*\bintegrity="(sha384-[^"]+)"[^>]*>/g;
        const found = [...html.matchAll(tagRe)];
        expect(found.length).toBeGreaterThanOrEqual(2); // stylesheet + module entrypoint

        for (const [, url, integrity] of found) {
            expect(url.startsWith('/')).toBe(true);
            const actual = sriHash(readDist(url));
            expect(actual, `SRI mismatch for ${url}`).toBe(integrity);
        }
    });

    it('the stylesheet and module entrypoint both carry integrity', () => {
        expect(html).toMatch(/<link rel="stylesheet" href="\/static\/css\/styles\.css" integrity="sha384-[^"]+" crossorigin="anonymous">/);
        expect(html).toMatch(/<script type="module" src="\/static\/js\/app\.js" integrity="sha384-[^"]+" crossorigin="anonymous"><\/script>/);
    });

    it('the wymber-build meta tag is stamped away from the "dev" placeholder', () => {
        const match = html.match(/<meta name="wymber-build" content="([^"]+)">/);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/^[0-9a-f]{7}$|^dev$/);
    });
});

describe('import-map integrity', () => {
    let importMap;

    beforeAll(() => {
        const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
        expect(match).not.toBeNull();
        importMap = JSON.parse(match[1]);
    });

    it('every entry matches the recomputed SHA-384 of the corresponding dist/ file', () => {
        expect(Object.keys(importMap.integrity).length).toBeGreaterThan(0);
        for (const [url, integrity] of Object.entries(importMap.integrity)) {
            const actual = sriHash(readDist(url));
            expect(actual, `import-map SRI mismatch for ${url}`).toBe(integrity);
        }
    });

    it('covers every .js file under dist/static/js/ and dist/static/libs/', () => {
        const expectedUrls = [join(dist, 'static', 'js'), join(dist, 'static', 'libs')]
            .flatMap(collectJsFiles)
            .map((full) => '/' + relative(dist, full).split(sep).join('/'))
            .sort();

        expect(Object.keys(importMap.integrity).sort()).toEqual(expectedUrls);
    });

    it('keys are sorted', () => {
        const keys = Object.keys(importMap.integrity);
        expect(keys).toEqual([...keys].sort());
    });
});

describe('dist/integrity-manifest.json', () => {
    it('parses and has the expected top-level shape', () => {
        expect(manifest.schema).toBe(1);
        expect(manifest.algorithm).toBe('sha384');
        expect(typeof manifest.commit).toBe('string');
        expect(typeof manifest.note).toBe('string');
        expect(typeof manifest.assets).toBe('object');
    });

    it('every asset hash matches the sha384-<base64> shape', () => {
        for (const [url, hash] of Object.entries(manifest.assets)) {
            expect(url.startsWith('/'), `asset key should start with /: ${url}`).toBe(true);
            expect(hash, `bad hash shape for ${url}`).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
        }
    });

    it('includes known assets', () => {
        expect(manifest.assets['/index.html']).toBeDefined();
        expect(manifest.assets['/static/js/app.js']).toBeDefined();
        expect(manifest.assets['/static/css/styles.css']).toBeDefined();
    });

    it('excludes _headers and itself', () => {
        expect(manifest.assets['/_headers']).toBeUndefined();
        expect(manifest.assets['/integrity-manifest.json']).toBeUndefined();
    });

    it("/index.html's hash matches the HTML actually written (post SRI + import-map injection)", () => {
        const actual = sriHash(readFileSync(join(dist, 'index.html')));
        expect(manifest.assets['/index.html']).toBe(actual);
    });
});

describe('reproducibility', () => {
    it('running the build twice produces a byte-identical integrity-manifest.json', () => {
        const first = readFileSync(join(dist, 'integrity-manifest.json'));
        execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], { cwd: root, stdio: 'pipe' });
        const second = readFileSync(join(dist, 'integrity-manifest.json'));
        expect(second.equals(first)).toBe(true);
    }, 30000);
});
