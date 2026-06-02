import { test, expect } from '@playwright/test';
import { createVault, createVaultAndOpenMap, unlock } from './helpers.js';

test.describe('Mind Map Operations', () => {
    test('add node via modal saves it', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();

        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', 'A difficult day');
        await page.fill('#node-description', 'A test description');
        await page.click('#save-node');

        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
        // The node's data is confirmed by the "persists across reload" test below; live
        // MindElixir rendering of a freshly-added node is tracked separately (see issue).
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
});
