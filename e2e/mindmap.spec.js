import { test, expect } from '@playwright/test';
import { createVault, createVaultAndOpenMap, unlock } from './helpers.js';

test.describe('Mind Map Operations', () => {
    test('add node via modal renders it on the map', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();

        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', 'A difficult day');
        await page.fill('#node-description', 'A test description');
        await page.click('#save-node');

        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
        // Renders immediately from the reloaded map (fix for #102).
        await expect(page.locator('#mindmap')).toContainText('A difficult day', { timeout: 5000 });
    });

    test('Ctrl+N opens add node modal', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.keyboard.press('Control+n');
        await expect(page.locator('#node-modal')).toBeVisible({ timeout: 3000 });
    });

    test('Escape closes modal', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });
    });

    test('node type description updates on selection', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'emotion');
        await expect(page.locator('#type-description')).toContainText('Feelings', { timeout: 3000 });
    });

    test('cannot save node without title', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'event');
        await page.click('#save-node');
        await expect(page.locator('#node-modal')).toBeVisible();
        await expect(page.locator('.notification-error')).toBeVisible({ timeout: 3000 });
    });

    test('node persists across a reload + unlock', async ({ page }) => {
        await createVaultAndOpenMap(page);

        const unique = 'Persist ' + Date.now();
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', unique);
        await page.click('#save-node');
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });

        // Let the debounced save flush, then reload and unlock from scratch.
        await page.waitForTimeout(1500);
        await page.reload();
        await unlock(page);
        await expect(page.locator('#soft-start')).toBeVisible({ timeout: 10000 });
        await page.click('#open-map-btn');

        await expect(page.locator('#mindmap')).toContainText(unique, { timeout: 10000 });
    });

    test('soft-start screen appears before the map', async ({ page }) => {
        await createVault(page); // ends at soft-start
        await expect(page.locator('#soft-start')).toBeVisible();
        await page.click('#open-map-btn');
        await expect(page.locator('#soft-start')).toBeHidden();
    });

    test('selecting a node enables the toolbar Edit/Delete (#105)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', 'A difficult day');
        await page.click('#save-node');
        await expect(page.locator('#mindmap')).toContainText('A difficult day', { timeout: 5000 });

        // Before selecting: the verbs are dead and nothing is selected.
        await expect(page.locator('#edit-selected-btn')).toBeDisabled();
        await expect(page.locator('#delete-selected-btn')).toBeDisabled();
        await expect(page.locator('#selection-status')).toHaveText('No node selected');

        // Click the node on the map (the <me-tpc> topic element, not the inner text).
        await page.locator('me-tpc', { hasText: 'A difficult day' }).first().click();

        // After selecting: status reflects it and Edit/Delete come alive.
        await expect(page.locator('#selection-status')).toContainText('A difficult day', { timeout: 3000 });
        await expect(page.locator('#edit-selected-btn')).toBeEnabled();
        await expect(page.locator('#delete-selected-btn')).toBeEnabled();
    });

    test('saving a Trigger offers a gentle pairing nudge that pre-sets a connected anchor', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Add a Trigger.
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'trigger');
        await page.fill('#node-title', 'A loud argument');
        await page.click('#save-node');
        await expect(page.locator('#mindmap')).toContainText('A loud argument', { timeout: 5000 });

        // The gentle, dismissible nudge appears with an "Add an anchor" action.
        const nudge = page.locator('.notification-nudge');
        await expect(nudge).toBeVisible({ timeout: 3000 });
        await expect(nudge).toContainText(/anchor/i);
        await nudge.getByRole('button', { name: /add an anchor/i }).click();

        // The add-node modal reopens, pre-set to a coping anchor.
        await expect(page.locator('#node-modal')).toBeVisible();
        await expect(page.locator('#node-type')).toHaveValue('coping');

        // Fill + save the anchor; it lands on the map (and is linked back to the trigger).
        await page.fill('#node-title', 'Step outside and breathe');
        await page.click('#save-node');
        await expect(page.locator('#mindmap')).toContainText('Step outside and breathe', { timeout: 5000 });
    });

    test('non-trigger nodes do not raise the pairing nudge', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'emotion');
        await page.fill('#node-title', 'A quiet hope');
        await page.click('#save-node');
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.notification-nudge')).toHaveCount(0);
    });
});
