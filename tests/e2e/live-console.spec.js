import { test, expect } from '../fixtures/test-base.js';

// Experimental Live Console — an ambient, generation-free feed of the whole
// swarm working (LIN-1436). Seeds via /test/set-session (the test-token
// workspace); the page fetches no provider data and the events endpoint reads
// the agent-status store (empty in a fresh test workspace → the empty feed).

let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;
let EVENTS_API;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/live-console`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  EVENTS_API = `/workspace/${URL_KEY}/api/live-console/events`;
});

test.describe('Live Console (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.page-header h1')).toHaveText('Live Console');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="liveConsole"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the live console")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the live console")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders the banner, lanes rail, and stream mount points', async ({ page }) => {
      await expect(page.locator('[data-testid="live-console-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="live-console-lanes"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="live-console-stream"]')).toHaveCount(1);
      await expect(page.locator('#live-console-tempo')).toHaveCount(1);
    });

    test('shows the empty states with no activity in a fresh workspace', async ({ page }) => {
      // The poll runs on load; with no agent-status entries both empty states show.
      await expect(page.locator('#live-console-lanes-empty')).toBeVisible();
      await expect(page.locator('#live-console-stream-empty')).toBeVisible();
    });

    test('filter chips stay hidden for a single-workspace session', async ({ page }) => {
      // Chips only earn their place when there is more than one workspace to filter.
      await expect(page.locator('#live-console-chips')).toBeHidden();
    });
  });

  test.describe('Live data', () => {
    test('renders seeded events with click-through to Observation', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await page.request.get(`/test/clear-agent-status?urlKey=${URL_KEY}`);
      await page.request.post('/test/seed-agent-status', {
        data: { urlKey: URL_KEY, taskIdentifier: 'LIN-777', action: 'implementation', status: 'in_progress', summary: 'wiring the thing' },
      });
      await page.request.post('/test/seed-agent-status', {
        data: { urlKey: URL_KEY, taskIdentifier: 'LIN-778', action: 'review', status: 'completed', summary: 'approved and merged' },
      });

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-event"]');

      // A working task becomes a pulse-lane; a completed one is a done event.
      await expect(page.locator('[data-testid="live-console-lane"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="live-console-event"]').first()).toBeVisible();

      // The event task links through to that workspace's Observation page.
      const link = page.locator('.lc-event-task', { hasText: 'LIN-778' });
      await expect(link).toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);
    });
  });

  test.describe('Events endpoint', () => {
    test('returns the feed shape when enabled', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.get(EVENTS_API);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(Array.isArray(body.events)).toBeTruthy();
      expect(Array.isArray(body.lanes)).toBeTruthy();
      expect(Array.isArray(body.tempo)).toBeTruthy();
      expect(body.summary).toMatchObject({ active: expect.any(Number), total: expect.any(Number) });
    });

    test('is gated (403) when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      const res = await page.request.get(EVENTS_API);
      expect(res.status()).toBe(403);
    });
  });
});
