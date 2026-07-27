import { test, expect } from '@playwright/test';

// Archive pages: numbered standalone HTML documents under docs/archive/,
// served verbatim at /archive/:n with no auth. Archive #1 is "The Harbour
// Archive" museum page, linked from the landing page's archive section.

test.describe('Archive Pages', () => {

  test('serves archive #1 without authentication', async ({ page }) => {
    const response = await page.goto('/archive/1');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/The Harbour Archive/);
  });

  test('archive #1 is a standalone snapshot — no shared app chrome', async ({ page }) => {
    await page.goto('/archive/1');
    await expect(page.locator('.page-footer')).toHaveCount(0);
  });

  test('404s an archive number that does not exist', async ({ page }) => {
    const response = await page.goto('/archive/999');
    expect(response.status()).toBe(404);
  });

  test('404s a non-numeric archive path', async ({ page }) => {
    const response = await page.goto('/archive/not-a-number');
    expect(response.status()).toBe(404);
  });

  test('landing page links to archive #1', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('[data-testid="landing-archive-link"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveTitle(/The Harbour Archive/);
  });
});
