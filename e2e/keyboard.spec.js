import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createVaultAndOpenMap, addNode } from './helpers.js';

// ADR-0004 pillar 4: the whole app is operable with no pointer. These tests drive the app with
// real key presses (Tab, Enter, Space, arrow keys, Escape) rather than .click() wherever the
// point is keyboard reachability, not just end-state assertions.

/** Press Tab until document.activeElement.id matches, bounded so a broken tab order fails
 * fast instead of hanging. Doesn't assume a particular starting focus (the app's own state
 * after opening the map is inconsistent; see the fixme tests below), so it starts wherever
 * the page already is. */
async function tabToId(page, id, maxSteps = 30) {
    for (let i = 0; i < maxSteps; i++) {
        await page.keyboard.press('Tab');
        const activeId = await page.evaluate(() => document.activeElement?.id);
        if (activeId === id) return;
    }
    throw new Error(`Could not reach #${id} by Tab within ${maxSteps} presses`);
}

/** Same idea, for the outline's unlabelled node buttons: matches on class + visible text. */
async function tabToOutlineNode(page, text, maxSteps = 40) {
    for (let i = 0; i < maxSteps; i++) {
        await page.keyboard.press('Tab');
        const matched = await page.evaluate((t) => {
            const el = document.activeElement;
            return !!el && el.classList?.contains('map-outline-node') && el.textContent.includes(t);
        }, text);
        if (matched) return;
    }
    throw new Error(`Could not reach a .map-outline-node containing "${text}" by Tab within ${maxSteps} presses`);
}

/** Give a node a keyword via its detail drawer (mouse setup, matches mindmap.spec.js's
 * discovery test), to raise the quiet "possible connections" affordance. */
async function giveKeyword(page, title, keyword) {
    await page.locator('.map-outline-node', { hasText: title }).first().click();
    await expect(page.locator('#node-detail')).toHaveClass(/open/);
    await page.fill('#detail-keyword-input', keyword);
    await page.locator('#detail-keyword-input').press('Enter');
    await page.click('#detail-save');
    await expect(page.locator('#node-detail')).not.toHaveClass(/open/, { timeout: 3000 });
}

test.describe('Keyboard-only operation (ADR-0004)', () => {
    test('adding a node end to end with the keyboard alone', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Reach "Add a dot" by Tab (the N shortcut is covered in mindmap.spec.js; this proves
        // the button itself is reachable and operable without a pointer).
        await tabToId(page, 'add-node-btn');
        await page.keyboard.press('Enter');
        await expect(page.locator('#node-modal')).toBeVisible({ timeout: 5000 });

        // The type radiogroup is native <input type="radio">, so arrow keys move AND select
        // within it (event -> emotion -> body, per config.js's NODE_TYPES order).
        await expect(page.locator('#node-type-chips input[name="node-type"]').first()).toBeFocused({ timeout: 3000 });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#node-type-chips input[value="body"]')).toBeChecked();

        // Tab to the title and type it, then save, all by keyboard.
        await tabToId(page, 'node-title');
        await page.keyboard.type('A keyboard-only entry');
        await tabToId(page, 'save-node');
        await page.keyboard.press('Enter');

        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('#map-outline')).toContainText('A keyboard-only entry', { timeout: 5000 });
    });

    test('selecting and linking two nodes from the outline with the keyboard alone', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'Keyboard link A');
        await addNode(page, 'emotion', 'Keyboard link B');
        await page.click('#link-mode-btn'); // entering Link mode is covered elsewhere; the point here is the two selections

        await tabToOutlineNode(page, 'Keyboard link A');
        await page.keyboard.press('Enter'); // first pick, via Enter
        await tabToOutlineNode(page, 'Keyboard link B');
        await page.keyboard.press(' '); // second pick, via Space, proving both activation keys work

        await expect(page.locator('#map-outline')).toContainText('Connected to: Keyboard link B', { timeout: 5000 });
        await page.click('#select-mode-btn');
    });

    test('focus stays visible while tabbing through the main app', async ({ page }) => {
        await createVaultAndOpenMap(page);
        // Opening the map currently leaves focus in an inconsistent spot rather than moving it
        // into the map region (see the dedicated fixme test below), so one settling Tab press
        // gets us into ordinary page content before walking real tab stops.
        await page.keyboard.press('Tab');
        for (let i = 0; i < 15; i++) {
            await page.keyboard.press('Tab');
            const info = await page.evaluate(() => ({
                isBody: document.activeElement === document.body,
                focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false,
            }));
            expect(info.isBody, `tab stop ${i + 1} should not land on <body>`).toBe(false);
            expect(info.focusVisible, `tab stop ${i + 1} should carry a visible focus ring`).toBe(true);
        }
    });

    test.fixme(
        'opening the map moves keyboard focus into the map region',
        async ({ page }) => {
            // ADR-0004 pillar 2: "Opening a surface moves focus into it." app.js's initMindMap()
            // calls `container.focus()` where `container = document.getElementById('mindmap')`
            // (the bare Cytoscape canvas host div, which has no tabindex and so is not
            // focusable, making the call a silent no-op) instead of `#mindmap-container` (the
            // wrapper with role="application" tabindex="0" that ADR-0004 describes as the
            // focusable map region). Expected: focus lands on #mindmap-container after the map
            // opens. Actual: focus is left on whatever happened to be focused before (observed
            // nondeterministically as the now-hidden #open-map-btn, or document.body).
            await createVaultAndOpenMap(page);
            const activeId = await page.evaluate(() => document.activeElement?.id);
            expect(activeId).toBe('mindmap-container');
        }
    );

    test.fixme(
        'closing the node modal with Escape returns focus to the button that opened it',
        async ({ page }) => {
            // ADR-0004 pillar 2 promises Escape "returns focus to a sensible anchor." Nothing in
            // app.js's closeAllOverlays() moves focus anywhere; it only sets `display: none` on
            // every .modal. Since the node-modal's first field is genuinely focused on open
            // (showNodeModal()'s setTimeout), closing it is a real test of restoration, and it
            // fails: observed behaviour is inconsistent across runs (the still-focused, now
            // hidden radio input, or a silent drop to document.body), never the opener button.
            // Expected: focus returns to #add-node-btn. Actual: focus is left wherever it was
            // inside the now-hidden modal, or lost to <body>.
            await createVaultAndOpenMap(page);
            await page.click('#add-node-btn');
            await expect(page.locator('#node-modal')).toBeVisible();
            await expect(page.locator('#node-type-chips input[name="node-type"]').first())
                .toBeFocused({ timeout: 3000 });
            await page.keyboard.press('Escape');
            await expect(page.locator('#node-modal')).toBeHidden();
            await expect(page.locator('#add-node-btn')).toBeFocused();
        }
    );

    test.fixme(
        'closing the node detail drawer with Escape returns focus to the outline button that opened it',
        async ({ page }) => {
            // Same ADR-0004 promise, for the detail drawer. openNodeDetail() focuses
            // #detail-title on open, but closeNodeDetail() (called from the drawer's own Escape
            // handler) only toggles `.open`/`inert`; nothing restores focus. Marking the drawer
            // `inert` while it holds focus forces the browser to drop focus to <body>.
            // Expected: focus returns to the .map-outline-node button that opened the drawer.
            // Actual: focus lands on <body>.
            await createVaultAndOpenMap(page);
            await addNode(page, 'event', 'Focus restoration check');
            const outlineButton = page.locator('.map-outline-node', { hasText: 'Focus restoration check' }).first();
            await outlineButton.click();
            await expect(page.locator('#node-detail')).toHaveClass(/open/);
            await expect(page.locator('#detail-title')).toBeFocused({ timeout: 3000 });
            await page.keyboard.press('Escape');
            await expect(page.locator('#node-detail')).not.toHaveClass(/open/);
            await expect(outlineButton).toBeFocused();
        }
    );

    test('the outline\'s ARIA contract: aria-pressed tracks selection, aria-label tracks mode', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'Aria check node');
        const btn = page.locator('.map-outline-node', { hasText: 'Aria check node' }).first();

        await expect(btn).toHaveAttribute('aria-pressed', 'false');
        await expect(btn).toHaveAttribute('aria-label', /\. Select\.$/);

        await btn.click();
        await expect(btn).toHaveAttribute('aria-pressed', 'true');

        await page.click('#link-mode-btn');
        await expect(btn).toHaveAttribute('aria-label', /\. Choose to connect\.$/);

        await page.click('#select-mode-btn');
        await expect(btn).toHaveAttribute('aria-label', /\. Select\.$/);
    });

    test.describe('Escape closes every modal (and only quick-exits when nothing is open)', () => {
        const cases = [
            { id: 'node-modal', open: (page) => page.click('#add-node-btn') },
            { id: 'settings-modal', open: (page) => page.click('#settings-btn') },
            { id: 'analyze-modal', open: (page) => page.click('#analyze-btn') },
            { id: 'export-modal', open: (page) => page.click('#export-btn') },
            { id: 'crisis-modal', open: (page) => page.click('#crisis-btn') },
            { id: 'grounding-modal', open: (page) => page.click('#grounding-btn') },
            { id: 'tutorial-modal', open: (page) => page.click('#tutorial-btn') },
            { id: 'changelog-modal', open: (page) => page.click('#whats-new-btn') },
            {
                id: 'suggest-modal',
                // Heavier setup (two nodes sharing a keyword) but reachable, so it's included
                // rather than skipped: mirrors the discovery flow in mindmap.spec.js.
                open: async (page) => {
                    await addNode(page, 'event', 'A storm outside');
                    await giveKeyword(page, 'A storm outside', 'weather');
                    await addNode(page, 'emotion', 'Restless energy');
                    await giveKeyword(page, 'Restless energy', 'weather');
                    await expect(page.locator('#suggest-btn')).toBeVisible({ timeout: 5000 });
                    await page.click('#suggest-btn');
                },
            },
        ];

        for (const { id, open } of cases) {
            test(`Escape closes #${id}`, async ({ page }) => {
                await createVaultAndOpenMap(page);
                await open(page);
                await expect(page.locator(`#${id}`)).toBeVisible({ timeout: 5000 });
                await page.keyboard.press('Escape');
                await expect(page.locator(`#${id}`)).toBeHidden({ timeout: 3000 });
            });
        }
    });

    test('Escape with nothing open is still the quick-exit logout, not a no-op (sanity check for the table above)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
    });
});

test.describe('Accessibility (axe-core): states not covered by a11y.spec.js', () => {
    // a11y.spec.js already covers: create screen, recovery sheet, main app, add-node modal,
    // soft-start, settings modal, export modal. These are the remaining surfaces.
    async function checkNoSeriousViolations(page) {
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        const violations = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        for (const v of violations) {
            for (const n of v.nodes) {
                console.log(`  ${v.id} @ ${n.target.join(' ')} :: ${(n.any[0]?.message || '').slice(0, 140)}`);
            }
        }
        expect(violations.map((v) => v.id)).toEqual([]);
    }

    test.fixme(
        'node detail drawer has no serious a11y violations',
        async ({ page }) => {
            // Confirmed axe finding, not flaky: the "success" toast left on screen right after
            // addNode() (.notification-success, shown while the drawer is open) fails
            // color-contrast. Foreground #317f35 on background #e8f5e9 measures 4.42:1; WCAG
            // 2.1 AA needs 4.5:1 for this text size/weight. Reproduces every run.
            await createVaultAndOpenMap(page);
            await addNode(page, 'event', 'Drawer a11y check');
            await page.locator('.map-outline-node', { hasText: 'Drawer a11y check' }).first().click();
            await expect(page.locator('#node-detail')).toHaveClass(/open/);
            await checkNoSeriousViolations(page);
        }
    );

    test('analyze modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'Analyze a11y check');
        await page.click('#analyze-btn');
        await expect(page.locator('#analyze-modal')).toBeVisible();
        await checkNoSeriousViolations(page);
    });

    test('grounding modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#grounding-btn');
        await expect(page.locator('#grounding-modal')).toBeVisible();
        await checkNoSeriousViolations(page);
    });

    test.fixme(
        'crisis modal has no serious a11y violations',
        async ({ page }) => {
            // Confirmed axe finding, not flaky: .crisis-link ("Find a helpline in your
            // country") fails color-contrast. Foreground #1976d2 on background #fafafa
            // measures 4.4:1; WCAG 2.1 AA needs 4.5:1. Reproduces every run.
            await createVaultAndOpenMap(page);
            await page.click('#crisis-btn');
            await expect(page.locator('#crisis-modal')).toBeVisible();
            await checkNoSeriousViolations(page);
        }
    );

    test('tutorial modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#tutorial-btn');
        await expect(page.locator('#tutorial-modal')).toBeVisible();
        await checkNoSeriousViolations(page);
    });

    test('suggest modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A storm outside');
        await giveKeyword(page, 'A storm outside', 'weather');
        await addNode(page, 'emotion', 'Restless energy');
        await giveKeyword(page, 'Restless energy', 'weather');
        await expect(page.locator('#suggest-btn')).toBeVisible({ timeout: 5000 });
        await page.click('#suggest-btn');
        await expect(page.locator('#suggest-modal')).toBeVisible();
        await checkNoSeriousViolations(page);
    });
});
