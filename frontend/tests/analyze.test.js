import { describe, it, expect } from 'vitest';
import { analyzeMap } from '../js/analyze.js';

describe('analyzeMap', () => {
    it('returns correct totals', () => {
        const nodes = [
            { id: 1, node_type: 'event', title: 'A' },
            { id: 2, node_type: 'emotion', title: 'B' }
        ];
        const edges = [{ from_node_id: 1, to_node_id: 2 }];
        const result = analyzeMap(nodes, edges);

        expect(result.totalNodes).toBe(2);
        expect(result.totalEdges).toBe(1);
    });

    it('counts by type correctly', () => {
        const nodes = [
            { id: 1, node_type: 'event', title: 'A' },
            { id: 2, node_type: 'event', title: 'B' },
            { id: 3, node_type: 'coping', title: 'C' }
        ];
        const result = analyzeMap(nodes, []);

        expect(result.typeCounts.event).toBe(2);
        expect(result.typeCounts.coping).toBe(1);
        expect(result.typeCounts.emotion).toBe(0);
    });

    it('finds isolated nodes', () => {
        const nodes = [
            { id: 1, node_type: 'event', title: 'Connected' },
            { id: 2, node_type: 'event', title: 'Also connected' },
            { id: 3, node_type: 'event', title: 'Isolated' }
        ];
        const edges = [{ from_node_id: 1, to_node_id: 2 }];
        const result = analyzeMap(nodes, edges);

        expect(result.isolatedNodes).toHaveLength(1);
        expect(result.isolatedNodes[0].title).toBe('Isolated');
    });

    it('finds most connected node', () => {
        const nodes = [
            { id: 1, node_type: 'event', title: 'Hub' },
            { id: 2, node_type: 'event', title: 'Leaf1' },
            { id: 3, node_type: 'event', title: 'Leaf2' }
        ];
        const edges = [
            { from_node_id: 1, to_node_id: 2 },
            { from_node_id: 1, to_node_id: 3 }
        ];
        const result = analyzeMap(nodes, edges);

        expect(result.mostConnected.title).toBe('Hub');
        expect(result.mostConnectedCount).toBe(2);
    });

    it('lists missing types', () => {
        const nodes = [{ id: 1, node_type: 'event', title: 'A' }];
        const result = analyzeMap(nodes, []);

        expect(result.missingTypes).toContain('Emotion');
        expect(result.missingTypes).toContain('Person');
        expect(result.missingTypes).not.toContain('Event');
    });

    it('handles empty map', () => {
        const result = analyzeMap([], []);
        expect(result.totalNodes).toBe(0);
        expect(result.totalEdges).toBe(0);
        expect(result.isolatedNodes).toEqual([]);
        expect(result.mostConnected).toBeNull();
    });

    it('treats parent/child hierarchy as connections', () => {
        const nodes = [
            { id: 1, node_type: 'event', title: 'Parent', parent_id: null },
            { id: 2, node_type: 'emotion', title: 'Child', parent_id: 1 },
            { id: 3, node_type: 'event', title: 'Lonely', parent_id: null }
        ];
        const result = analyzeMap(nodes, []);
        // 1 and 2 are linked by hierarchy; 3 has no parent/child/edge -> isolated.
        expect(result.isolatedNodes.map(n => n.id)).toEqual([3]);
        expect(result.totalConnections).toBe(1);
    });
});
