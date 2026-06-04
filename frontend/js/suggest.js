import { NODE_TYPES } from './config.js';

/**
 * suggestLinks — Wymber's discovery engine (ADR-0002, first cut).
 *
 * Given the map's nodes and edges, propose a few *possible* links the user might want, never
 * adding anything. Pure logic (no DOM, no api), so it is fully unit-testable and easy to swap.
 *
 * v1 signal, intentionally conservative (surfaced behind a quiet, opt-in prompt):
 *   A) Shared keywords, the primary co-occurrence signal from the node detail drawer (#108).
 *   B) An "anchor gap" hint from the type model: a trigger or need with no coping/support nearby
 *      gets one gentle suggestion of an existing anchor. Gated to a real gap so it stays low
 *      volume and never presumes meaning between arbitrary nodes.
 *
 * "Driving suggestions" is meant to grow into its own topic; keep this seam clean and revisable.
 */

const norm = (s) => (s || '').trim().toLowerCase();
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function sharedKeywords(a, b) {
    const setB = new Set((b.keywords || []).map(norm).filter(Boolean));
    const out = [];
    const seen = new Set();
    for (const kw of a.keywords || []) {
        const n = norm(kw);
        if (n && setB.has(n) && !seen.has(n)) {
            seen.add(n);
            out.push(kw);
        }
    }
    return out;
}

// Roles that can steady a distressing node, and the types that reach for one.
const ANCHOR_TYPES = new Set(['coping', 'support']);
const SEEKS_ANCHOR = new Set(['trigger', 'need']);

/**
 * @returns {Array<{from_node_id, to_node_id, score, reason}>} ranked, capped suggestions.
 */
export function suggestLinks(nodes = [], edges = [], { max = 8 } = {}) {
    if (!Array.isArray(nodes) || nodes.length < 2) return [];

    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Existing connections (explicit edges + parent_id), undirected, plus adjacency.
    const connected = new Set();
    const neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    const connect = (x, y) => {
        if (!byId.has(x) || !byId.has(y) || x === y) return;
        connected.add(pairKey(x, y));
        neighbors.get(x).add(y);
        neighbors.get(y).add(x);
    };
    for (const e of edges || []) connect(e.from_node_id, e.to_node_id);
    for (const n of nodes) if (n.parent_id != null) connect(n.id, n.parent_id);

    const suggestions = new Map(); // pairKey -> suggestion

    // A) Shared keywords (primary signal).
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const key = pairKey(a.id, b.id);
            if (connected.has(key)) continue;
            const shared = sharedKeywords(a, b);
            if (shared.length === 0) continue;
            const reason = shared.length === 1
                ? `Both mention "${shared[0]}"`
                : `Both mention ${shared.slice(0, 2).map((k) => `"${k}"`).join(' and ')}`;
            suggestions.set(key, { from_node_id: a.id, to_node_id: b.id, score: 3 * shared.length, reason });
        }
    }

    // B) Anchor-gap hint: a trigger/need with no coping/support neighbour gets one gentle anchor.
    for (const n of nodes) {
        if (!SEEKS_ANCHOR.has(n.node_type)) continue;
        const hasAnchor = [...neighbors.get(n.id)].some((id) => ANCHOR_TYPES.has(byId.get(id)?.node_type));
        if (hasAnchor) continue;
        const anchors = nodes.filter((m) =>
            ANCHOR_TYPES.has(m.node_type) && m.id !== n.id && !connected.has(pairKey(n.id, m.id)));
        if (anchors.length === 0) continue;
        // Best anchor: most shared keywords, then most recently touched.
        anchors.sort((p, q) =>
            sharedKeywords(n, q).length - sharedKeywords(n, p).length
            || String(q.updated_at || '').localeCompare(String(p.updated_at || '')));
        const best = anchors[0];
        const key = pairKey(n.id, best.id);
        if (suggestions.has(key)) continue; // a keyword suggestion already covers this pair
        const word = n.node_type === 'trigger' ? 'trigger' : 'need';
        const anchorLabel = NODE_TYPES[best.node_type]?.label || best.node_type;
        suggestions.set(key, {
            from_node_id: n.id,
            to_node_id: best.id,
            score: 2,
            reason: `This ${word} has no anchor yet; this ${anchorLabel.toLowerCase()} could steady it`,
        });
    }

    return [...suggestions.values()]
        .sort((p, q) => q.score - p.score)
        .slice(0, max);
}
