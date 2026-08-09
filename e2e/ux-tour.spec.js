import { test, expect } from '@playwright/test';
import {
    PASSWORD,
    createVaultAndOpenMap,
    addNode,
    linkNodes,
    pickType,
    openNodeDetailFromOutline,
} from './helpers.js';

// The scripted visual tour behind docs/ux-emulation-checklist.md. Every other spec in this
// folder asserts *behaviour*; this one exists to put the actual pixels of each key screen in
// front of a human (or a future agent) so a UX/visual regression a green assertion would miss
// (broken layout, a palette gone wrong, a mobile viewport that clips something) gets caught.
//
// Each screen is a real test, not a screenshotter: it asserts the screen actually rendered
// before capturing it, so a screen that fails to appear fails the tour instead of silently
// producing a blank PNG. Screenshots land under test-results/ux-tour/ (already gitignored) and
// are also attached to the Playwright HTML report, which CI already uploads as an artifact on
// every run (.github/workflows/ci.yml), so the tour images ride along for free.

/** Freeze CSS animations/transitions so a shot never lands mid-motion (the app's own 0.3s ease
 * transitions, not layout: Cytoscape's own layout runs with animate:false). Injected via
 * addStyleTag per the plan for this spec, rather than sleeping past them. */
async function disableAnimations(page) {
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
                scroll-behavior: auto !important;
            }
        `,
    });
}

/** Screenshot the current viewport, write it under test-results/ux-tour/<viewport>/, and attach
 * it to the HTML report under a clear, ordered name (e.g. "05-map-linked-desktop"). The
 * `animations: 'disabled'` option is Playwright's own belt-and-suspenders on top of the CSS
 * freeze above (it also finishes/holds any animation driven outside CSS transitions). */
async function shoot(page, testInfo, viewportName, index, slug) {
    const name = `${String(index).padStart(2, '0')}-${slug}-${viewportName}`;
    const filePath = `test-results/ux-tour/${viewportName}/${name}.png`;
    await page.screenshot({ path: filePath, animations: 'disabled' });
    await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
}

/** Manually walks the create -> recovery -> soft-start steps (rather than the createVault()
 * helper, which intentionally jumps straight to soft-start) so each intermediate screen can be
 * asserted and shot along the way. Mirrors journeys.spec.js's first-time-visitor test, which
 * does the same thing for the same reason. */
async function createVaultStepByStep(page, testInfo, viewportName, n) {
    // Suppress the first-run walkthrough auto-offer so it doesn't race the tour; the tutorial
    // screen is captured later via an explicit "How it works" click.
    await page.addInitScript(() => {
        try { localStorage.setItem('wymber.tutorialSeen', '1'); } catch (_) { /* ignore */ }
    });
    await page.goto('/');
    await disableAnimations(page);

    await expect(page.locator('#create-form')).toBeVisible({ timeout: 15000 });
    await shoot(page, testInfo, viewportName, n.next(), 'create');

    await page.fill('#create-password', PASSWORD);
    await page.fill('#create-confirm', PASSWORD);
    await page.click('#create-form button[type="submit"]');

    await expect(page.locator('#recovery-sheet')).toBeVisible({ timeout: 15000 });
    await shoot(page, testInfo, viewportName, n.next(), 'recovery-sheet');

    await page.check('#ack-saved-recovery');
    await page.click('#recovery-continue');

    await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
    await shoot(page, testInfo, viewportName, n.next(), 'soft-start');

    await page.click('#open-map-btn');
    await expect(page.locator('#soft-start')).toBeHidden();
}

/** A tiny counter so screenshot filenames stay in narrative order without hand-numbering every
 * call site (and without renumbering the rest when a step is inserted). */
function counter(start = 1) {
    let i = start;
    return { next: () => i++ };
}

const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
    test.describe(`UX tour: key screens (${vp.name}, ${vp.width}x${vp.height})`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test(`walks and shoots every key screen (${vp.name})`, async ({ page }, testInfo) => {
            const n = counter(1);

            // 1-3. Create a space, meet the recovery code, the soft-start breath.
            await createVaultStepByStep(page, testInfo, vp.name, n);

            // 4. An empty map: the honest empty state, not a stale outline.
            await expect(page.locator('.map-outline-empty')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'empty-map');

            // 5. Lay out and connect several different kinds of dots (no Trigger here: its
            // pairing nudge is its own affordance, exercised in mindmap.spec.js, and would add
            // a transient notification to this shot).
            await addNode(page, 'event', 'The argument');
            await addNode(page, 'emotion', 'A wave of anger');
            await addNode(page, 'body', 'A tight chest');
            await addNode(page, 'coping', 'Step outside and breathe');
            await linkNodes(page, 'The argument', 'A wave of anger');
            await expect(page.locator('#map-outline')).toContainText('Connected to: A wave of anger', { timeout: 5000 });
            await linkNodes(page, 'A tight chest', 'Step outside and breathe');
            await expect(page.locator('#map-outline')).toContainText('Connected to: Step outside and breathe', { timeout: 5000 });
            await page.click('#select-mode-btn'); // leave Link mode

            // Let the last "added" toast clear so it doesn't sit over the shot; best-effort,
            // not load-bearing for the test's pass/fail.
            await page.locator('.notification-success').first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
            await shoot(page, testInfo, vp.name, n.next(), 'map-linked');

            // 6. The add-node modal, with a real entry mid-fill (not just the blank shell).
            await page.click('#add-node-btn');
            await expect(page.locator('#node-modal')).toBeVisible({ timeout: 5000 });
            await pickType(page, 'person');
            await page.fill('#node-title', 'A quiet neighbor');
            await shoot(page, testInfo, vp.name, n.next(), 'add-node-modal');
            await page.keyboard.press('Escape'); // close without saving; keeps node count clean for Analyze/Export below
            await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });

            // 7. The node detail drawer, opened on a real node.
            await openNodeDetailFromOutline(page, 'The argument');
            await shoot(page, testInfo, vp.name, n.next(), 'node-detail');
            await page.click('#detail-close');
            await expect(page.locator('#node-detail')).not.toHaveClass(/open/, { timeout: 3000 });

            // 8. Settings.
            await page.click('#settings-btn');
            await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'settings');
            await page.keyboard.press('Escape');
            await expect(page.locator('#settings-modal')).toBeHidden({ timeout: 3000 });

            // 9. Export.
            await page.click('#export-btn');
            await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'export');
            await page.keyboard.press('Escape');
            await expect(page.locator('#export-modal')).toBeHidden({ timeout: 3000 });

            // 10. Analyze, reflecting the real map just built.
            await page.click('#analyze-btn');
            await expect(page.locator('#analyze-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'analyze');
            await page.keyboard.press('Escape');
            await expect(page.locator('#analyze-modal')).toBeHidden({ timeout: 3000 });

            // 11. Crisis support, reachable at any time.
            await page.click('#crisis-btn');
            await expect(page.locator('#crisis-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'crisis');
            await page.keyboard.press('Escape');
            await expect(page.locator('#crisis-modal')).toBeHidden({ timeout: 3000 });

            // 12. Grounding.
            await page.click('#grounding-btn');
            await expect(page.locator('#grounding-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'grounding');
            await page.keyboard.press('Escape');
            await expect(page.locator('#grounding-modal')).toBeHidden({ timeout: 3000 });

            // 13. The "How it works" walkthrough, reopened explicitly (its auto-offer was
            // suppressed above so it never raced the rest of the tour).
            await page.click('#tutorial-btn');
            await expect(page.locator('#tutorial-modal')).toBeVisible({ timeout: 5000 });
            await expect(page.locator('.tutorial-title')).toContainText(/welcome/i, { timeout: 3000 });
            await shoot(page, testInfo, vp.name, n.next(), 'tutorial');
            await page.keyboard.press('Escape');
            await expect(page.locator('#tutorial-modal')).toBeHidden({ timeout: 3000 });

            // 14. What's new.
            // Real, reproducible mobile UX bug the tour caught (not a script issue, not fixed
            // here, out of scope for this task, and the app must not change): styles.css's own
            // comment above the fixed `.safety-bar` admits "which can wrap to two rows on
            // narrow screens", and compensates with a flat `body { padding-bottom: 4rem }`. At
            // 390px that reserve isn't enough: the wrapped bar's actual height exceeds it, so
            // the bar (observed: its `.safety-disclaimer` text, then `#grounding-btn`)
            // physically sits on top of the footer and intercepts the tap on `#whats-new-btn`.
            // Confirmed at the browser level, not just Playwright's pre-click actionability
            // check: even `page.click(..., { force: true })` still resolved to the overlapping
            // element (the changelog modal never opened), because force only skips Playwright's
            // guard, not real hit-testing at that coordinate, i.e. a real thumb tap here is
            // caught by the safety bar too. A direct DOM `.click()` (bypassing hit-testing
            // entirely, unlike a simulated pointer event) is used below only so the tour can
            // still capture what the What's-new screen looks like; it does not represent how a
            // real mobile user can reach it today. See docs/ux-emulation-checklist.md.
            await page.evaluate(() => document.getElementById('whats-new-btn').click());
            await expect(page.locator('#changelog-modal')).toBeVisible({ timeout: 5000 });
            await shoot(page, testInfo, vp.name, n.next(), 'whats-new');
            await page.keyboard.press('Escape');
            await expect(page.locator('#changelog-modal')).toBeHidden({ timeout: 3000 });
        });
    });
}

// Theme is a first-class trauma-informed design constraint (light / dark / soft, where "soft"
// is a deliberately lower-contrast, low-stimulation palette, per ADR-0004). A palette regression is
// invisible to a text assertion, so the map screen gets shot under all three. Desktop only: the
// per-viewport tour above already proves the map layout holds at both sizes; this sweep is about
// colour, not layout.
test.describe('UX tour: theme sweep (map screen)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the map renders correctly under light, dark, and soft themes', async ({ page }, testInfo) => {
        const n = counter(1);
        await createVaultAndOpenMap(page);
        await disableAnimations(page);

        await addNode(page, 'event', 'A missed train');
        await addNode(page, 'emotion', 'Low-grade dread');
        await addNode(page, 'support', 'A friend who checked in');
        await linkNodes(page, 'A missed train', 'Low-grade dread');
        await expect(page.locator('#map-outline')).toContainText('Connected to: Low-grade dread', { timeout: 5000 });
        await page.click('#select-mode-btn');
        await page.locator('.notification-success').first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});

        for (const theme of ['light', 'dark', 'soft']) {
            await page.click('#settings-btn');
            await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
            await page.selectOption('#theme-select', theme);
            await page.click('#save-settings');
            await expect(page.locator('#settings-modal')).toBeHidden({ timeout: 3000 });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await shoot(page, testInfo, 'desktop', n.next(), `map-theme-${theme}`);
        }
    });
});
