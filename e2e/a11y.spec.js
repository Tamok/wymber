import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createVault, createVaultAndOpenMap } from './helpers.js';

function reportSerious(results) {
    const violations = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    if (violations.length) {
        for (const v of violations) {
            for (const n of v.nodes) {
                console.log(`  ${v.id} @ ${n.target.join(' ')} :: ${(n.any[0]?.message || '').slice(0, 140)}`);
            }
        }
    }
    return violations.map((v) => v.id);
}

// Accessibility is architecture here: fail on serious/critical WCAG 2 A/AA issues.
test.describe('Accessibility (axe-core)', () => {
    test('create screen has no serious a11y violations', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#create-form')).toBeVisible({ timeout: 10000 });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('recovery sheet has no serious a11y violations', async ({ page }) => {
        await page.goto('/');
        await page.fill('#create-password', 'TestVault2025!');
        await page.fill('#create-confirm', 'TestVault2025!');
        await page.click('#create-form button[type="submit"]');
        await expect(page.locator('#recovery-sheet')).toBeVisible({ timeout: 10000 });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('main app has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        // Exclude the Cytoscape canvas (a <canvas>; its accessible twin is the #map-outline list).
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('add-node modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('soft-start screen has no serious a11y violations', async ({ page }) => {
        await createVault(page); // ends at soft-start
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('settings modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#settings-btn');
        await expect(page.locator('#settings-modal')).toBeVisible();
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('export modal has no serious a11y violations', async ({ page }) => {
        await createVaultAndOpenMap(page);
        await page.click('#export-btn');
        await expect(page.locator('#export-modal')).toBeVisible();
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });
});
