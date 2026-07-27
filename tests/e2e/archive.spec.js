import { test, expect } from '@playwright/test';

// Archive pages: numbered standalone HTML documents under docs/archive/,
// served verbatim at /archive/:n with no auth. Archives #1 and #2 are the
// first and second editions of "The Harbour Archive" museum page; the
// landing page's archive section links the latest edition.

test.describe('Archive Pages', () => {

  test('serves archive #1 without authentication', async ({ page }) => {
    const response = await page.goto('/archive/1');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/The Harbour Archive/);
  });

  test('serves archive #2 (the second edition) without authentication', async ({ page }) => {
    const response = await page.goto('/archive/2');
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

  test('landing page links to the latest archive edition', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('[data-testid="landing-archive-link"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/archive/2');
    await link.click();
    await expect(page).toHaveTitle(/The Harbour Archive/);
  });
});
