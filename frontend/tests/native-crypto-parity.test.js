// @vitest-environment node
//
// Cross-platform crypto parity (#150, ADR-0005 consequence, ADR-0001 crypto): "a vault sealed on
// web must unlock on device, and vice versa (and across the native persistence backend)". The
// same crypto.js runs everywhere (ADR-0005), so the *algorithm* cannot diverge by construction —
// what this guards against is the serialized envelope format drifting incompatibly over time, and
// the native storage encoding (Capacitor Filesystem's `encoding: 'utf8'`) mangling it. See
// e2e/parity/README.md for the fixtures' provenance, freezing policy, and the Chromium half of
// this test (e2e/parity/crypto-parity.spec.js).
//
// The frozen fixtures were sealed with the real DEFAULT_ITERATIONS (600k), so every unlock here
// runs real PBKDF2 — this file is deliberately spare with how many it does.
//
// Fixtures are imported directly as plain `.js` modules (not read from `.json` via `node:fs`):
// this file is also exercised indirectly by tooling that expects a plain `import`, and the
// sibling e2e/parity/crypto-parity.spec.js (Playwright) needs the exact same fixtures loadable
// with a plain `import` too — see e2e/parity/README.md for why `.mjs` / `import.meta.url` don't
// work there.
import { describe, it, expect, afterEach } from 'vitest';
import {
    unlockVault, parseVault, serializeVault, createVault, DEFAULT_ITERATIONS, VAULT_FORMAT, VAULT_VERSION,
} from '../js/crypto.js';
import { NativePersistence } from '../js/native-persistence.js';
import { fixtureDocument, FIXTURE_PASSWORD, FIXTURE_RECOVERY_CODE } from '../../e2e/parity/fixtures/fixture-document.js';
import { nodeSealedFixture } from '../../e2e/parity/fixtures/node-sealed.vault.js';
import { chromiumSealedFixture } from '../../e2e/parity/fixtures/chromium-sealed.vault.js';

const NODE_FIXTURE = nodeSealedFixture;
const CHROMIUM_FIXTURE = chromiumSealedFixture;

/** A minimal in-memory stand-in for window.Capacitor.Plugins.Filesystem (house style, see
 * frontend/tests/native-persistence.test.js). Only the methods NativePersistence uses. */
function makeFs(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
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
    };
}

function installNativeShell(fs) {
    globalThis.Capacitor = { Plugins: { Filesystem: fs }, isNativePlatform: () => true };
}

afterEach(() => { delete globalThis.Capacitor; });

describe('fixture provenance sanity (both fixtures came from the same document)', () => {
    it('the frozen fixtures record the same document that fixtureDocument() builds today', () => {
        expect(NODE_FIXTURE.document).toEqual(fixtureDocument());
        expect(CHROMIUM_FIXTURE.document).toEqual(fixtureDocument());
    });

    it('both fixtures were sealed with the real DEFAULT_ITERATIONS, not a shortcut', () => {
        expect(NODE_FIXTURE.vault.kdf.iterations).toBe(DEFAULT_ITERATIONS);
        expect(CHROMIUM_FIXTURE.vault.kdf.iterations).toBe(DEFAULT_ITERATIONS);
    });
});

describe('device -> web: a Chromium-sealed vault unlocks under Node', () => {
    it('unlocks by password and the document matches field-for-field, including non-ASCII text', async () => {
        const { document } = await unlockVault(CHROMIUM_FIXTURE.vault, CHROMIUM_FIXTURE.password);
        expect(document).toEqual(CHROMIUM_FIXTURE.document);
        // Explicit non-ASCII spot-check (the fixture's node 3): accented text + emoji survive.
        expect(document.nodes[2].title).toBe('Mémé, who carried me to the attic 🕯️');
        expect(document.nodes[2].story).toContain('até');
    });

    it('unlocks by recovery code and the document matches field-for-field', async () => {
        const { document } = await unlockVault(CHROMIUM_FIXTURE.vault, CHROMIUM_FIXTURE.recoveryCode, 'recovery');
        expect(document).toEqual(CHROMIUM_FIXTURE.document);
    });
});

describe('web -> web (baseline) and web -> device format check: a Node-sealed vault', () => {
    it('unlocks by password and the document matches field-for-field, including non-ASCII text', async () => {
        const { document } = await unlockVault(NODE_FIXTURE.vault, NODE_FIXTURE.password);
        expect(document).toEqual(NODE_FIXTURE.document);
        expect(document.nodes[2].title).toBe('Mémé, who carried me to the attic 🕯️');
    });

    it('unlocks by recovery code and the document matches field-for-field', async () => {
        const { document } = await unlockVault(NODE_FIXTURE.vault, NODE_FIXTURE.recoveryCode, 'recovery');
        expect(document).toEqual(NODE_FIXTURE.document);
    });
});

describe('envelope structural invariants both frozen fixtures depend on', () => {
    it.each([['node', NODE_FIXTURE], ['chromium', CHROMIUM_FIXTURE]])('%s fixture: format/version/keys/base64', (_label, fixture) => {
        const { vault } = fixture;
        expect(vault.format).toBe(VAULT_FORMAT);
        expect(vault.version).toBe(VAULT_VERSION);
        expect(vault.cipher).toBe('AES-256-GCM');
        expect(vault.kdf.algo).toBe('PBKDF2-SHA256');
        // Both unlock methods' wraps must be present — a vault missing either can't be opened by
        // the corresponding "device -> web" or "web -> device" path this test exists to prove.
        expect(vault.keys.password).toBeTruthy();
        expect(vault.keys.recovery).toBeTruthy();
        const B64 = /^[A-Za-z0-9+/]+=*$/;
        // password/recovery wraps carry salt + nonce + ciphertext; the document payload has no
        // salt of its own (it's encrypted directly under the DEK) — just nonce + ciphertext.
        for (const entry of [vault.keys.password, vault.keys.recovery]) {
            expect(entry.salt).toMatch(B64);
            expect(entry.nonce).toMatch(B64);
            expect(entry.ct).toMatch(B64);
        }
        expect(vault.payload.nonce).toMatch(B64);
        expect(vault.payload.ct).toMatch(B64);
    });

    it.each([['node', NODE_FIXTURE], ['chromium', CHROMIUM_FIXTURE]])(
        '%s fixture: the serialized envelope is pure ASCII today',
        (_label, fixture) => {
            // Guards the `encoding: 'utf8'` native storage path (NativePersistence): the envelope
            // is base64 + JSON structure today, so it happens to be ASCII-only. If a future
            // envelope change ever introduced non-ASCII bytes (e.g. embedding a raw string field),
            // this assertion trips a test here instead of silently risking mangling on-device,
            // where `encoding: 'utf8'` is what actually round-trips the bytes.
            const serialized = serializeVault(fixture.vault);
            // eslint-disable-next-line no-control-regex
            expect(/^[\x00-\x7F]*$/.test(serialized)).toBe(true);
        }
    );
});

describe('the serialized envelope survives a real UTF-8 encode/decode byte-for-byte', () => {
    it('TextEncoder -> TextDecoder round-trips the frozen fixtures exactly', () => {
        for (const fixture of [NODE_FIXTURE, CHROMIUM_FIXTURE]) {
            const serialized = serializeVault(fixture.vault);
            const bytes = new TextEncoder().encode(serialized);
            const back = new TextDecoder().decode(bytes);
            expect(back).toBe(serialized);
        }
    });

    it('TextEncoder -> TextDecoder round-trips a freshly-sealed vault containing the non-ASCII document', async () => {
        // This is the assertion that would actually catch a UTF-8 mangling regression: seal a
        // vault fresh (so it reflects whatever crypto.js does *right now*, not a frozen fixture),
        // then push its serialized form through the exact encode/decode pair `encoding: 'utf8'`
        // performs on the native storage path.
        const { vault } = await createVault(fixtureDocument(), FIXTURE_PASSWORD, {
            recoveryCode: FIXTURE_RECOVERY_CODE,
            iterations: 1000, // this vault is thrown away immediately after; low cost keeps it fast
        });
        const serialized = serializeVault(vault);
        const roundTripped = new TextDecoder().decode(new TextEncoder().encode(serialized));
        expect(roundTripped).toBe(serialized);
        const { document } = await unlockVault(parseVault(roundTripped), FIXTURE_PASSWORD);
        expect(document).toEqual(fixtureDocument());
    });
});

describe('across the native persistence backend: seal in Node, round-trip via NativePersistence', () => {
    it('a vault sealed in Node survives NativePersistence save/load unchanged', async () => {
        const { vault } = await createVault(fixtureDocument(), FIXTURE_PASSWORD, {
            recoveryCode: FIXTURE_RECOVERY_CODE,
            iterations: 1000,
        });
        const serialized = serializeVault(vault);

        installNativeShell(makeFs());
        const native = new NativePersistence();
        await native.saveVault(serialized);
        const loadedFromNative = await native.loadVault();

        // Byte-identical: NativePersistence must hand back exactly what was written, never a
        // mutated string (that's the property the `utf8` encoding on the real Filesystem plugin
        // is expected to preserve; the mock here stands in for that plugin, house style per
        // frontend/tests/native-persistence.test.js).
        expect(loadedFromNative).toBe(serialized);

        const { document } = await unlockVault(parseVault(loadedFromNative), FIXTURE_PASSWORD);
        expect(document).toEqual(fixtureDocument());
    });

    // NOTE: the web <-> native storage crossing itself is deliberately NOT tested here.
    // persistence.js (the real web backend) is OPFS/IndexedDB and browser-only, so under Node it
    // could only be stood in for by an in-memory fake — and comparing a fake's output against
    // NativePersistence's would reduce to asserting a string equals itself. That test lives in
    // e2e/parity/crypto-parity.spec.js instead, where BOTH backends are the real implementations.
});
