import { describe, it, expect } from 'vitest';
import { suggestLinks } from '../js/suggest.js';

const node = (id, node_type, title, extra = {}) => ({
    id, node_type, title, keywords: [], parent_id: null, ...extra,
});

describe('suggestLinks', () => {
    it('returns nothing for an empty or single-node map', () => {
        expect(suggestLinks([], [])).toEqual([]);
        expect(suggestLinks([node(1, 'event', 'A')], [])).toEqual([]);
    });

    it('suggests an unconnected pair that shares a keyword', () => {
        const nodes = [
            node(1, 'event', 'Storm', { keywords: ['rain'] }),
            node(2, 'emotion', 'Dread', { keywords: ['rain', 'night'] }),
        ];
        const out = suggestLinks(nodes, []);
        expect(out).toHaveLength(1);
        expect(out[0].from_node_id).toBe(1);
        expect(out[0].to_node_id).toBe(2);
        expect(out[0].reason).toMatch(/rain/);
    });

    it('matches keywords case-insensitively and de-dupes', () => {
        const nodes = [
            node(1, 'event', 'A', { keywords: ['Rain'] }),
            node(2, 'place', 'B', { keywords: ['rain'] }),
        ];
        expect(suggestLinks(nodes, [])).toHaveLength(1);
    });

    it('does not suggest a pair that is already connected by an edge', () => {
        const nodes = [
            node(1, 'event', 'A', { keywords: ['rain'] }),
            node(2, 'emotion', 'B', { keywords: ['rain'] }),
        ];
        const edges = [{ id: 1, from_node_id: 1, to_node_id: 2 }];
        expect(suggestLinks(nodes, edges)).toEqual([]);
    });

    it('treats a parent_id link as an existing connection', () => {
        const nodes = [
            node(1, 'event', 'A', { keywords: ['rain'] }),
            node(2, 'emotion', 'B', { keywords: ['rain'], parent_id: 1 }),
        ];
        expect(suggestLinks(nodes, [])).toEqual([]);
    });

    it('ranks a two-keyword overlap above a one-keyword overlap', () => {
        const nodes = [
            node(1, 'event', 'A', { keywords: ['rain', 'night'] }),
            node(2, 'emotion', 'B', { keywords: ['rain', 'night'] }),
            node(3, 'place', 'C', { keywords: ['rain'] }),
        ];
        const out = suggestLinks(nodes, []);
        expect(out[0].from_node_id).toBe(1);
        expect(out[0].to_node_id).toBe(2); // shares two keywords -> highest score
    });

    it('offers an anchor when a trigger has no coping/support neighbour', () => {
        const nodes = [
            node(1, 'trigger', 'Raised voices'),
            node(2, 'coping', 'Step outside'),
        ];
        const out = suggestLinks(nodes, []);
        expect(out).toHaveLength(1);
        expect(out[0].reason).toMatch(/anchor/i);
    });

    it('does not offer an anchor when the trigger already has one', () => {
        const nodes = [
            node(1, 'trigger', 'Raised voices'),
            node(2, 'coping', 'Step outside'),
        ];
        const edges = [{ id: 1, from_node_id: 1, to_node_id: 2 }];
        expect(suggestLinks(nodes, edges)).toEqual([]);
    });

    it('suggests nothing when there is no shared keyword and no anchor gap', () => {
        const nodes = [
            node(1, 'event', 'A', { keywords: ['sun'] }),
            node(2, 'emotion', 'B', { keywords: ['moon'] }),
        ];
        expect(suggestLinks(nodes, [])).toEqual([]);
    });

    it('caps the number of suggestions', () => {
        const nodes = [];
        for (let i = 1; i <= 12; i++) nodes.push(node(i, 'event', `N${i}`, { keywords: ['shared'] }));
        const out = suggestLinks(nodes, [], { max: 5 });
        expect(out).toHaveLength(5);
    });
});
