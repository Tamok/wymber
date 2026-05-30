import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
    test('shows login screen on first visit', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#login-screen')).toBeVisible();
        await expect(page.locator('#main-app')).toBeHidden();
    });

    test('login with test credentials shows main app', async ({ page }) => {
        await page.goto('/');
        await page.fill('#username', 'TestUser');
        await page.fill('#password', 'SecureTest2025!');
        await page.click('button[type="submit"]');

        await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#login-screen')).toBeHidden();
    });

    test('invalid credentials show error', async ({ page }) => {
        await page.goto('/');
        await page.fill('#username', 'baduser');
        await page.fill('#password', 'badpass');
        await page.click('button[type="submit"]');

        await expect(page.locator('#error-message')).toBeVisible({ timeout: 5000 });
    });

    test('logout returns to login screen', async ({ page }) => {
        await page.goto('/');
        await page.fill('#username', 'TestUser');
        await page.fill('#password', 'SecureTest2025!');
        await page.click('button[type="submit"]');
        await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });

        await page.click('#logout-btn');
        await expect(page.locator('#login-screen')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });
});
