// Cross-platform crypto parity (#150) — the Chromium half. See ../README.md for the full
// picture: what this test proves, what it does not, and the fixture-freezing policy (do NOT
// regenerate a fixture to make a red test green).
//
// This suite runs the real crypto.js INSIDE a real Chromium page (dynamic import from the app's
// own origin), because Android's System WebView *is* Chromium — the closest honest stand-in for
// "device" available in this repo. Self-contained on purpose: its own tiny in-page helpers, no
// imports from ../helpers.js (that file belongs to another test tree and may change independently
// of this one).
//
// Each unlock of a frozen fixture runs real PBKDF2 at 600k iterations (the iteration count the
// fixture itself was frozen with) INSIDE the browser, which is slower than Node — hence the long
// explicit per-test timeout instead of touching playwright.config.js's global one.
//
// Fixtures are imported directly as plain `.js` modules (`import`/`export`, not `.mjs`, no
// `node:fs` / `import.meta.url`): this repo has no `"type": "module"` in package.json, so
// Playwright transforms `.js` specs toward CJS, and both `.mjs` (which forces ESM) and
// `import.meta` (unavailable after that transform) make a spec fail to load entirely — see
// ./README.md for the full story.
import { test, expect } from '@playwright/test';
import { fixtureDocument, FIXTURE_PASSWORD, FIXTURE_RECOVERY_CODE } from './fixtures/fixture-document.js';
import { nodeSealedFixture } from './fixtures/node-sealed.vault.js';
import { chromiumSealedFixture } from './fixtures/chromium-sealed.vault.js';

const NODE_FIXTURE = nodeSealedFixture;
const CHROMIUM_FIXTURE = chromiumSealedFixture;

// Freshly-sealed vaults created inside a test (thrown away immediately after) don't need the
// production KDF cost — only the two frozen fixtures must be unlocked at their recorded
// (real, 600k) iteration count.
const FAST_ITERATIONS = 1000;

/** Installs an in-page, in-memory stand-in for window.Capacitor.Plugins.Filesystem — the same
 * shape NativePersistence talks to, minus the real Android/iOS plugin. Must run inside
 * page.evaluate (it references only page-global state). */
function installCapacitorShim() {
    const store = new Map();
    window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
            Filesystem: {
                readFile: async ({ path }) => {
                    if (!store.has(path)) throw new Error('File does not exist.');
                    return { data: store.get(path) };
                },
                writeFile: async ({ path, data }) => { store.set(path, data); return { uri: path }; },
                rename: async ({ from, to }) => {
                    if (!store.has(from)) throw new Error('File does not exist.');
                    store.set(to, store.get(from));
                    store.delete(from);
                },
                deleteFile: async ({ path }) => { store.delete(path); },
            },
        },
    };
}

test.describe('Crypto parity (Chromium half, #150)', () => {
    test('web -> device: Chromium unlocks the Node-sealed fixture, field-for-field including non-ASCII', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');

        const document = await page.evaluate(async ({ vault, password }) => {
            const cryptoMod = await import('/static/js/crypto.js');
            const { document: doc } = await cryptoMod.unlockVault(vault, password);
            return doc;
        }, { vault: NODE_FIXTURE.vault, password: NODE_FIXTURE.password });

        expect(document).toEqual(NODE_FIXTURE.document);
        expect(document.nodes[2].title).toBe('Mémé, who carried me to the attic 🕯️');
        expect(document.nodes[2].story).toContain('até');
    });

    test('Chromium-side self-check: Chromium unlocks the Chromium-sealed fixture (catches a Chromium-side envelope drift directly)', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');

        const document = await page.evaluate(async ({ vault, password }) => {
            const cryptoMod = await import('/static/js/crypto.js');
            const { document: doc } = await cryptoMod.unlockVault(vault, password);
            return doc;
        }, { vault: CHROMIUM_FIXTURE.vault, password: CHROMIUM_FIXTURE.password });

        expect(document).toEqual(CHROMIUM_FIXTURE.document);
    });

    test('native storage seam inside a real browser engine: seal, store via NativePersistence (Capacitor shim), reload, unlock', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await page.evaluate(installCapacitorShim);

        const result = await page.evaluate(async ({ documentObj, password, recoveryCode, iterations }) => {
            const cryptoMod = await import('/static/js/crypto.js');
            const { NativePersistence } = await import('/static/js/native-persistence.js');

            const { vault } = await cryptoMod.createVault(documentObj, password, { recoveryCode, iterations });
            const serialized = cryptoMod.serializeVault(vault);

            const native = new NativePersistence();
            await native.saveVault(serialized);
            const loaded = await native.loadVault();

            const parsed = cryptoMod.parseVault(loaded);
            const { document: doc } = await cryptoMod.unlockVault(parsed, password);

            return { loadedEqualsSerialized: loaded === serialized, document: doc };
        }, {
            documentObj: fixtureDocument(), password: FIXTURE_PASSWORD, recoveryCode: FIXTURE_RECOVERY_CODE, iterations: FAST_ITERATIONS,
        });

        // The blob NativePersistence hands back after save+load must be byte-identical to what
        // was written — the property the real Filesystem plugin's `encoding: 'utf8'` is relied on
        // to preserve.
        expect(result.loadedEqualsSerialized).toBe(true);
        expect(result.document).toEqual(fixtureDocument());
    });
});
