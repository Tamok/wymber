import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(page) {
    await page.goto('/');
    await page.fill('#username', 'TestUser');
    await page.fill('#password', 'SecureTest2025!');
    await page.click('button[type="submit"]');
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 10000 });
    await page.click('#open-map-btn');
}

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
    test('login screen has no serious a11y violations', async ({ page }) => {
        await page.goto('/');
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('main app has no serious a11y violations', async ({ page }) => {
        await login(page);
        // Exclude the third-party MindElixir canvas (we don't control its internals).
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });

    test('add-node modal has no serious a11y violations', async ({ page }) => {
        await login(page);
        await page.click('#add-node-btn');
        await expect(page.locator('#node-modal')).toBeVisible();
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .exclude('#mindmap')
            .analyze();
        expect(reportSerious(results)).toEqual([]);
    });
});
