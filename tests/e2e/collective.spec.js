import { test, expect } from '../fixtures/test-base.js';

// LIN-450: the experimental Collective page. Seeds via /test/set-session (the
// page needs only a session with workspaces + the per-user `collective` flag;
// it does not fetch provider data). Yap is not configured in the test env, so
// the live state/say endpoints return 503 — asserted below.

// Bound per-test from the per-worker key (LIN-628) so the session, nav, the
// start fan-out's character repo bindings, and the say/state proxy calls all address
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
      // Title routes through the shared renderPageHeader primitive (LIN-975).
      await expect(page.locator('.page-header h1')).toHaveText('Collective');
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

    test('offers a define-new character form grounded in the connected workspaces', async ({ page }) => {
      // The character picker replaced the raw workspace checkboxes (LIN-1048):
      // a new character is bound to a connected repo via the repo select.
      const repo = page.locator('[data-testid="collective-char-repo"]');
      await expect(repo).toBeVisible();
      const repoOptions = await repo.locator('option').allTextContents();
      expect(repoOptions).toContain('Test Workspace');
      expect(repoOptions).toContain('Second Workspace');
      // All five persona fields (value included) plus the add control are present.
      for (const f of ['role', 'lens', 'objective', 'value', 'disposition']) {
        await expect(page.locator(`[data-testid="collective-char-${f}"]`)).toBeVisible();
      }
      await expect(page.locator('[data-testid="collective-char-add"]')).toBeVisible();
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
    test.beforeEach(async ({ page }) => {
      // Characters persist per anchor workspace — clear so recents from a prior
      // run don't leak into a fresh assertion.
      await page.request.get(`/test/clear-collective-characters?urlKey=${URL_KEY}`);
    });

    test('dispatches a participant prompt for each selected character', async ({ page, secondWorkerUrlKey }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);

      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: {
          characters: [
            { workspaceUrlKey: URL_KEY, role: 'Skeptic' },
            { workspaceUrlKey: secondWorkerUrlKey },
          ],
          channel: '#Collective',
          target: 'cli',
        },
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

    test('records a recent character that then appears in the picker on reload', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);

      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: {
          characters: [{ workspaceUrlKey: URL_KEY, role: 'Archivist', name: 'The Archivist' }],
          channel: '#Collective',
          target: 'cli',
        },
      });
      expect(res.status()).toBe(201);

      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');
      // The dispatched character was recorded as `recent` and now lists in the picker.
      const row = page.locator('[data-testid="collective-character"]:has-text("The Archivist")');
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-kind', 'recent');
    });

    test('define a character in the UI, then start dispatches it', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="collective-char-name"]').fill('UI Skeptic');
      await page.locator('[data-testid="collective-char-role"]').fill('Skeptic');
      await page.locator('[data-testid="collective-char-add"]').click();

      // The defined character appears as a selected row.
      await expect(page.locator('[data-testid="collective-character"]:has-text("UI Skeptic")')).toBeVisible();

      const startResp = page.waitForResponse(r => r.url().includes('/collective/start') && r.request().method() === 'POST');
      await page.locator('#collective-start').click();
      const res = await startResp;
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.dispatched.length).toBeGreaterThanOrEqual(1);
      expect(body.dispatched.every(d => d.ok)).toBe(true);
    });

    test('rejects a character bound to an unconnected workspace', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { characters: [{ workspaceUrlKey: 'nope-workspace' }], target: 'cli' },
      });
      expect(res.status()).toBe(400);
    });

    test('rejects the dash target', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      const res = await page.request.post(`${API_PREFIX}/collective/start`, {
        data: { characters: [{ workspaceUrlKey: URL_KEY }], target: 'dash' },
      });
      expect(res.status()).toBe(400);
    });
  });

  test.describe('Preset meetings (LIN-1050)', () => {
    test.beforeEach(async ({ page }) => {
      // Built-ins are always present (frozen constants, not DB rows) — only
      // custom presets/characters need clearing so a prior run's rows don't leak.
      // Also clear the dispatch queue: the per-worker urlKey is stable across
      // runs, so a facilitator/participant item dispatched by an earlier test
      // (this file's own Start-fan-out block, or a prior run against a
      // file-backed store) would otherwise inflate the queue-shape assertion.
      await page.request.get(`/test/clear-collective-presets?urlKey=${URL_KEY}`);
      await page.request.get(`/test/clear-collective-characters?urlKey=${URL_KEY}`);
      await page.request.get(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    });

    test('lists the 6 built-in presets in the picker', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="collective-preset"]')).toHaveCount(6);
      await expect(page.locator('[data-testid="collective-preset"][data-preset-id="builtin:standup"]')).toBeVisible();
      await expect(page.locator('[data-testid="collective-preset-repo"]')).toBeVisible();
    });

    test('launching a built-in preset replaces the picker with its roster, chair seat first', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="collective-preset-repo"]').selectOption(URL_KEY);
      await page.locator('[data-testid="collective-preset"][data-preset-id="builtin:standup"] [data-testid="collective-preset-launch"]').click();

      // Standup = 1 chair + 3 voices = 4 seats (the picker is fully swapped, not
      // added to — beat 3's resolved design).
      const rows = page.locator('[data-testid="collective-character"]');
      await expect(rows).toHaveCount(4);
      await expect(rows.first()).toContainText('Standup Chair');
      await expect(rows.first().locator('.collective-char-kind')).toHaveText('chair');

      // The preset's default topic is loaded into the topic field.
      await expect(page.locator('#collective-topic')).toHaveValue(/blocking the next step/);
    });

    test('launching then starting a preset dispatches its full roster with exactly one facilitator prompt', async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      // Bind the whole roster to THIS worker's own workspace, so its dispatch
      // queue (fetched below via API_PREFIX) receives every seat's item.
      await page.locator('[data-testid="collective-preset-repo"]').selectOption(URL_KEY);
      await page.locator('[data-testid="collective-preset"][data-preset-id="builtin:standup"] [data-testid="collective-preset-launch"]').click();
      await expect(page.locator('[data-testid="collective-character"]')).toHaveCount(4);

      const startResp = page.waitForResponse(r => r.url().includes('/collective/start') && r.request().method() === 'POST');
      await page.locator('#collective-start').click();
      const res = await startResp;
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.dispatched).toHaveLength(4);
      expect(body.dispatched.every(d => d.ok)).toBe(true);

      // The facilitator-ordering fix (LIN-1050 beat 3): every seat shares the
      // SAME repo, so /start's "first matching entry wins" rule only produces
      // the correct chair if the client reordered the facilitator seat first.
      // Confirm the dispatched fan-out reflects exactly that: one facilitator
      // prompt (naming the preset's designated chair), three plain participants.
      const queue = await (await page.request.get(`${API_PREFIX}/api/dispatch`)).json();
      const facilitatorItems = queue.items.filter(i => i.promptName === 'collective-facilitator');
      const participantItems = queue.items.filter(i => i.promptName === 'collective-participant');
      expect(facilitatorItems).toHaveLength(1);
      expect(participantItems.length).toBeGreaterThanOrEqual(3);
      expect(facilitatorItems[0].prompt).toContain('Standup Chair');
      expect(facilitatorItems[0].prompt).toContain('surface each project');
    });

    test('a saved custom preset lists and launches the same way as a built-in', async ({ page }) => {
      const seedRes = await page.request.post(`/test/seed-collective-preset?urlKey=${URL_KEY}`, {
        data: {
          name: 'E2E Test Meeting',
          objective: 'test the custom preset launch path',
          exitCondition: 'the e2e test passes',
          defaultTopic: 'custom preset topic',
          roster: [
            { name: 'Custom Chair', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd', isFacilitator: true },
            { name: 'Custom Voice', role: 'r2', lens: 'l2', objective: 'o2', value: 'v2', disposition: 'd2' },
          ],
        },
      });
      expect(seedRes.status()).toBe(200);

      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}&${featuresParam({ collective: true })}`);
      await page.goto(COLLECTIVE_URL);
      await page.waitForLoadState('networkidle');

      const customRow = page.locator('[data-testid="collective-preset"]:has-text("E2E Test Meeting")');
      await expect(customRow).toBeVisible();
      await expect(customRow).toHaveAttribute('data-kind', 'custom');

      await page.locator('[data-testid="collective-preset-repo"]').selectOption(URL_KEY);
      await customRow.locator('[data-testid="collective-preset-launch"]').click();

      const rows = page.locator('[data-testid="collective-character"]');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText('Custom Chair');
      await expect(page.locator('#collective-topic')).toHaveValue('custom preset topic');
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
