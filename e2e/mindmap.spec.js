import { test, expect } from '@playwright/test';

// Helper to login before each test
async function login(page) {
    await page.goto('/');
    await page.fill('#username', 'TestUser');
    await page.fill('#password', 'SecureTest2025!');
    await page.click('button[type="submit"]');
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
}

test.describe('Mind Map Operations', () => {
    test('add node via modal', async ({ page }) => {
        await login(page);

        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();

        await page.selectOption('#node-type', 'event');
        await page.fill('#node-title', 'Test Event Node');
        await page.fill('#node-description', 'A test description');
        await page.click('#save-node');

        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
        // Notification should appear
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
    });

    test('Ctrl+N opens add node modal', async ({ page }) => {
        await login(page);

        await page.keyboard.press('Control+n');
        await expect(page.locator('#node-modal')).toBeVisible({ timeout: 3000 });
    });

    test('Escape closes modal', async ({ page }) => {
        await login(page);

        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });
    });

    test('node type description updates on selection', async ({ page }) => {
        await login(page);

        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'emotion');

        const desc = page.locator('#type-description');
        await expect(desc).toContainText('Feelings', { timeout: 3000 });
    });

    test('cannot save node without title', async ({ page }) => {
        await login(page);

        await page.click('#add-node-btn');
        await page.selectOption('#node-type', 'event');
        // Leave title empty
        await page.click('#save-node');

        // Modal should still be visible (not saved)
        await expect(page.locator('#node-modal')).toBeVisible();
        await expect(page.locator('.notification-error')).toBeVisible({ timeout: 3000 });
    });
});
