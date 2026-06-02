import { describe, it, expect } from 'vitest';
import {
    VaultStore, emptyDocument, migrateDocument, CURRENT_SCHEMA_VERSION,
} from '../js/vault-store.js';

describe('VaultStore', () => {
    it('starts empty with default settings', () => {
        const s = new VaultStore();
        expect(s.getMindmap().nodes).toHaveLength(0);
        expect(s.getSettings().theme).toBe('light');
    });

    it('adds and updates nodes with client-assigned ids', () => {
        const s = new VaultStore();
        const a = s.addNode({ node_type: 'event', title: 'First' });
        const b = s.addNode({ node_type: 'emotion', title: 'Second' });
        expect([a.id, b.id]).toEqual([1, 2]);
        s.updateNode(a.id, { title: 'Renamed', description: 'note' });
        expect(s.getMindmap().nodes.find((n) => n.id === a.id).title).toBe('Renamed');
    });

    it('requires a non-empty title', () => {
        const s = new VaultStore();
        expect(() => s.addNode({ node_type: 'event', title: '   ' })).toThrow(/Title/);
    });

    it('deletes a node, removes its edges, and reparents children up one level', () => {
        const s = new VaultStore();
        const root = s.addNode({ node_type: 'event', title: 'root' });
        const mid = s.addNode({ node_type: 'emotion', title: 'mid', parent_id: root.id });
        const leaf = s.addNode({ node_type: 'growth', title: 'leaf', parent_id: mid.id });
        s.addEdge({ from_node_id: root.id, to_node_id: mid.id });

        s.deleteNode(mid.id);

        expect(s.getMindmap().nodes.map((n) => n.id)).toEqual([root.id, leaf.id]);
        expect(s.getMindmap().nodes.find((n) => n.id === leaf.id).parent_id).toBe(root.id);
        expect(s.getMindmap().edges).toHaveLength(0);
    });

    it('validates edge endpoints and deletes edges', () => {
        const s = new VaultStore();
        const a = s.addNode({ node_type: 'event', title: 'a' });
        const b = s.addNode({ node_type: 'event', title: 'b' });
        expect(() => s.addEdge({ from_node_id: a.id, to_node_id: 999 })).toThrow(/endpoints/);
        const e = s.addEdge({ from_node_id: a.id, to_node_id: b.id, label: 'leads to' });
        expect(s.deleteEdge(e.id)).toBe(true);
        expect(s.getMindmap().edges).toHaveLength(0);
    });

    it('merges settings', () => {
        const s = new VaultStore();
        s.setSettings({ fontSize: 'large' });
        expect(s.getSettings()).toEqual({ theme: 'light', fontSize: 'large' });
    });

    it('round-trips through toDocument / fromDocument and continues ids', () => {
        const s = new VaultStore();
        s.addNode({ node_type: 'event', title: 'persist me' });
        const reloaded = VaultStore.fromDocument(JSON.parse(JSON.stringify(s.toDocument())));
        expect(reloaded.getMindmap().nodes[0].title).toBe('persist me');
        expect(reloaded.addNode({ node_type: 'event', title: 'next' }).id).toBe(2);
    });

    it('runs registered migrations in order (retro-compat mechanism)', () => {
        const migrations = {
            2: (d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, migrated: true })) }),
            3: (d) => ({ ...d, tag: 'v3' }),
        };
        const v1 = { ...emptyDocument(), schemaVersion: 1, nodes: [{ id: 1, title: 'old' }] };
        const out = migrateDocument(v1, migrations);
        expect(out.schemaVersion).toBe(3);
        expect(out.nodes[0].migrated).toBe(true);
        expect(out.tag).toBe('v3');
    });

    it('a fresh document is at the current schema version', () => {
        expect(emptyDocument().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
});
