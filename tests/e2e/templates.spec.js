/**
 * E2E tests for the public /templates page (LIN-1889).
 *
 * The page requires no authentication and publishes the 17 non-meta prompt
 * templates for anyone to view and copy. Modeled on tests/e2e/kpis.spec.js
 * and tests/e2e/legal.spec.js.
 */
import { test, expect } from '@playwright/test';
import { SELECTORS } from '../helpers.js';

test.describe('Templates page', () => {
  test('renders without authentication', async ({ page }) => {
    const response = await page.goto('/templates');
    expect(response.status()).toBe(200);
    // LIN-4567: the public frame: "Templates" is the one h1 and the tab title.
    await expect(page.locator(SELECTORS.nav.heading)).toHaveText('Templates');
    await expect(page).toHaveTitle('Templates · Harbour');
  });

  test('shows all 20 non-meta templates (LIN-4248: + the two Surveys; LIN-4437: + blind-read)', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.prompt-card')).toHaveCount(20);
  });

  test('never renders the meta prompt', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.meta-prompt-section')).toHaveCount(0);
    await expect(page.locator('.meta-prompt-text')).toHaveCount(0);
    await expect(page.getByText('Meta-Prompt', { exact: true })).toHaveCount(0);
  });

  test('copy button copies a template to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/templates');

    const firstCard = page.locator('.prompt-card').first();
    const expectedText = await firstCard.locator('.prompt-text').textContent();

    await firstCard.locator('.template-copy-btn').click();
    await expect(firstCard.locator('.template-copy-btn')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(expectedText);
  });

  test('footer link navigates here from the landing page', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('.page-footer a.footer-legal[href="/templates"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveTitle(/Templates/);
  });

  test('shows the footer every page shares, and no signed-in navigation', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator(SELECTORS.nav.footer)).toBeVisible();
    await expect(page.locator(SELECTORS.nav.footerLink('privacy'))).toHaveAttribute('href', '/privacy');
    await expect(page.locator(SELECTORS.nav.rail)).toHaveCount(0);
  });
});
