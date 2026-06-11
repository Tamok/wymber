import { test, expect } from '@playwright/test';
import { createVault, createVaultAndOpenMap, unlock, pickType } from './helpers.js';

test.describe('Mind Map Operations', () => {
    test('add node via modal renders it on the map', async ({ page }) => {
        await createVaultAndOpenMap(page);

        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();

        await pickType(page, 'event');
        await page.fill('#node-title', 'A difficult day');
        await page.fill('#node-description', 'A test description');
        await page.click('#save-node');

        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 5000 });
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
        // Renders immediately into the accessible outline twin (the canvas has no DOM text).
        await expect(page.locator('#map-outline')).toContainText('A difficult day', { timeout: 5000 });
    });

    test('N opens the add node modal (Ctrl+N is browser-reserved)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.keyboard.press('n');
        await expect(page.locator('#node-modal')).toBeVisible({ timeout: 3000 });
    });

    test('Escape with nothing open logs out instantly (quick exit)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.keyboard.press('Escape'); // nothing open: this is the quick exit
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#main-app')).toBeHidden();
    });

    test('Escape closes an open modal first, and only logs out when nothing is open', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        await page.keyboard.press('Escape'); // closes the modal, stays unlocked
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });
        await expect(page.locator('#unlock-form')).toBeHidden();
        await page.keyboard.press('Escape'); // now nothing is open: quick exit
        await expect(page.locator('#unlock-form')).toBeVisible({ timeout: 5000 });
    });

    test('Delete key removes the selected node and closes its drawer (#128 #129)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await pickType(page, 'event');
        await page.fill('#node-title', 'To be removed');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('To be removed', { timeout: 5000 });

        // Selecting opens the drawer; Delete (with focus on the page body) removes the node.
        await page.locator('.map-outline-node', { hasText: 'To be removed' }).first().click();
        await expect(page.locator('#node-detail')).toHaveClass(/open/);
        page.once('dialog', (d) => d.accept());
        await page.locator('body').press('Delete');

        await expect(page.locator('#map-outline')).not.toContainText('To be removed', { timeout: 5000 });
        // The drawer must close too: editing a deleted node would go nowhere.
        await expect(page.locator('#node-detail')).not.toHaveClass(/open/, { timeout: 3000 });
    });

    test('Escape closes modal', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });
    });

    test('Escape closes a modal even while a field inside it is focused', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        await page.fill('#node-title', 'half a thought'); // focus is now inside a text input
        await expect(page.locator('#node-title')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#node-modal')).toBeHidden({ timeout: 3000 });
    });

    test('node type description updates on selection', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await pickType(page, 'emotion');
        await expect(page.locator('#type-description')).toContainText('Feelings', { timeout: 3000 });
    });

    test('the colour key is a quick-add: choosing a colour starts a dot of that kind', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.locator('#node-legend summary').click();
        await page.locator('.legend-add', { hasText: 'Coping' }).click();
        await expect(page.locator('#node-modal')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#node-type-chips input[value="coping"]')).toBeChecked();
        // The type is pre-picked, so focus lands on the title, ready to type.
        await expect(page.locator('#node-title')).toBeFocused({ timeout: 3000 });
    });

    test('cannot save node without title', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await pickType(page, 'event');
        await page.click('#save-node');
        await expect(page.locator('#node-modal')).toBeVisible();
        await expect(page.locator('.notification-error')).toBeVisible({ timeout: 3000 });
    });

    test('node persists across a reload + unlock', async ({ page }) => {
        await createVaultAndOpenMap(page);

        const unique = 'Persist ' + Date.now();
        await page.click('#add-node-btn');
        await pickType(page, 'event');
        await page.fill('#node-title', unique);
        await page.click('#save-node');
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });

        // Let the debounced save flush, then reload and unlock from scratch.
        await page.waitForTimeout(1500);
        await page.reload();
        await unlock(page);
        await expect(page.locator('#soft-start')).toBeVisible({ timeout: 10000 });
        await page.click('#open-map-btn');

        await expect(page.locator('#map-outline')).toContainText(unique, { timeout: 10000 });
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
        await pickType(page, 'event');
        await page.fill('#node-title', 'A difficult day');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('A difficult day', { timeout: 5000 });

        // Before selecting: the verbs are dead and nothing is selected.
        await expect(page.locator('#edit-selected-btn')).toBeDisabled();
        await expect(page.locator('#delete-selected-btn')).toBeDisabled();
        await expect(page.locator('#selection-status')).toHaveText('No dot selected');

        // Select the node from the accessible outline twin (the keyboard-first surface).
        await page.locator('.map-outline-node', { hasText: 'A difficult day' }).first().click();

        // After selecting: status reflects it and Edit/Delete come alive.
        await expect(page.locator('#selection-status')).toContainText('A difficult day', { timeout: 3000 });
        await expect(page.locator('#edit-selected-btn')).toBeEnabled();
        await expect(page.locator('#delete-selected-btn')).toBeEnabled();
    });

    test('saving a Trigger offers a gentle pairing nudge that pre-sets a connected anchor', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Add a Trigger.
        await page.click('#add-node-btn');
        await pickType(page, 'trigger');
        await page.fill('#node-title', 'A loud argument');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('A loud argument', { timeout: 5000 });

        // The gentle, dismissible nudge appears with an "Add an anchor" action.
        const nudge = page.locator('.notification-nudge');
        await expect(nudge).toBeVisible({ timeout: 3000 });
        await expect(nudge).toContainText(/anchor/i);
        await nudge.getByRole('button', { name: /add an anchor/i }).click();

        // The add-node modal reopens, pre-set to a coping anchor.
        await expect(page.locator('#node-modal')).toBeVisible();
        await expect(page.locator('#node-type-chips input[value="coping"]')).toBeChecked();

        // Fill + save the anchor; it lands on the map (and is linked back to the trigger).
        await page.fill('#node-title', 'Step outside and breathe');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('Step outside and breathe', { timeout: 5000 });
    });

    test('selecting a node opens the detail drawer; story and keywords persist (#108)', async ({ page }) => {
        await createVaultAndOpenMap(page);

        // Create a node.
        await page.click('#add-node-btn');
        await pickType(page, 'event');
        await page.fill('#node-title', 'A gentle morning');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('A gentle morning', { timeout: 5000 });

        // Selecting it from the outline twin opens the detail drawer, pre-filled.
        await page.locator('.map-outline-node', { hasText: 'A gentle morning' }).first().click();
        const drawer = page.locator('#node-detail');
        await expect(drawer).toHaveClass(/open/);
        await expect(page.locator('#detail-title')).toHaveValue('A gentle morning');

        // Write a story and add a keyword, then save.
        await page.fill('#detail-story', 'I noticed the light and felt okay for a moment.');
        await page.fill('#detail-keyword-input', 'morning');
        await page.locator('#detail-keyword-input').press('Enter');
        await expect(page.locator('#detail-keywords .keyword-tag')).toContainText('morning');
        await page.click('#detail-save');

        // An explicit save closes the drawer.
        await expect(drawer).not.toHaveClass(/open/, { timeout: 3000 });

        // Reopen: the story and keyword came back from the encrypted vault.
        await page.locator('.map-outline-node', { hasText: 'A gentle morning' }).first().click();
        await expect(drawer).toHaveClass(/open/);
        await expect(page.locator('#detail-story')).toHaveValue('I noticed the light and felt okay for a moment.');
        await expect(page.locator('#detail-keywords .keyword-tag')).toContainText('morning');
    });

    test('discovery: shared keywords raise a quiet suggestion you can connect (ADR-0002)', async ({ page }) => {
        await createVaultAndOpenMap(page);

        const giveKeyword = async (title, kw) => {
            await page.locator('.map-outline-node', { hasText: title }).first().click();
            await expect(page.locator('#node-detail')).toHaveClass(/open/);
            await page.fill('#detail-keyword-input', kw);
            await page.locator('#detail-keyword-input').press('Enter');
            await page.click('#detail-save');
            await expect(page.locator('#node-detail')).not.toHaveClass(/open/, { timeout: 3000 });
        };

        // Two unconnected nodes that share a keyword.
        await page.click('#add-node-btn');
        await pickType(page, 'event');
        await page.fill('#node-title', 'A storm');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('A storm', { timeout: 5000 });
        await giveKeyword('A storm', 'rain');

        await page.click('#add-node-btn');
        await pickType(page, 'emotion');
        await page.fill('#node-title', 'Unease');
        await page.click('#save-node');
        await expect(page.locator('#map-outline')).toContainText('Unease', { timeout: 5000 });
        await giveKeyword('Unease', 'rain');

        // The quiet affordance appears with a count; nothing is added until the user opens it.
        const affordance = page.locator('#suggest-btn');
        await expect(affordance).toBeVisible();
        await expect(affordance).toContainText(/possible connection/i);

        // Open it; the suggestion explains itself.
        await affordance.click();
        const modal = page.locator('#suggest-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/rain/);

        // Connect the pair; the only suggestion clears and the affordance goes quiet.
        await page.locator('.suggest-item', { hasText: 'Unease' }).first().locator('.suggest-connect').click();
        await expect(affordance).toBeHidden({ timeout: 5000 });
    });

    test('non-trigger nodes do not raise the pairing nudge', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await pickType(page, 'emotion');
        await page.fill('#node-title', 'A quiet hope');
        await page.click('#save-node');
        await expect(page.locator('.notification-success')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.notification-nudge')).toHaveCount(0);
    });

    test('two nodes link once, refuse a duplicate, and can be unlinked (#117)', async ({ page }) => {
        await createVaultAndOpenMap(page);

        const addNode = async (type, title) => {
            await page.click('#add-node-btn');
            await pickType(page, type);
            await page.fill('#node-title', title);
            await page.click('#save-node');
            await expect(page.locator('#map-outline')).toContainText(title, { timeout: 5000 });
        };
        await addNode('event', 'First thing');
        await addNode('emotion', 'Second thing');

        // Link them from the accessible outline (Link mode: choose two).
        const linkPair = async () => {
            await page.click('#link-mode-btn');
            await page.locator('.map-outline-node', { hasText: 'First thing' }).first().click();
            await page.locator('.map-outline-node', { hasText: 'Second thing' }).first().click();
        };
        await linkPair();
        // The connection shows up in the accessible outline (the reliable source of truth).
        await expect(page.locator('#map-outline')).toContainText('Connected to: Second thing', { timeout: 5000 });

        // Linking them again is refused gently, with no duplicate.
        await linkPair();
        await expect(page.locator('.notification-info')).toContainText(/already connected/i, { timeout: 5000 });

        // Unlink from the node's detail drawer; the connection goes away.
        await page.click('#select-mode-btn');
        await page.locator('.map-outline-node', { hasText: 'First thing' }).first().click();
        await expect(page.locator('#node-detail')).toHaveClass(/open/);
        await page.locator('#detail-connections .detail-unlink').first().click();
        await expect(page.locator('#detail-connections')).toContainText(/no connections/i, { timeout: 5000 });
    });

    test('the "How it works" walkthrough opens, steps, and skips (#118)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#tutorial-btn');
        const modal = page.locator('#tutorial-modal');
        await expect(modal).toBeVisible();
        await expect(page.locator('.tutorial-title')).toContainText(/welcome/i, { timeout: 3000 });
        await page.click('#tutorial-next');
        await expect(page.locator('.tutorial-title')).not.toContainText(/welcome/i, { timeout: 3000 });
        await page.click('#tutorial-skip');
        await expect(modal).toBeHidden({ timeout: 3000 });
    });

    test('the What\'s new changelog opens from the footer (#119)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#whats-new-btn');
        const modal = page.locator('#changelog-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/unlink/i, { timeout: 3000 });
    });

    test('crisis support exposes real call + text links (#107)', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#crisis-btn');
        await expect(page.locator('#crisis-modal')).toBeVisible();
        await expect(page.locator('#crisis-modal a[href="tel:988"]')).toBeVisible();
        await expect(page.locator('#crisis-modal a[href="sms:988"]')).toBeVisible();
        await expect(page.locator('#crisis-modal a[href^="sms:741741"]')).toBeVisible();
        await expect(page.locator('#crisis-modal a[href="tel:911"]')).toBeVisible();
    });
});
