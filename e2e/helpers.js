import { expect } from '@playwright/test';

export const PASSWORD = 'TestVault2025!';

/** Fill a field and verify it stuck — guards against an occasional fill race under load. */
async function fillVerified(page, selector, value) {
    const loc = page.locator(selector);
    await loc.fill(value);
    if ((await loc.inputValue()) !== value) {
        await loc.fill('');
        await loc.fill(value);
    }
    await expect(loc).toHaveValue(value);
}

/** Fresh context (no vault) → create flow → through the recovery sheet → soft-start visible. */
export async function createVault(page) {
    await page.goto('/');
    await expect(page.locator('#create-form')).toBeVisible({ timeout: 15000 });
    await fillVerified(page, '#create-password', PASSWORD);
    await fillVerified(page, '#create-confirm', PASSWORD);
    await page.click('#create-form button[type="submit"]');
    await expect(page.locator('#recovery-sheet')).toBeVisible({ timeout: 15000 });
    await page.check('#ack-saved-recovery');
    await page.click('#recovery-continue');
    await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
}

export async function createVaultAndOpenMap(page) {
    await createVault(page);
    await page.click('#open-map-btn');
    await expect(page.locator('#soft-start')).toBeHidden();
}

export async function unlock(page, password = PASSWORD) {
    await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 15000 });
    await fillVerified(page, '#unlock-password', password);
    await page.click('#unlock-form button[type="submit"]');
}
