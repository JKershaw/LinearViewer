import { test, expect } from '../fixtures/test-base.js';

// LIN-450: the experimental Collective page. Seeds via /test/set-session (the
// page needs only a session with workspaces + the per-user `collective` flag;
// it does not fetch provider data). Yap is not configured in the test env, so
// the live state/say endpoints return 503 — asserted below.

const URL_KEY = 'test-workspace';
const COLLECTIVE_URL = `/workspace/${URL_KEY}/collective`;
const SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
const API_PREFIX = `/workspace/${URL_KEY}`;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.describe('Collective Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.collective-header h1')).toHaveText('Collective');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="collective"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the discussion page")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the discussion page")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('lists connected workspaces as checkboxes', async ({ page }) => {
      const checks = page.locator('.collective-ws-check');
      expect(await checks.count()).toBe(2);
      await expect(page.locator('.collective-ws-row:has-text("Test Workspace")')).toBeVisible();
      await expect(page.locator('.collective-ws-row:has-text("Second Workspace")')).toBeVisible();
    });

    test('has channel, topic, target, and start controls', async ({ page }) => {
      await expect(page.locator('#collective-channel')).toHaveValue('#Collective');
      await expect(page.locator('#collective-topic')).toBeVisible();
      await expect(page.locator('#collective-target')).toBeVisible();
      await expect(page.locator('#collective-start')).toBeVisible();
    });

    test('only offers cli and web targets', async ({ page }) => {
      const options = await page.locator('#collective-target option').allTextContents();
      expect(options).toEqual(['cli', 'web']);
    });

    test('has a transcript pane and say box', async ({ page }) => {
      await expect(page.locator('#collective-transcript')).toHaveCount(1);
      await expect(page.locator('#collective-say-input')).toBeVisible();
      await expect(page.locator('#collective-say-btn')).toBeVisible();
    });

    test('includes the collective stylesheet and script', async ({ page }) => {
      await expect(page.locator('link[href="/collective.css"]')).toHaveCount(1);
      await expect(page.locator('script[src="/collective.js"]')).toHaveCount(1);
    });
  });

  test.describe('Start fan-out', () => {
    test('dispatches a participant prompt to each selected workspace', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&${featuresParam({ collective: true })}`);

      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: ['test-workspace', 'second-workspace'], channel: '#Collective', target: 'cli' },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.channel).toBe('#Collective');
      expect(body.dispatched).toHaveLength(2);
      expect(body.dispatched.every(d => d.ok)).toBe(true);
      // Distinct, legible nicks derived from workspace names.
      const nicks = body.dispatched.map(d => d.nick);
      expect(new Set(nicks).size).toBe(2);

      // The prompt landed in each workspace's own dispatch queue.
      const queue = await (await page.request.get(`${API_PREFIX}/api/dispatch`)).json();
      const item = queue.items.find(i => i.promptName === 'collective-participant');
      expect(item).toBeTruthy();
    });

    test('rejects an unconnected workspace in the selection', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: ['nope-workspace'], target: 'cli' },
      });
      expect(res.status()).toBe(400);
    });

    test('rejects the dash target', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: ['test-workspace'], target: 'dash' },
      });
      expect(res.status()).toBe(400);
    });
  });

  test.describe('Yap proxy endpoints (unconfigured in test)', () => {
    test('state endpoint reports Yap not configured', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      const res = await page.request.get(`${API_PREFIX}/api/collective/state?channel=%23Collective`);
      expect(res.status()).toBe(503);
    });

    test('say endpoint reports Yap not configured', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/api/collective/say`, {
        data: { channel: '#Collective', message: 'hello' },
      });
      expect(res.status()).toBe(503);
    });
  });
});
