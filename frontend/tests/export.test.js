import { describe, it, expect, vi } from 'vitest';
import { importMap } from '../js/export.js';

describe('importMap', () => {
    it('recreates nodes, parent links, and edges with id remapping', async () => {
        let counter = 100;
        const api = {
            post: vi.fn(async () => ({ id: ++counter })),
            put: vi.fn(async () => ({}))
        };
        const data = {
            nodes: [
                { id: 1, type: 'event', title: 'A', parent_id: null },
                { id: 2, type: 'emotion', title: 'B', parent_id: 1 }
            ],
            edges: [{ from: 1, to: 2, label: 'rel' }]
        };

        const result = await importMap(data, api);

        expect(result).toEqual({ nodeCount: 2, edgeCount: 1 });
        // B (new id 102) reparented under A (new id 101)
        expect(api.put).toHaveBeenCalledWith('/node/102', { parent_id: 101 });
        // edge remapped to the new ids
        expect(api.post).toHaveBeenCalledWith('/edge', { from_node_id: 101, to_node_id: 102, label: 'rel' });
    });

    it('rejects a file that is not a map export', async () => {
        const api = { post: vi.fn(), put: vi.fn() };
        await expect(importMap({ foo: 'bar' }, api)).rejects.toThrow();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('skips edges whose endpoints are missing', async () => {
        let counter = 0;
        const api = { post: vi.fn(async () => ({ id: ++counter })), put: vi.fn() };
        const data = { nodes: [{ id: 1, type: 'event', title: 'A' }], edges: [{ from: 1, to: 999 }] };

        const result = await importMap(data, api);

        expect(result).toEqual({ nodeCount: 1, edgeCount: 1 });
        expect(api.post).toHaveBeenCalledTimes(1); // node only — the dangling edge is skipped
    });
});
