import { test, expect } from '../fixtures/test-base.js';

// LIN-450: the experimental Collective page. Seeds via /test/set-session (the
// page needs only a session with workspaces + the per-user `collective` flag;
// it does not fetch provider data). Yap is not configured in the test env, so
// the live state/say endpoints return 503 — asserted below.

// Bound per-test from the per-worker key (LIN-628) so the session, nav, the
// start fan-out's workspaceUrlKeys, and the say/state proxy calls all address
// this worker's partition. Playwright workers are separate processes, so these
// module-scoped lets are per-worker state.
let URL_KEY;
let COLLECTIVE_URL;
let SETTINGS_URL;
let API_PREFIX;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  COLLECTIVE_URL = `/workspace/${URL_KEY}/collective`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  API_PREFIX = `/workspace/${URL_KEY}`;
});

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.describe('Collective Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.collective-header h1')).toHaveText('Collective');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="collective"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the discussion page")')).toHaveCount(0);

      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the discussion page")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
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
      // Default channel is a friendly random name: #word-word-YYYY-MM-DD.
      await expect(page.locator('#collective-channel')).toHaveValue(/^#[a-z]+-[a-z]+-\d{4}-\d{2}-\d{2}$/);
      await expect(page.locator('#collective-target')).toBeVisible();
      await expect(page.locator('#collective-start')).toBeVisible();
    });

    test('topic is a multi-line textarea', async ({ page }) => {
      const topic = page.locator('textarea#collective-topic');
      await expect(topic).toBeVisible();
    });

    test('view prompt shows a copyable participant prompt preview', async ({ page }) => {
      await page.locator('#collective-channel').fill('#review-room-2026-06-13');
      await page.locator('#collective-topic').fill('what should we build next?');
      await page.locator('#collective-view-prompt').click();

      const pre = page.locator('#collective-prompt-preview');
      await expect(pre).toBeVisible({ timeout: 5000 });
      const text = await pre.textContent();
      expect(text).toContain('#review-room-2026-06-13');
      expect(text).toContain('what should we build next?');
      // The auto-appended Linear-access block is shown with a placeholder token.
      expect(text).toContain('Workspace API access (auto-appended)');
      await expect(page.locator('#collective-prompt-copy')).toBeVisible();
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
    test('dispatches a participant prompt to each selected workspace', async ({ page, secondWorkerUrlKey }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);

      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: [URL_KEY, secondWorkerUrlKey], channel: '#Collective', target: 'cli' },
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
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: ['nope-workspace'], target: 'cli' },
      });
      expect(res.status()).toBe(400);
    });

    test('rejects the dash target', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { workspaceUrlKeys: [URL_KEY], target: 'dash' },
      });
      expect(res.status()).toBe(400);
    });
  });

  test.describe('Yap proxy endpoints (mock Yap)', () => {
    // YAP_BASE_URL points at the in-process mock Yap (routes/test.js), so the
    // poll/say plumbing round-trips deterministically without real egress.
    test('say then state round-trips a message through Yap', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.request.get('/test/yap/clear');
      const channel = '#e2e-roundtrip-2026-06-13';

      const say = await page.request.post(`${API_PREFIX}/api/collective/say`, {
        data: { channel, message: 'hello from John' },
      });
      expect(say.status()).toBe(200);
      expect((await say.json()).ok).toBe(true);

      const state = await page.request.get(`${API_PREFIX}/api/collective/state?channel=${encodeURIComponent(channel)}&since=0`);
      expect(state.status()).toBe(200);
      const body = await state.json();
      expect(body.channel).toBe(channel);
      expect(body.messages.some(m => m.text === 'hello from John')).toBe(true);
    });

    test('the say box posts the human input and it appears in the transcript', async ({ page }) => {
      await page.request.get('/test/yap/clear');
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      await page.locator('#collective-say-input').fill('steering note from the human');
      await page.locator('#collective-say-btn').click();

      await expect(page.locator('.collective-msg-body:has-text("steering note from the human")'))
        .toBeVisible({ timeout: 8000 });
    });
  });
});
