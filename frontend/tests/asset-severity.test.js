import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    SEVERITY_ORDER,
    SEVERITY_TIERS,
    SEVERITY_NOTE,
    ASSET_SEVERITY,
    severityFor,
    classifyAssets,
} from '../../scripts/asset-severity.mjs';

// This suite is the drift guard for ADR-0003's severity classification: ASSET_SEVERITY is a
// hand-maintained, exact-path map (deliberately no extension/prefix rules or default tier), so
// nothing else keeps it honest against what actually ships except comparing it, here, against the
// real built manifest. A file added to dist/ without a matching ASSET_SEVERITY entry should fail
// this suite, not silently publish as unclassified.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');

// frontend/tests/integrity-manifest.test.js and csp.test.js also build dist/ in their own
// beforeAll, and Vitest may run separate test files concurrently in different workers; guard the
// (rm + rebuild) build-pages.mjs does with the same cross-process lock those files use, so one
// worker never reads dist/ mid-rebuild by another.
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
            if (Date.now() > deadline) throw new Error('[asset-severity.test] timed out waiting for the dist/ build lock');
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

// Build only if there is nothing to read yet. csp.test.js and integrity-manifest.test.js each
// force a fresh build in the same run, so dist/ is current by the time this file needs it, and a
// third concurrent build buys nothing: it only adds contention. That matters because
// build-pages.mjs resolves the build stamp with `git rev-parse` and silently falls back to 'dev'
// if that call fails for any reason, so piling concurrent git invocations on the same repo turns
// into an intermittent, confusing failure in a DIFFERENT test file (csp.test.js's build-stamp
// assertion), which is exactly what happened while this suite was being added.
function ensureDist() {
    withBuildLock(() => {
        if (existsSync(join(dist, 'integrity-manifest.json'))) return;
        execFileSync(process.execPath, [join(root, 'scripts', 'build-pages.mjs')], { cwd: root, stdio: 'pipe' });
    });
}

let manifest;

beforeAll(() => {
    ensureDist();
    manifest = JSON.parse(readFileSync(join(dist, 'integrity-manifest.json'), 'utf8'));
}, 30000);

describe('ASSET_SEVERITY against the built manifest', () => {
    it('every asset in dist/integrity-manifest.json has a tier drawn from SEVERITY_ORDER', () => {
        for (const [url, entry] of Object.entries(manifest.assets)) {
            expect(SEVERITY_ORDER, `unknown severity tier for ${url}`).toContain(entry.severity);
        }
    });

    it("ASSET_SEVERITY's key set is exactly the built manifest's asset key set (no stale entries, no missing ones)", () => {
        const manifestKeys = Object.keys(manifest.assets).sort();
        const classifiedKeys = Object.keys(ASSET_SEVERITY).sort();
        expect(classifiedKeys).toEqual(manifestKeys);
    });

    it('the manifest severity per asset matches ASSET_SEVERITY', () => {
        for (const [url, entry] of Object.entries(manifest.assets)) {
            expect(entry.severity, `severity mismatch for ${url}`).toBe(ASSET_SEVERITY[url]);
        }
    });

    it('the counts per tier are pinned (9 critical / 7 high / 5 moderate / 9 low)', () => {
        const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
        for (const tier of Object.values(ASSET_SEVERITY)) counts[tier]++;
        expect(counts).toEqual({ critical: 9, high: 7, moderate: 5, low: 9 });
    });
});

describe('severityFor', () => {
    it('returns the tier for a known asset', () => {
        expect(severityFor('/index.html')).toBe('critical');
        expect(severityFor('/static/css/styles.css')).toBe('low');
    });

    it('throws on an unknown path', () => {
        expect(() => severityFor('/static/js/does-not-exist.js')).toThrow(/does-not-exist\.js/);
    });

    // A plain-object lookup resolves inherited keys, so a truthiness check on ASSET_SEVERITY[path]
    // would hand back Object.prototype.constructor (a function) for 'constructor' and call it a
    // tier. Fail-closed means fail-closed for these too, not just for paths nobody thought of.
    it('throws on inherited Object.prototype keys rather than returning them as a tier', () => {
        for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
            expect(() => severityFor(inherited), `${inherited} should not classify`).toThrow();
        }
    });
});

describe('classifyAssets', () => {
    it('classifies every path in a known list', () => {
        const result = classifyAssets(['/index.html', '/static/css/styles.css']);
        expect(result).toEqual({ '/index.html': 'critical', '/static/css/styles.css': 'low' });
    });

    it('throws on an unclassified path, naming it in the message', () => {
        expect(() => classifyAssets(['/index.html', '/static/js/nope.js']))
            .toThrow(/\/static\/js\/nope\.js/);
    });

    it('names every unclassified path at once, not just the first', () => {
        try {
            classifyAssets(['/nope-one.js', '/nope-two.js']);
            throw new Error('expected classifyAssets to throw');
        } catch (err) {
            expect(err.message).toMatch(/nope-one\.js/);
            expect(err.message).toMatch(/nope-two\.js/);
        }
    });
});

describe('SEVERITY_NOTE', () => {
    it('states plainly that a low-severity difference is still a difference', () => {
        expect(SEVERITY_NOTE).toMatch(/triage/);
        expect(SEVERITY_NOTE).toMatch(/still/);
    });
});

describe('manifest.severity', () => {
    it('has a tier entry for every tier in SEVERITY_ORDER', () => {
        for (const tier of SEVERITY_ORDER) {
            expect(manifest.severity.tiers[tier], `missing tiers entry for ${tier}`).toBeDefined();
            expect(typeof manifest.severity.tiers[tier].label).toBe('string');
            expect(typeof manifest.severity.tiers[tier].meaning).toBe('string');
        }
        expect(SEVERITY_TIERS).toEqual(manifest.severity.tiers);
    });
});
