import { expect } from '@playwright/test';

export const PASSWORD = 'TestVault2025!';

/**
 * Fill a field and verify it stuck, guarding against an occasional fill race under load.
 *
 * Always clears before writing. A run caught #create-password holding the password twice over
 * ("TestVault2025!TestVault2025!"), which failed vault creation and took the whole test with it.
 * A fill that appends instead of replacing is the only way to land in that state, so clearing
 * first makes each attempt idempotent no matter what caused the append, and re-reading the value
 * (rather than trusting one write) is what turns a rare, confusing failure into a retry.
 */
async function fillVerified(page, selector, value) {
    const loc = page.locator(selector);
    for (let attempt = 0; attempt < 3; attempt++) {
        await loc.fill('');
        await loc.fill(value);
        if ((await loc.inputValue()) === value) break;
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

/**
 * Open a node's detail drawer from the outline twin.
 *
 * Waits for the drawer to be populated, not merely open. The `open` class lands before the
 * fields are filled in, so a test that typed straight away had its input overwritten by the
 * populate and then saved the ORIGINAL value back. That surfaced as an edit vanishing across a
 * reload, which reads like a persistence bug and is really just a race in the test.
 */
export async function openNodeDetailFromOutline(page, title) {
    await page.locator('.map-outline-node', { hasText: title }).first().click();
    await expect(page.locator('#node-detail')).toHaveClass(/open/);
    await expect(page.locator('#detail-title')).toHaveValue(title, { timeout: 5000 });
    // app.js focuses #detail-title on a 60ms timeout, so the values being present is not yet
    // proof the drawer has finished setting itself up. Waiting for that focus to land is the
    // signal that it has, and it stops a keystroke from being swallowed by the tail of setup.
    await expect(page.locator('#detail-title')).toBeFocused({ timeout: 5000 });
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
