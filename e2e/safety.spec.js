import { test, expect } from '@playwright/test';

// Safety affordances must be reachable at all times — including before login.
test.describe('Safety affordances', () => {
    test('non-therapy disclaimer is always visible', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#safety-bar')).toContainText('not therapy');
    });

    test('grounding tool is reachable without logging in', async ({ page }) => {
        await page.goto('/');
        await page.click('#grounding-btn');
        await expect(page.locator('#grounding-modal')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#grounding-modal')).toContainText('5');
        await page.click('#close-grounding-btn');
        await expect(page.locator('#grounding-modal')).toBeHidden({ timeout: 3000 });
    });

    test('crisis resources are reachable without logging in', async ({ page }) => {
        await page.goto('/');
        await page.click('#crisis-btn');
        await expect(page.locator('#crisis-modal')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#crisis-modal')).toContainText('988');
        await expect(page.locator('#crisis-modal')).toContainText('741741');
        await page.keyboard.press('Escape');
        await expect(page.locator('#crisis-modal')).toBeHidden({ timeout: 3000 });
    });
});
