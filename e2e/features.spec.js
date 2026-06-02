import { test, expect } from '@playwright/test';
import { createVaultAndOpenMap } from './helpers.js';

test.describe('Analyze Feature', () => {
    test('analyze button opens analysis modal', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#analyze-btn');
        await expect(page.locator('#analyze-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#analyze-content')).toContainText('Overview');
    });

    test('analysis shows node counts', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Add a node first
        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', 'Analyze Test Node');
        await page.click('#save-node');
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });

        // Wait a moment for save
        await page.waitForTimeout(1000);

        await page.click('#analyze-btn');
        await expect(page.locator('#analyze-content')).toContainText('Event', { timeout: 5000 });
    });
});

test.describe('Export Feature', () => {
    test('export button opens export modal', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#export-btn');
        await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#export-json')).toBeVisible();
        await expect(page.locator('#export-text')).toBeVisible();
    });
});

test.describe('Settings Feature', () => {
    test('settings button opens settings modal', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#settings-btn');
        await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#theme-select')).toBeVisible();
        await expect(page.locator('#font-size')).toBeVisible();
    });

    test('settings show data-location transparency and a delete option', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#settings-btn');
        await expect(page.locator('#settings-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#settings-content')).toContainText('locally on this device');
        // Present and reachable (we don't click it — it's destructive).
        await expect(page.locator('#delete-account-btn')).toBeVisible();
    });

    test('changing theme applies to page', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#settings-btn');
        await page.selectOption('#theme-select', 'dark');
        await page.click('#save-settings');

        const theme = await page.locator('html').getAttribute('data-theme');
        expect(theme).toBe('dark');
    });

    test('settings persist after save', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Set theme to soft
        await page.click('#settings-btn');
        await page.selectOption('#theme-select', 'soft');
        await page.selectOption('#font-size', 'large');
        await page.click('#save-settings');
        await expect(page.locator('#settings-modal')).toBeHidden({ timeout: 3000 });

        // Reopen settings and verify
        await page.click('#settings-btn');
        await expect(page.locator('#theme-select')).toHaveValue('soft');
        await expect(page.locator('#font-size')).toHaveValue('large');
    });
});
