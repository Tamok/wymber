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
    // Suppress the first-run walkthrough auto-offer so it never races the suite; tests that
    // exercise it open it explicitly via the "How it works" button.
    await page.addInitScript(() => {
        try { localStorage.setItem('wymber.tutorialSeen', '1'); } catch (_) { /* ignore */ }
    });
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

/** Choose a node type in the add-node modal (the colour-dotted chip radiogroup). */
export async function pickType(page, type) {
    await page.locator(`.type-chip[data-type="${type}"]`).click();
}

export async function unlock(page, password = PASSWORD) {
    await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 15000 });
    await fillVerified(page, '#unlock-password', password);
    await page.click('#unlock-form button[type="submit"]');
}

/** Unlock from a reload, then move past the soft-start card into the map. */
export async function unlockAndOpenMap(page, password = PASSWORD) {
    await unlock(page, password);
    await expect(page.locator('#soft-start')).toBeVisible({ timeout: 15000 });
    await page.click('#open-map-btn');
    await expect(page.locator('#soft-start')).toBeHidden();
}

/**
 * Add a node through the modal and wait for it to land in the accessible outline twin.
 * opts: { description }
 */
export async function addNode(page, type, title, opts = {}) {
    await page.click('#add-node-btn');
    await expect(page.locator('#node-modal')).toBeVisible({ timeout: 5000 });
    await pickType(page, type);
    await page.fill('#node-title', title);
    if (opts.description) await page.fill('#node-description', opts.description);
    await page.click('#save-node');
    await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#map-outline')).toContainText(title, { timeout: 5000 });
}

/** Link two already-added nodes via Link mode, from the accessible outline (matches how a
 * keyboard-first / non-visual user actually connects two dots). Leaves Link mode active. */
export async function linkNodes(page, titleA, titleB) {
    await page.click('#link-mode-btn');
    await page.locator('.map-outline-node', { hasText: titleA }).first().click();
    await page.locator('.map-outline-node', { hasText: titleB }).first().click();
}

/** Open a node's detail drawer from the outline twin. */
export async function openNodeDetailFromOutline(page, title) {
    await page.locator('.map-outline-node', { hasText: title }).first().click();
    await expect(page.locator('#node-detail')).toHaveClass(/open/);
}

/** Unlink a node's first connection via its detail drawer (matches the flow in
 * mindmap.spec.js's link/unlink test). Leaves Select mode active. */
export async function unlinkFirstConnection(page, title) {
    await page.click('#select-mode-btn');
    await openNodeDetailFromOutline(page, title);
    await page.locator('#detail-connections .detail-unlink').first().click();
}

/** Select a node from the outline (opens its drawer), then delete it with the keyboard
 * Delete key, accepting the confirmation dialog. Matches mindmap.spec.js's delete flow. */
export async function deleteNodeViaKeyboard(page, title) {
    await page.locator('.map-outline-node', { hasText: title }).first().click();
    await expect(page.locator('#node-detail')).toHaveClass(/open/);
    page.once('dialog', (d) => d.accept());
    await page.locator('body').press('Delete');
}
