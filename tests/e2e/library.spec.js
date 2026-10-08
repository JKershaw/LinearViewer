/**
 * E2E tests for the public Harbour Library (LIN-3344, Part A of LIN-3342).
 *
 * The Library requires no authentication. Search must work with JavaScript
 * off, so those paths run under `javaScriptEnabled: false`; the CSP check runs
 * with JS on, because `securitypolicyviolation` needs a listener.
 */
import { test, expect } from '@playwright/test';

test.describe('Library — server-rendered, no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('index renders Start here, papers and Archive editions', async ({ page }) => {
    await page.goto('/library');
    await expect(page.locator('h2', { hasText: 'Start here' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Papers and essays' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Archive editions' })).toBeVisible();
    await expect(page.locator('[data-testid="library-item-link"]').first()).toBeVisible();
  });

  test('a search submitted with JavaScript off lands on a result', async ({ page }) => {
    await page.goto('/library');
    await page.fill('[data-testid="library-search-input"]', 'review loops');
    await page.press('[data-testid="library-search-input"]', 'Enter');
    await expect(page).toHaveURL(/\/library\?q=/);
    const result = page.locator('[data-testid="library-result-link"]', { hasText: 'plan-review' }).first();
    await expect(result).toBeVisible();
  });

  test('a result links to a readable document page', async ({ page }) => {
    await page.goto('/library?q=review+loops');
    await page.locator('[data-testid="library-result-link"]').first().click();
    await expect(page.locator('[data-testid="library-doc-title"]')).toBeVisible();
    await expect(page).toHaveTitle(/Harbour Library/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
  });

  test('a document serves a working .md link', async ({ page, request }) => {
    await page.goto('/library/review-loops');
    const md = page.locator('[data-testid="library-markdown-link"]');
    await expect(md).toHaveAttribute('href', '/library/review-loops.md');
    const res = await request.get('/library/review-loops.md');
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/plan-review/i);
  });
});

test.describe('Library — CSP', () => {
  test('no securitypolicyviolation fires on index, a document, or results', async ({ page }) => {
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await page.goto('/library');
    await page.goto('/library/review-loops');
    await page.goto('/library?q=review+loops');

    const violations = await page.evaluate(() => window.__cspViolations || []);
    expect(violations).toEqual([]);
  });
});
