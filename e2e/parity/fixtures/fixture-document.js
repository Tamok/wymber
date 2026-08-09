/**
 * Shared inputs for the FROZEN crypto-parity fixtures (issue #150). Both `generate.node.mjs`
 * and `generate.chromium.mjs` import this so the two fixtures are sealed from byte-identical
 * inputs — only the platform (Node's WebCrypto vs Chromium's) differs.
 *
 * TEST FIXTURE ONLY: this password and recovery code are throwaway secrets that exist only to
 * seal the frozen fixture modules under `e2e/parity/fixtures/`. Never real credentials.
 *
 * Do NOT edit this document lightly: the frozen fixtures were sealed from exactly this object.
 * See `e2e/parity/README.md` before regenerating anything.
 *
 * Plain `.js` + `import`/`export` on purpose (not `.mjs`, no `import.meta`): this file is loaded
 * by both vitest and Playwright, and `.mjs` forces ESM in a way that collides with Playwright's
 * CJS-leaning transform for `.js` specs in a package with no `"type": "module"` (see the sibling
 * `e2e/helpers.js`, which uses the same plain style).
 */

// Deliberately not derived from crypto.js's generateRecoveryCode() so this file has zero
// dependency on the module under test — the fixture inputs must be inert, plain data.
export const FIXTURE_PASSWORD = 'fixture-only-not-a-real-secret-Xk9!mQ';
export const FIXTURE_RECOVERY_CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23';

/**
 * A document that exercises the real schema: several node types, edges, populated `story` /
 * `keywords`, settings, and non-ASCII text (accented characters + an emoji) in node 3's title
 * and story — the part that would catch a UTF-8 mangling regression in the native `encoding:
 * 'utf8'` storage path (NativePersistence).
 */
export function fixtureDocument() {
    return {
        schema: 'wymber-map',
        schemaVersion: 2,
        nodes: [
            {
                id: 1,
                node_type: 'event',
                title: 'The storm that flooded the house',
                description: 'It happened in late spring.',
                story: 'Water rose past the windows before we could react.',
                keywords: ['flood', 'home', 'fear'],
                x: 100,
                y: 120,
                parent_id: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
                id: 2,
                node_type: 'emotion',
                title: 'Panic, still here sometimes',
                description: '',
                story: 'A tightness in my chest when it rains hard.',
                keywords: ['fear', 'panic'],
                x: 220,
                y: 120,
                parent_id: 1,
                created_at: '2026-01-01T00:05:00.000Z',
                updated_at: '2026-01-01T00:05:00.000Z',
            },
            {
                id: 3,
                node_type: 'person',
                title: 'Mémé, who carried me to the attic 🕯️',
                description: 'Grandmother',
                story: 'She never let go of my hand, not once, not até we were safe.',
                keywords: ['family', 'safety', 'café'],
                x: 340,
                y: 200,
                parent_id: 1,
                created_at: '2026-01-01T00:10:00.000Z',
                updated_at: '2026-01-01T00:10:00.000Z',
            },
            {
                id: 4,
                node_type: 'coping',
                title: 'Naming the sound of rain out loud',
                description: '',
                story: 'Saying "it is just rain" helps slow my breath.',
                keywords: ['grounding', 'breath'],
                x: 100,
                y: 260,
                parent_id: 2,
                created_at: '2026-01-01T00:15:00.000Z',
                updated_at: '2026-01-01T00:15:00.000Z',
            },
            {
                id: 5,
                node_type: 'growth',
                title: 'I can watch rain from a window now',
                description: '',
                story: 'Small, but it used to be impossible.',
                keywords: ['progress'],
                x: 220,
                y: 320,
                parent_id: 4,
                created_at: '2026-01-01T00:20:00.000Z',
                updated_at: '2026-01-01T00:20:00.000Z',
            },
        ],
        edges: [
            { id: 1, from_node_id: 1, to_node_id: 2, label: 'led to', created_at: '2026-01-01T00:06:00.000Z' },
            { id: 2, from_node_id: 2, to_node_id: 4, label: 'managed by', created_at: '2026-01-01T00:16:00.000Z' },
            { id: 3, from_node_id: 1, to_node_id: 3, label: 'protected by', created_at: '2026-01-01T00:11:00.000Z' },
            { id: 4, from_node_id: 4, to_node_id: 5, label: '', created_at: '2026-01-01T00:21:00.000Z' },
        ],
        settings: { theme: 'soft', fontSize: 'medium', palette: 'default' },
    };
}
