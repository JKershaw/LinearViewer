import { test, expect } from '../fixtures/test-base.js';

// Experimental "suggest the next autopilot run" page (LIN-603). Seeds via
// /test/set-session (the test-token workspace), so the suggest endpoint serves
// deterministic, grounded mock options without an OpenRouter key. The page itself
// fetches no provider data; the suggest endpoint builds options from the data
// fixtures in test mode.

// Bound per-test from the per-worker key so session + nav + suggest API all
// address this worker's partition.
let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;
let SUGGEST_API;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/next-run`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  SUGGEST_API = `/workspace/${URL_KEY}/api/next-run/suggest`;
});

test.describe('Suggested Next Run Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.next-run-header h1')).toHaveText('Suggested Next Run');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="nextRun"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the next-run suggester")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the next-run suggester")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('has a generate button and an empty options state', async ({ page }) => {
      await expect(page.locator('#next-run-generate')).toBeVisible();
      await expect(page.locator('#next-run-options')).toHaveCount(1);
      await expect(page.locator('#next-run-empty')).toBeVisible();
    });

    test('includes the next-run stylesheet and script', async ({ page }) => {
      await expect(page.locator('link[href="/next-run.css"]')).toHaveCount(1);
      await expect(page.locator('script[src="/next-run.js"]')).toHaveCount(1);
    });
  });

  test.describe('Generation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders grounded option cards with a size and a continue-until-stopped option', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      // Options appear; the empty state is gone.
      const options = page.locator('.next-run-option');
      await expect(options.first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#next-run-empty')).toBeHidden();

      // Every option carries a t-shirt size badge.
      await expect(page.locator('.next-run-size').first()).toBeVisible();

      // The always-present open-ended option is rendered and tagged.
      await expect(page.locator('.next-run-option-open')).toHaveCount(1);
      await expect(page.locator('.next-run-open-tag')).toContainText('continue until stopped');
    });

    test('a concrete option links to dispatch with the goal prefilled', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const accept = page.locator('.next-run-option:not(.next-run-option-open) .next-run-accept').first();
      await expect(accept).toBeVisible({ timeout: 5000 });
      const href = await accept.getAttribute('href');
      expect(href).toContain('/dispatch?goal=');
    });

    test('the continue-until-stopped option links to dispatch with no goal', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const accept = page.locator('.next-run-option-open .next-run-accept');
      await expect(accept).toBeVisible({ timeout: 5000 });
      const href = await accept.getAttribute('href');
      expect(href).toContain('/dispatch');
      expect(href).not.toContain('goal=');
    });
  });

  test.describe('Suggest endpoint', () => {
    test('returns 403 when the feature flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      const res = await page.request.post(SUGGEST_API, { data: {} });
      expect(res.status()).toBe(403);
    });

    test('returns options including the open-ended one when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(SUGGEST_API, { data: {} });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.options)).toBe(true);
      expect(body.options.length).toBeGreaterThan(0);
      const open = body.options[body.options.length - 1];
      expect(open.continueUntilStopped).toBe(true);
      expect(open.goal).toBe('');
    });
  });
});
