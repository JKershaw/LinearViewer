import { test, expect } from '@playwright/test';

// Archive pages: numbered standalone HTML documents under docs/archive/,
// served verbatim at /archive/:n with no auth. Archives #1 and #2 are the
// first and second editions of "The Harbour Archive" museum page; #3 is a
// different kind of document — the 2026-08-03 project brief, companion to
// docs/reviews/recent-headwinds-review-2026-08-03.md. The numbering is a
// sequence of standalone documents, not of Harbour Archive editions.
//
// The landing page's archive section links the Harbour Archive specifically
// (hard-coded /archive/2), so adding a non-Archive document does NOT move it —
// that is asserted below so the two cannot drift silently.

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

  test('serves archive #3 (the project brief) without authentication', async ({ page }) => {
    const response = await page.goto('/archive/3');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Project Brief/);
  });

  test('archive #3 loads its self-hosted faces from public/fonts', async ({ page }) => {
    // It links /fonts/*.woff2 rather than inlining them as base64 (same origin,
    // unlike the published artifact). A moved or renamed face would silently
    // degrade the page to system fallbacks, so assert the faces actually load.
    await page.goto('/archive/3');
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    });
    expect(loaded).toContain('Inter');
    expect(loaded).toContain('JetBrains Mono');
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
