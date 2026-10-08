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

  test('index renders Start here, the shelves and Archive editions', async ({ page }) => {
    await page.goto('/library');
    await expect(page.getByRole('heading', { level: 2, name: 'Start here', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Essays', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Papers', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Other documents', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Archive editions', exact: true })).toBeVisible();
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

  test('a document page has a link back to the Library', async ({ page }) => {
    await page.goto('/library/review-loops');
    await page.locator('[data-testid="library-back-link"]').click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator('h2', { hasText: 'Papers' })).toBeVisible();
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

    // `addInitScript` resets the array on every navigation, so assert after EACH
    // goto. Reading only at the end would check just the last page and miss a
    // violation on the index or the document (LIN-3344 review F3).
    await page.goto('/library');
    expect(await page.evaluate(() => window.__cspViolations), 'index').toEqual([]);

    await page.goto('/library/review-loops');
    expect(await page.evaluate(() => window.__cspViolations), 'document').toEqual([]);

    await page.goto('/library?q=review+loops');
    expect(await page.evaluate(() => window.__cspViolations), 'results').toEqual([]);
  });
});

// LIN-3345 (Part B of LIN-3342): crawler files. Run against the real server so
// the Archive locs (served by server.js, not the Library router) are exercised
// too — every sitemap URL must resolve 200 and carry no `noindex`.
test.describe('Library — crawler files', () => {
  test('every sitemap <loc> resolves 200 without noindex and without a query', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/xml');
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.some((loc) => new URL(loc).pathname === '/library')).toBe(true);
    for (const loc of locs) {
      expect(loc).not.toContain('?');
      const page = await request.get(loc);
      expect(page.status(), loc).toBe(200);
      expect(page.headers()['x-robots-tag'], loc).not.toBe('noindex');
    }
  });

  test('robots.txt allows crawling and points at the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toMatch(/^Allow: \/$/m);
    expect(body).toContain('/sitemap.xml');
    expect(body).not.toMatch(/Disallow:/);
  });
});

// LIN-3351: figures are <img> SVGs with their own prefers-color-scheme rule. An
// <img> SVG follows the embedder's color-scheme in Chromium/Firefox; WebKit does
// not (accepted status quo — it keeps the light figure), so this is Chromium-only.
test.describe('Library figures — dark mode', () => {
  const canvasLuminance = async (page) => {
    const img = page.locator('.library-doc__body img').first();
    await expect(img).toBeVisible();
    await img.scrollIntoViewIfNeeded();
    const png = await img.screenshot();
    return page.evaluate(async (b64) => {
      const i = new Image();
      i.src = `data:image/png;base64,${b64}`;
      await i.decode();
      const c = document.createElement('canvas');
      c.width = i.width; c.height = i.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(i, 0, 0);
      const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }, png.toString('base64'));
  };

  test.describe('OS dark scheme', () => {
    test.use({ colorScheme: 'dark' });
    test('a figure canvas is dark, not a white block', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', 'WebKit does not apply the embedder color-scheme to <img> SVGs');
      await page.goto('/library/cost-mix');
      expect(await canvasLuminance(page)).toBeLessThan(0.2);
    });
  });

  test.describe('theme=dark cookie with a light OS', () => {
    test.use({ colorScheme: 'light' });
    test('the html.theme-dark path also darkens the figure', async ({ page, context, browserName }) => {
      test.skip(browserName === 'webkit', 'WebKit does not apply the embedder color-scheme to <img> SVGs');
      await context.addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
      await page.goto('/library/cost-mix');
      await expect(page.locator('html')).toHaveClass(/theme-dark/);
      expect(await canvasLuminance(page)).toBeLessThan(0.2);
    });
  });

  test.describe('light scheme', () => {
    test.use({ colorScheme: 'light' });
    test('a figure canvas stays white', async ({ page }) => {
      await page.goto('/library/cost-mix');
      expect(await canvasLuminance(page)).toBeGreaterThan(0.9);
    });
  });
});
