/**
 * E2E tests for the public /templates page (LIN-1889).
 *
 * The page requires no authentication and publishes the 16 non-meta prompt
 * templates for anyone to view and copy. Modeled on tests/e2e/kpis.spec.js
 * and tests/e2e/legal.spec.js.
 */
import { test, expect } from '@playwright/test';

test.describe('Templates page', () => {
  test('renders without authentication', async ({ page }) => {
    const response = await page.goto('/templates');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Templates/);
  });

  test('shows all 16 non-meta templates', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.prompt-card')).toHaveCount(16);
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

  test('shows footer with legal links, highlighting the current page', async ({ page }) => {
    await page.goto('/templates');
    const footer = page.locator('.page-footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-current')).toHaveText('templates');
    await expect(footer.locator('a.footer-legal[href="/privacy"]')).toBeVisible();
    await expect(page.locator('.footer-actions')).not.toBeVisible();
  });
});
