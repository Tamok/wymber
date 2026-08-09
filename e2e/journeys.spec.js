import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import {
    PASSWORD,
    createVaultAndOpenMap,
    unlock,
    unlockAndOpenMap,
    addNode,
    linkNodes,
    openNodeDetailFromOutline,
} from './helpers.js';

// Real-user journeys, not API pokes: each test follows one person through a coherent stretch
// of the app, the way `docs/user-stories/first-run-and-map-editing.md` describes it. The
// existing specs already cover individual controls in isolation; these tests exist to catch
// what only shows up when several of them are chained together (round trips, real payloads,
// deterministic time).

test.describe('Journey: first run, end to end', () => {
    test('a first-time visitor creates a space, meets the recovery code, and lays out a map', async ({ page }) => {
        // Suppress the first-run walkthrough auto-offer so it doesn't race the rest of the
        // journey; the walkthrough itself is covered in mindmap.spec.js.
        await page.addInitScript(() => {
            try { localStorage.setItem('wymber.tutorialSeen', '1'); } catch (_) { /* ignore */ }
        });
        await page.goto('/');

        // 1. Create a private space. Calm, no account, one password.
        await expect(page.locator('#create-form')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#create-form .auth-sub')).toContainText(/encrypts everything on this device/i);
        await page.fill('#create-password', PASSWORD);
        await page.fill('#create-confirm', PASSWORD);
        await page.click('#create-form button[type="submit"]');

        // 2. The recovery sheet: a real, well-shaped, non-empty code, and honest language
        // about there being no server-side reset.
        await expect(page.locator('#recovery-sheet')).toBeVisible({ timeout: 15000 });
        const code = (await page.locator('#recovery-code-display').textContent()).trim();
        expect(code.length).toBeGreaterThan(0);
        expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/); // XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
        await expect(page.locator('#recovery-sheet')).toContainText(/can't recover it for you/i);

        // Continue is gated on the acknowledgement, not just presented as a formality.
        await expect(page.locator('#recovery-continue')).toBeDisabled();
        await page.check('#ack-saved-recovery');
        await expect(page.locator('#recovery-continue')).toBeEnabled();
        await page.click('#recovery-continue');

        // 3. A soft start: a breath before the map, not dumped straight into a grid.
        await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#soft-start')).toContainText(/you set the pace/i);
        await page.click('#open-map-btn');
        await expect(page.locator('#soft-start')).toBeHidden();

        // 4. Lay out three different kinds of dots.
        await addNode(page, 'event', 'The argument');
        await addNode(page, 'body', 'A tight chest');
        await addNode(page, 'coping', 'Step outside and breathe');

        // 5. Connect two of them from the accessible outline, and see the connection reflected
        // there (the outline is the reliable, DOM-visible source of truth for the canvas).
        await linkNodes(page, 'The argument', 'A tight chest');
        await expect(page.locator('#map-outline')).toContainText('Connected to: A tight chest', { timeout: 5000 });
        await page.click('#select-mode-btn'); // leave Link mode before moving on

        // 6. Analyze reflects the real map: 3 nodes, the connection, the three types used.
        await page.click('#analyze-btn');
        await expect(page.locator('#analyze-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#analyze-content')).toContainText('3');
        await expect(page.locator('#analyze-content')).toContainText('Event');
        await expect(page.locator('#analyze-content')).toContainText('Body');
        await expect(page.locator('#analyze-content')).toContainText('Coping');
        await page.keyboard.press('Escape');
        await expect(page.locator('#analyze-modal')).toBeHidden({ timeout: 3000 });

        // 7. Log out: back to the unlock screen, nothing left showing.
        await page.click('#logout-btn');
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });
});

test.describe('Journey: a returning user', () => {
    test('content and an in-place edit both survive a reload', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await addNode(page, 'event', 'A quiet Sunday', { description: 'Nothing happened, and that was fine.' });

        // Reload before editing: the original write survives on its own.
        await page.waitForTimeout(1000); // let the write settle, as node-persists test does
        await page.reload();
        await unlockAndOpenMap(page);
        await expect(page.locator('#map-outline')).toContainText('A quiet Sunday', { timeout: 10000 });

        // Open the node and change it: this is the part a "does it save at all" test misses.
        await openNodeDetailFromOutline(page, 'A quiet Sunday');
        await page.fill('#detail-title', 'A quiet Sunday, revisited');
        await page.fill('#detail-description', 'Looking back, it mattered more than I thought.');
        await page.fill('#detail-story', 'I sat by the window for a long time.');
        await page.click('#detail-save');
        await expect(page.locator('#node-detail')).not.toHaveClass(/open/, { timeout: 3000 });
        await expect(page.locator('#map-outline')).toContainText('A quiet Sunday, revisited', { timeout: 5000 });

        // Reload again: the EDIT must be what comes back, not the pre-edit original.
        await page.waitForTimeout(1000);
        await page.reload();
        await unlockAndOpenMap(page);
        await expect(page.locator('#map-outline')).toContainText('A quiet Sunday, revisited', { timeout: 10000 });
        await expect(page.locator('#map-outline')).not.toContainText('A quiet Sunday, and that was fine');
        await openNodeDetailFromOutline(page, 'A quiet Sunday, revisited');
        await expect(page.locator('#detail-description')).toHaveValue('Looking back, it mattered more than I thought.');
        await expect(page.locator('#detail-story')).toHaveValue('I sat by the window for a long time.');
    });
});

test.describe('Journey: recovery code round trip', () => {
    test('the recovery code gets you back in without losing data, and rotates the password', async ({ page }) => {
        // createVault() doesn't hand back the code, so this walks the create flow directly to
        // capture it off #recovery-code-display before it's gone.
        await page.addInitScript(() => {
            try { localStorage.setItem('wymber.tutorialSeen', '1'); } catch (_) { /* ignore */ }
        });
        await page.goto('/');
        await expect(page.locator('#create-form')).toBeVisible({ timeout: 15000 });
        await page.fill('#create-password', PASSWORD);
        await page.fill('#create-confirm', PASSWORD);
        await page.click('#create-form button[type="submit"]');
        await expect(page.locator('#recovery-sheet')).toBeVisible({ timeout: 15000 });
        const code = (await page.locator('#recovery-code-display').textContent()).trim();
        expect(code.length).toBeGreaterThan(0);
        await page.check('#ack-saved-recovery');
        await page.click('#recovery-continue');
        await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
        await page.click('#open-map-btn');

        const unique = 'Only findable if recovery preserves data ' + Date.now();
        await addNode(page, 'event', unique);
        await page.waitForTimeout(1000); // let the write settle before reloading

        await page.reload();
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 15000 });
        await page.click('#show-recover');
        await expect(page.locator('#recover-form')).toBeVisible({ timeout: 5000 });

        const NEW_PASSWORD = 'RecoveredVault2025!';
        await page.fill('#recover-code', code);
        await page.fill('#recover-password', NEW_PASSWORD);
        await page.fill('#recover-confirm', NEW_PASSWORD);
        await page.click('#recover-form button[type="submit"]');

        // Back in, on the new password, and the node made it through recovery intact.
        await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
        await page.click('#open-map-btn');
        await expect(page.locator('#map-outline')).toContainText(unique, { timeout: 10000 });

        // The new password now unlocks; the old one is refused.
        await page.click('#logout-btn');
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
        await unlock(page, PASSWORD);
        await expect(page.locator('#error-message')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();

        await unlock(page, NEW_PASSWORD);
        await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
    });
});

test.describe('Journey: export contains what the user actually made', () => {
    test('JSON and text exports carry the real node titles and counts', async ({ page }) => {
        await createVaultAndOpenMap(page);

        const titleA = 'Export me A ' + Date.now();
        const titleB = 'Export me B ' + Date.now();
        await addNode(page, 'event', titleA);
        await addNode(page, 'emotion', titleB);
        await linkNodes(page, titleA, titleB);
        await expect(page.locator('#map-outline')).toContainText(`Connected to: ${titleB}`, { timeout: 5000 });
        await page.click('#select-mode-btn');

        await page.click('#export-btn');
        await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 });

        // JSON export: parses, and both the node titles and the edge survive intact.
        const jsonDownload = page.waitForEvent('download');
        await page.click('#export-json');
        const jsonPath = await (await jsonDownload).path();
        const jsonText = await fs.readFile(jsonPath, 'utf-8');
        const parsed = JSON.parse(jsonText);
        expect(parsed.nodes.length).toBe(2);
        expect(parsed.edges.length).toBe(1);
        const titles = parsed.nodes.map((n) => n.title);
        expect(titles).toContain(titleA);
        expect(titles).toContain(titleB);

        // Text export: same content, human-readable.
        await page.click('#export-btn');
        await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 });
        const textDownload = page.waitForEvent('download');
        await page.click('#export-text');
        const textPath = await (await textDownload).path();
        const textContent = await fs.readFile(textPath, 'utf-8');
        expect(textContent).toContain(titleA);
        expect(textContent).toContain(titleB);
        expect(textContent).toContain('Total nodes: 2');
        expect(textContent).toContain('Total connections: 1');
    });
});

test.describe('Journey: auto-lock', () => {
    test('the auto-lock preference is saved and applied', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#settings-btn');
        await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
        await page.selectOption('#autolock-select', '5');
        await page.click('#save-settings');
        await expect(page.locator('#settings-modal')).toBeHidden({ timeout: 3000 });

        await page.click('#settings-btn');
        await expect(page.locator('#autolock-select')).toHaveValue('5');
        await page.keyboard.press('Escape');
    });

    test('fast-forwarding past the idle timeout locks the app (deterministic, no real waiting)', async ({ page }) => {
        // The clock must be installed before anything on the page starts a real timer, so it
        // goes in before the very first navigation (createVaultAndOpenMap() calls page.goto()
        // internally). page.clock mocks Date/setTimeout/setInterval; the idle timer in app.js
        // is a plain setTimeout, so this makes it fireable on command instead of waiting 5
        // real minutes.
        await page.clock.install();

        await createVaultAndOpenMap(page);
        await page.click('#settings-btn');
        await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
        await page.selectOption('#autolock-select', '5');
        await page.click('#save-settings');
        await expect(page.locator('#settings-modal')).toBeHidden({ timeout: 3000 });

        // Do not touch the page again: mousemove/keydown/click/touchstart/scroll all reset the
        // idle timer (app.js), so any further interaction here would defeat the test.
        await page.clock.fastForward('06:00');

        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });
});
