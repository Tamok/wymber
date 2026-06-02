import { test, expect } from '@playwright/test';
import { createVault, unlock } from './helpers.js';

test.describe('Vault auth (local-first)', () => {
    test('first run shows the create screen', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#create-form')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });

    test('creating a vault shows the recovery sheet, then the app', async ({ page }) => {
        await createVault(page); // walks the recovery sheet, ends at soft-start
        await expect(page.locator('#main-app')).toBeVisible();
        await expect(page.locator('#login-screen')).toBeHidden();
    });

    test('reload prompts unlock; the correct password unlocks', async ({ page }) => {
        await createVault(page);
        await page.reload();
        await unlock(page);
        await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
    });

    test('a wrong password shows an error and stays locked', async ({ page }) => {
        await createVault(page);
        await page.reload();
        await unlock(page, 'definitely-not-it');
        await expect(page.locator('#error-message')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });

    test('logout locks and returns to the unlock screen', async ({ page }) => {
        await createVault(page);
        await page.click('#open-map-btn');
        await page.click('#logout-btn');
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });
});
