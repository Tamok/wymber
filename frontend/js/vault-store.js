/**
 * Wymber local document store — the decrypted, in-memory map.
 *
 * This is the local-first replacement for the server: it owns the nodes/edges/settings
 * document, assigns ids client-side, and exposes the same surface the UI needs. It is
 * pure logic (no DOM, no crypto, no network) so it is fully unit-testable and can sit
 * behind the existing `api.js` seam. The encrypted-at-rest form is produced by crypto.js.
 */

export const DOC_SCHEMA = 'wymber-map';
export const CURRENT_SCHEMA_VERSION = 2;

/** Document migrations, keyed by the version they PRODUCE (e.g. 2 upgrades v1 → v2). */
export const DOC_MIGRATIONS = {
    // v2 gives every node a `story` (the user's own narrative, in their words) and
    // `keywords` (tags that double as discovery fuel; shared keywords hint at latent links).
    2: (doc) => ({
        ...doc,
        nodes: (doc.nodes || []).map((n) => ({ story: '', keywords: [], ...n })),
    }),
};

export function emptyDocument() {
    return {
        schema: DOC_SCHEMA,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        nodes: [],
        edges: [],
        settings: { theme: 'light', fontSize: 'medium' },
    };
}

/**
 * Bring a document up to the current schema by running each registered migration in order.
 * `migrations` is injectable for testing the mechanism.
 */
export function migrateDocument(doc, migrations = DOC_MIGRATIONS) {
    let d = { ...doc };
    let v = d.schemaVersion || 1;
    while (migrations[v + 1]) {
        d = migrations[v + 1](d);
        v += 1;
        d.schemaVersion = v;
    }
    return d;
}

const nowISO = () => new Date().toISOString();
const maxId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0);

export class VaultStore {
    constructor(documentObj) {
        const doc = documentObj || emptyDocument();
        this.doc = {
            ...emptyDocument(),
            ...doc,
            settings: { ...emptyDocument().settings, ...(doc.settings || {}) },
        };
        this._nodeSeq = maxId(this.doc.nodes);
        this._edgeSeq = maxId(this.doc.edges);
    }

    /** Construct from a (possibly older) document, migrating it first. */
    static fromDocument(documentObj, migrations) {
        return new VaultStore(migrateDocument(documentObj, migrations));
    }

    toDocument() {
        return this.doc;
    }

    getMindmap() {
        return { nodes: this.doc.nodes, edges: this.doc.edges };
    }

    // ----- nodes -----

    addNode({ node_type, title, description = '', story = '', keywords = [], x = 0, y = 0, parent_id = null }) {
        if (!node_type) throw new Error('node_type is required');
        if (!title || !title.trim()) throw new Error('Title is required');
        const node = {
            id: ++this._nodeSeq,
            node_type,
            title: title.trim(),
            description,
            story,
            keywords: Array.isArray(keywords) ? keywords : [],
            x,
            y,
            parent_id,
            created_at: nowISO(),
            updated_at: nowISO(),
        };
        this.doc.nodes.push(node);
        return node;
    }

    updateNode(id, patch = {}) {
        const node = this.doc.nodes.find((n) => n.id === id);
        if (!node) throw new Error(`Node ${id} not found`);
        for (const key of ['node_type', 'title', 'description', 'story', 'keywords', 'x', 'y', 'parent_id']) {
            if (key in patch) node[key] = patch[key];
        }
        node.updated_at = nowISO();
        return node;
    }

    /**
     * Delete a node. Incident edges are removed; direct children are re-linked to the
     * deleted node's parent (orphan up one level) rather than cascade-deleting the subtree —
     * deliberately non-destructive for a trauma map.
     */
    deleteNode(id) {
        const node = this.doc.nodes.find((n) => n.id === id);
        if (!node) return false;
        this.doc.nodes = this.doc.nodes.filter((n) => n.id !== id);
        this.doc.edges = this.doc.edges.filter((e) => e.from_node_id !== id && e.to_node_id !== id);
        for (const child of this.doc.nodes) {
            if (child.parent_id === id) child.parent_id = node.parent_id ?? null;
        }
        return true;
    }

    // ----- edges -----

    addEdge({ from_node_id, to_node_id, label = '' }) {
        const ids = new Set(this.doc.nodes.map((n) => n.id));
        if (!ids.has(from_node_id) || !ids.has(to_node_id)) {
            throw new Error('Both endpoints must be existing nodes');
        }
        // Linking is idempotent: two nodes can be connected at most once. If an edge already
        // joins this pair (in either direction), return it instead of stacking a duplicate.
        const existing = this.doc.edges.find(
            (e) => (e.from_node_id === from_node_id && e.to_node_id === to_node_id) ||
                   (e.from_node_id === to_node_id && e.to_node_id === from_node_id)
        );
        if (existing) return existing;
        const edge = {
            id: ++this._edgeSeq,
            from_node_id,
            to_node_id,
            label,
            created_at: nowISO(),
        };
        this.doc.edges.push(edge);
        return edge;
    }

    deleteEdge(id) {
        const before = this.doc.edges.length;
        this.doc.edges = this.doc.edges.filter((e) => e.id !== id);
        return this.doc.edges.length < before;
    }

    // ----- settings -----

    getSettings() {
        return this.doc.settings;
    }

    setSettings(patch = {}) {
        this.doc.settings = { ...this.doc.settings, ...patch };
        return this.doc.settings;
    }
}
