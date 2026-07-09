import { test, expect } from '../fixtures/test-base.js';

// "The Ship's Biscuit" — experimental, flag-gated LLM-set newspaper (LIN-818, V1:
// front page + index only). Seeds via /test/set-session (the test-token workspace),
// so the generate endpoint serves a deterministic MOCK edition (buildMockEdition,
// grounded in the real deterministic model) without an OpenRouter key. A quiet
// window (no seeded activity) produces an honest slow-news-day edition; seeding one
// agent-status entry gives the model feedstock so real inert headlines render.

let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;
let GENERATE_API;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/ship-biscuit`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  GENERATE_API = `/workspace/${URL_KEY}/api/ship-biscuit/generate`;
});

test.describe("The Ship's Biscuit (experimental)", () => {
  test.describe('Feature flag gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.page-header h1')).toHaveText("The Ship's Biscuit");
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="shipBiscuit"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`.settings-action:has-text("open The Ship's Biscuit")`)).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`.settings-action:has-text("open The Ship's Biscuit")`)).toBeVisible();
    });
  });

  test.describe('Page structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('has a run-the-presses button, a window selector and an empty state', async ({ page }) => {
      await expect(page.locator('#ship-biscuit-generate')).toBeVisible();
      await expect(page.locator('#ship-biscuit-window')).toBeVisible();
      await expect(page.locator('#ship-biscuit-empty')).toBeVisible();
    });

    test('includes the ship-biscuit stylesheet and script', async ({ page }) => {
      await expect(page.locator('link[href="/ship-biscuit.css"]')).toHaveCount(1);
      await expect(page.locator('script[src="/ship-biscuit.js"]')).toHaveCount(1);
    });
  });

  test.describe('Generation', () => {
    test.beforeEach(async ({ page }) => {
      // Start from a clean slate so quiet-window behaviour is deterministic.
      await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
      await page.goto(`/test/clear-ship-biscuit?urlKey=${URL_KEY}`);
      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
    });

    test('a quiet window yields an honest slow-news-day edition, never fabricated headlines', async ({ page }) => {
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#ship-biscuit-generate').click();

      // The front page renders with a lede, and the index is an honest quiet note —
      // no headline links at all.
      await expect(page.locator('[data-testid="ship-biscuit-lede"]')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="ship-biscuit-quiet"]')).toBeVisible();
      await expect(page.locator('[data-testid="ship-biscuit-headline"]')).toHaveCount(0);
    });

    test('seeded activity produces a front page with clickable-but-inert headlines', async ({ page }) => {
      // Seed one agent-status entry so the deterministic model has feedstock.
      await page.request.post(`/test/seed-agent-status`, {
        data: { urlKey: URL_KEY, taskIdentifier: 'TEST-1', summary: 'Implemented the widget and verified it end to end.' }
      });

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#ship-biscuit-generate').click();

      // A real front page: a lede plus at least one headline.
      await expect(page.locator('[data-testid="ship-biscuit-lede"]')).toBeVisible({ timeout: 5000 });
      const headline = page.locator('[data-testid="ship-biscuit-headline"]').first();
      await expect(headline).toBeVisible();

      // The headline is inert in V1: clicking it does NOT navigate; it surfaces a note.
      await headline.click();
      expect(page.url()).toContain('/ship-biscuit');
      await expect(page.locator('.ship-biscuit-inert-note').first()).toBeVisible();
    });

    test('a generated edition persists and re-renders on reload (durable store)', async ({ page }) => {
      await page.request.post(`/test/seed-agent-status`, {
        data: { urlKey: URL_KEY, taskIdentifier: 'TEST-2', summary: 'Fixed the flaky test and re-ran CI green.' }
      });
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#ship-biscuit-generate').click();
      await expect(page.locator('[data-testid="ship-biscuit-headline"]').first()).toBeVisible({ timeout: 5000 });

      // Reload: the server renders the latest saved edition from the durable store.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="ship-biscuit-headline"]').first()).toBeVisible();
    });
  });

  test.describe('Generate endpoint', () => {
    test('returns 403 when the feature flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      const res = await page.request.post(GENERATE_API, { data: {} });
      expect(res.status()).toBe(403);
    });

    test('returns a durable edition record when the flag is on', async ({ page }) => {
      await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(GENERATE_API, { data: { window: 'week' } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.edition).toBeTruthy();
      expect(body.edition.id).toBeTruthy();
      expect(body.edition.window).toBe('week');
      expect(typeof body.edition.frontPage.lede).toBe('string');
      expect(Array.isArray(body.edition.index)).toBe(true);
    });

    test('clamps an oversized window to the month max', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ shipBiscuit: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(GENERATE_API, { data: { window: 'quarter' } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.edition.window).toBe('month');
    });
  });
});
