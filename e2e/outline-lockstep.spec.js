import { test, expect } from '@playwright/test';
import {
    createVaultAndOpenMap,
    addNode,
    linkNodes,
    unlinkFirstConnection,
    deleteNodeViaKeyboard,
} from './helpers.js';

// ADR-0004 makes #map-outline the accessible twin of the Cytoscape canvas: the primary
// non-visual surface, meant to never drift from the real graph. These tests prove lockstep
// (not just "the outline renders something") by reading the live Cytoscape instance straight
// off its container (`#mindmap`'s `_cyreg.cy`, confirmed reachable in the vendored
// frontend/libs/cytoscape.min.js) and diffing it against the outline DOM after every kind of
// edit: add, link, unlink, delete.

/**
 * The live graph, read directly from Cytoscape: node ids and edge pairs (as sorted
 * "id|id" strings, deduped). This is ground truth, independent of whatever the outline
 * twin renders.
 */
async function readGraph(page) {
    return page.evaluate(() => {
        const cy = document.getElementById('mindmap')?._cyreg?.cy;
        if (!cy) return null;
        return {
            nodeIds: cy.nodes().map((n) => n.id()).sort(),
            edgePairs: [...new Set(
                cy.edges().map((e) => [e.source().id(), e.target().id()].sort().join('|'))
            )].sort(),
        };
    });
}

/**
 * The outline twin, read the same shape as readGraph(): node ids come straight off each
 * button's data-node-id. Edge pairs are decoded from each item's "Connected to: A, B" text
 * by mapping titles back to ids via the outline's own title -> id map, so the comparison
 * still happens in id space rather than trusting titles to line up by coincidence.
 */
async function readOutline(page) {
    return page.evaluate(() => {
        const items = [...document.querySelectorAll('.map-outline-item')];
        const titleToId = new Map();
        items.forEach((li) => {
            const id = li.querySelector('.map-outline-node').dataset.nodeId;
            const title = li.querySelector('.map-outline-title')?.textContent || '';
            titleToId.set(title, id);
        });
        const edgeSet = new Set();
        items.forEach((li) => {
            const id = li.querySelector('.map-outline-node').dataset.nodeId;
            const connEl = li.querySelector('.map-outline-connections');
            if (!connEl) return;
            const rest = connEl.textContent.replace(/^Connected to:\s*/, '');
            rest.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
                const otherId = titleToId.get(t);
                if (otherId) edgeSet.add([id, otherId].sort().join('|'));
            });
        });
        return {
            nodeIds: items.map((li) => li.querySelector('.map-outline-node').dataset.nodeId).sort(),
            edgePairs: [...edgeSet].sort(),
        };
    });
}

async function assertLockstep(page) {
    const graph = await readGraph(page);
    expect(graph, '_cyreg.cy should be reachable on #mindmap').not.toBeNull();
    const outline = await readOutline(page);
    expect(outline.nodeIds, 'outline node ids should match the live graph').toEqual(graph.nodeIds);
    expect(outline.edgePairs, 'outline connections should match the live graph edges').toEqual(graph.edgePairs);
}

test.describe('Outline twin stays in lockstep with the live graph (ADR-0004)', () => {
    test('adding several nodes: the outline matches the graph on count and identity', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A rainy commute');
        await addNode(page, 'emotion', 'Low-grade dread');
        await addNode(page, 'coping', 'Called a friend');
        await assertLockstep(page);
        const outline = await readOutline(page);
        expect(outline.nodeIds).toHaveLength(3);
    });

    test('linking two nodes: the connection appears in the graph and the outline together', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A missed train');
        await addNode(page, 'body', 'Shoulders tight');
        await linkNodes(page, 'A missed train', 'Shoulders tight');
        await expect(page.locator('#map-outline')).toContainText('Connected to: Shoulders tight', { timeout: 5000 });
        await page.click('#select-mode-btn');
        await assertLockstep(page);
        const graph = await readGraph(page);
        expect(graph.edgePairs).toHaveLength(1);
    });

    test('unlinking two nodes: the connection disappears from both', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A quiet argument');
        await addNode(page, 'emotion', 'Guilt');
        await linkNodes(page, 'A quiet argument', 'Guilt');
        await expect(page.locator('#map-outline')).toContainText('Connected to: Guilt', { timeout: 5000 });
        await unlinkFirstConnection(page, 'A quiet argument');
        await expect(page.locator('#detail-connections')).toContainText(/no connections/i, { timeout: 5000 });
        await page.click('#detail-close');
        await assertLockstep(page);
        const graph = await readGraph(page);
        expect(graph.edgePairs).toEqual([]);
    });

    test('deleting a linked node: it disappears from both, and the survivor loses the dangling connection', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A long silence');
        await addNode(page, 'need', 'Wanted to be heard');
        await addNode(page, 'insight', 'Unrelated bystander');
        await linkNodes(page, 'A long silence', 'Wanted to be heard');
        await expect(page.locator('#map-outline')).toContainText('Connected to: Wanted to be heard', { timeout: 5000 });
        await page.click('#select-mode-btn');

        await deleteNodeViaKeyboard(page, 'A long silence');
        await expect(page.locator('#map-outline')).not.toContainText('A long silence', { timeout: 5000 });
        await expect(page.locator('.map-outline-node')).toHaveCount(2);

        // The survivor's own "Connected to" line must not still name the deleted node.
        const survivorItem = page.locator('.map-outline-item', { hasText: 'Wanted to be heard' });
        await expect(survivorItem).not.toContainText('A long silence');

        await assertLockstep(page);
        const graph = await readGraph(page);
        expect(graph.edgePairs).toEqual([]);
    });

    test('an empty map renders the honest empty state, not a stale outline', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await expect(page.locator('.map-outline-empty')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.map-outline-empty')).toContainText(/your map is empty/i);
        await expect(page.locator('.map-outline-node')).toHaveCount(0);
    });

    test('deleting the last node returns the outline to the empty state', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'The only dot');
        await expect(page.locator('.map-outline-empty')).toHaveCount(0);

        await deleteNodeViaKeyboard(page, 'The only dot');

        await expect(page.locator('.map-outline-empty')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.map-outline-node')).toHaveCount(0);
        // Not a stale leftover entry sitting alongside the empty message.
        await expect(page.locator('#map-outline')).not.toContainText('The only dot');
    });
});
