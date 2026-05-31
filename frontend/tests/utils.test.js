import { describe, it, expect } from 'vitest';
import { extractNodeId, validateNodeData, countNodes, walkNodes, convertToMindElixirFormat } from '../js/utils.js';

describe('extractNodeId', () => {
    it('extracts numeric id from node-123 format', () => {
        expect(extractNodeId('node-123')).toBe(123);
    });

    it('extracts id from node-1', () => {
        expect(extractNodeId('node-1')).toBe(1);
    });

    it('returns null for invalid format', () => {
        expect(extractNodeId('invalid')).toBeNull();
        expect(extractNodeId('node-')).toBeNull();
        expect(extractNodeId('node-abc')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(extractNodeId(123)).toBeNull();
        expect(extractNodeId(null)).toBeNull();
        expect(extractNodeId(undefined)).toBeNull();
    });

    it('rejects partial matches like node-123-extra', () => {
        expect(extractNodeId('node-123-extra')).toBeNull();
    });
});

describe('validateNodeData', () => {
    it('accepts valid node data', () => {
        const result = validateNodeData({ node_type: 'event', title: 'Test' });
        expect(result.valid).toBe(true);
    });

    it('rejects missing node type', () => {
        const result = validateNodeData({ node_type: '', title: 'Test' });
        expect(result.valid).toBe(false);
    });

    it('rejects invalid node type', () => {
        const result = validateNodeData({ node_type: 'invalid', title: 'Test' });
        expect(result.valid).toBe(false);
    });

    it('rejects empty title', () => {
        const result = validateNodeData({ node_type: 'event', title: '' });
        expect(result.valid).toBe(false);
    });

    it('rejects whitespace-only title', () => {
        const result = validateNodeData({ node_type: 'event', title: '   ' });
        expect(result.valid).toBe(false);
    });

    it('rejects title over 200 chars', () => {
        const result = validateNodeData({ node_type: 'event', title: 'x'.repeat(201) });
        expect(result.valid).toBe(false);
    });

    it('rejects description over 5000 chars', () => {
        const result = validateNodeData({
            node_type: 'event',
            title: 'Test',
            description: 'x'.repeat(5001)
        });
        expect(result.valid).toBe(false);
    });

    it('accepts all valid node types', () => {
        const types = ['event', 'emotion', 'person', 'place', 'trigger', 'coping', 'insight', 'growth'];
        for (const type of types) {
            expect(validateNodeData({ node_type: type, title: 'Test' }).valid).toBe(true);
        }
    });
});

describe('countNodes', () => {
    it('counts a single node', () => {
        expect(countNodes({ id: '1', topic: 'root' })).toBe(1);
    });

    it('counts nested tree', () => {
        const tree = {
            id: '1', topic: 'root',
            children: [
                { id: '2', topic: 'child1' },
                {
                    id: '3', topic: 'child2',
                    children: [
                        { id: '4', topic: 'grandchild' }
                    ]
                }
            ]
        };
        expect(countNodes(tree)).toBe(4);
    });

    it('returns 0 for null', () => {
        expect(countNodes(null)).toBe(0);
    });
});

describe('walkNodes', () => {
    it('visits all nodes', () => {
        const visited = [];
        const tree = {
            id: '1', topic: 'root',
            children: [
                { id: '2', topic: 'child' }
            ]
        };
        walkNodes(tree, (node) => visited.push(node.id));
        expect(visited).toEqual(['1', '2']);
    });

    it('handles null gracefully', () => {
        const visited = [];
        walkNodes(null, (node) => visited.push(node));
        expect(visited).toEqual([]);
    });
});

describe('convertToMindElixirFormat', () => {
    it('returns null for an empty map', () => {
        expect(convertToMindElixirFormat({ nodes: [], edges: [] })).toBeNull();
    });

    it('rebuilds a nested tree from parent_id under the stable root', () => {
        const mapData = {
            nodes: [
                { id: 1, node_type: 'event', title: 'Top', parent_id: null },
                { id: 2, node_type: 'emotion', title: 'Child', parent_id: 1 },
                { id: 3, node_type: 'coping', title: 'Grandchild', parent_id: 2 }
            ],
            edges: []
        };
        const me = convertToMindElixirFormat(mapData);
        expect(me.nodeData.id).toBe('root');
        expect(me.nodeData.root).toBe(true);
        const top = me.nodeData.children[0];
        expect(top.id).toBe('node-1');
        expect(top.children[0].id).toBe('node-2');
        expect(top.children[0].children[0].id).toBe('node-3');
    });

    it('always uses the stable root for multiple top-level nodes', () => {
        const mapData = {
            nodes: [
                { id: 1, node_type: 'event', title: 'A', parent_id: null },
                { id: 2, node_type: 'emotion', title: 'B', parent_id: null }
            ],
            edges: []
        };
        const me = convertToMindElixirFormat(mapData);
        expect(me.nodeData.id).toBe('root');
        expect(me.nodeData.children.map((c) => c.id).sort()).toEqual(['node-1', 'node-2']);
    });

    it('converts edges to link data', () => {
        const mapData = {
            nodes: [
                { id: 1, node_type: 'event', title: 'A', parent_id: null },
                { id: 2, node_type: 'emotion', title: 'B', parent_id: 1 }
            ],
            edges: [{ id: 5, from_node_id: 1, to_node_id: 2, label: 'rel' }]
        };
        const me = convertToMindElixirFormat(mapData);
        expect(me.linkData['link-5'].from).toBe('node-1');
        expect(me.linkData['link-5'].to).toBe('node-2');
    });
});
