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

// Lanes now derive from RUNNING dispatch loops too, and those persist in the dev
// store across tests/runs — so a clean slate must clear dispatch state as well as
// the agent-status log (clearing agent-status alone leaves running loops behind).
async function clearFeed(page, key) {
  await page.request.get(`/test/clear-agent-status?urlKey=${key}`);
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${key}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${key}`);
  // LIN-1588: lane credential state reads the proxy-event audit rows, which
  // persist in the dev store the same way dispatch state does.
  await page.request.get(`/test/clear-proxy-events?urlKey=${key}`);
}

// LIN-1588: drive a RUNNING loop that carries a credential identity.
// `/test/seed-agent-status` forwards tokenId/tokenLabel (widened for this
// ticket), and the loop reconstruction lifts them onto the loop as
// agentTokenId/agentTokenLabel — the only way an E2E can produce a non-null
// agentTokenId, since NODE_ENV=test short-circuits the real 503 path.
async function seedRunningLoopWithToken(page, key, { task, tokenId = null, tokenLabel = null }) {
  const worker = await page.request.post(`/workspace/${key}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: task, issueTitle: `${task} worker`, target: 'cli' },
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${key}`)).json();
  await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
  // `dispatchId` is load-bearing, not decoration: claiming the item stamps
  // `resolvedAt`, which closes the loop's window — so a status row seeded after
  // the take can only attach via the matcher's EXACT dispatchId branch.
  await page.request.post('/test/seed-agent-status', {
    data: { urlKey: key, taskIdentifier: task, action: 'implementation', status: 'in_progress', summary: `working ${task}`, tokenId, tokenLabel, dispatchId: workerId },
  });
  return workerId;
}

// Seed the audit rows Beat 1's predicate folds into `credential_dead`: within
// the window, a token needs BOTH an exactly-`token_ownerless` note AND a
// success (<400). Anything less is not a death, by design.
async function seedDeadCredential(page, key, tokenId) {
  await page.request.get(`/test/seed-proxy-event?urlKey=${key}&tokenId=${tokenId}&status=503&note=token_ownerless&endpoint=/api/proxy/issues`);
  await page.request.get(`/test/seed-proxy-event?urlKey=${key}&tokenId=${tokenId}&status=201&endpoint=/api/proxy/agent/status`);
}

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
      // The dev store persists across runs; start these structure tests clean.
      await clearFeed(page, URL_KEY);
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

    test('the activity-strip canvas keeps a stable backing size across polls (no growth)', async ({ page }) => {
      const canvas = page.locator('#live-console-tempo');
      // Let the strip render at its full-width backing size (past the HTML default).
      await page.waitForFunction(() => {
        const c = document.getElementById('live-console-tempo');
        return c && c.clientWidth > 0 && c.width === Math.round(c.clientWidth * (window.devicePixelRatio || 1));
      });
      const first = await canvas.evaluate(c => c.width);
      await page.waitForTimeout(11000); // ~2 poll cycles + continuous animation frames
      const later = await canvas.evaluate(c => c.width);
      expect(later).toBe(first); // the old bug compounded width by devicePixelRatio each poll
    });
  });

  test.describe('Live data', () => {
    test('renders seeded events with click-through to Observation', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
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

    test('a running worker becomes a heartbeat lane and its [evidence] a stream event', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);

      // Dispatch a worker, claim it (→ agentState 'running'), then post a rich
      // heartbeat + an [evidence] marker through the real consumer flow.
      const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-950', issueTitle: 'Heartbeat worker', target: 'cli' },
      });
      expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
      const workerId = (await worker.json()).item.id;
      const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
      await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
      await page.request.post(`/api/dispatch/feedback/${workerId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: '[working] 12 tools in 8m 11s: Bash×7, Read×5 · 15 total' },
      });
      await page.request.post(`/api/dispatch/feedback/${workerId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: '[evidence] PR opened', url: 'https://github.com/x/y/pull/9', urlLabel: 'PR #9' },
      });

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-lane"]');

      // The lane carries a live heartbeat metric derived from the [working] beat.
      const hb = page.locator('[data-testid="live-console-heartbeat"]').first();
      await expect(hb).toContainText('tools');
      await expect(hb).toContainText('Bash×7');

      // The [evidence] marker surfaces as an evidence event linking to the artifact.
      const evidence = page.locator('[data-testid="live-console-event"][data-kind="evidence"]').first();
      await expect(evidence).toBeVisible();
      await expect(evidence.locator('a.lc-event-summary-link')).toHaveAttribute('href', 'https://github.com/x/y/pull/9');
    });

    test('a stale "working" entry drops off the lanes but still shows in the stream', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
      const now = Date.now(), min = 60 * 1000;
      const seedWorking = (id, agoMin) => page.request.post('/test/seed-agent-status', {
        data: { urlKey: URL_KEY, taskIdentifier: id, action: 'implementation', status: 'in_progress', summary: `on ${id}`, timestamp: new Date(now - agoMin * min).toISOString() },
      });
      await seedWorking('LIN-STALE', 120); // 2h idle → not a lane
      await seedWorking('LIN-FRESH', 3);   // 3m ago → a live lane

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-lane"]');

      // Exactly one lane — the fresh one; the stale session fell off the radar.
      await expect(page.locator('[data-testid="live-console-lane"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="live-console-lane"]')).toContainText('LIN-FRESH');
      // But the stale session's step is still legitimate history in the stream.
      await expect(page.locator('[data-testid="live-console-event"]', { hasText: 'LIN-STALE' })).toBeVisible();
    });

    test('"view earlier activity" pages older events into the history region', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);

      // Two RECENT events (live window) + two OLD ones (hours ago) that only the
      // history pager should reach. Deterministic timestamps via the test seam.
      const now = Date.now();
      const min = 60 * 1000;
      const seed = (id, agoMin) => page.request.post('/test/seed-agent-status', {
        data: { urlKey: URL_KEY, taskIdentifier: id, action: 'implementation', status: 'completed', summary: `work on ${id}`, timestamp: new Date(now - agoMin * min).toISOString() },
      });
      await seed('LIN-100', 1);
      await seed('LIN-101', 2);
      await seed('LIN-200', 30 * 60); // 30h ago — beyond the 24h live window
      await seed('LIN-201', 40 * 60); // 40h ago — history-only

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-event"]');

      // History endpoint returns the OLDER events strictly before a cursor.
      const res = await page.request.get(`${EVENTS_API}?before=${now - 60 * min}&limit=10`);
      const body = await res.json();
      const ids = body.events.map(e => e.task);
      expect(ids).toContain('LIN-200');
      expect(ids).toContain('LIN-201');

      // And the client's "view earlier activity" control drives the same path.
      const moreBtn = page.locator('[data-testid="live-console-more"]');
      if (await moreBtn.isVisible()) {
        await moreBtn.click();
        await expect(page.locator('#live-console-history [data-testid="live-console-event"]').first()).toBeVisible();
      }
    });
  });

  // LIN-1588 (Beat 2 of LIN-1577): per-session credential state on the lane, so
  // "which of my four trees is dead?" is answerable from the rail rather than by
  // opening the BLOCKED park a stranded worker wrote.
  test.describe('Lane credential state', () => {
    test('a lane whose session has no credential identity reads `unknown`', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
      // No tokenId — the ORDINARY case (~99.86% of dispatches, LIN-1585).
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-1588A' });

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-lane"]');
      const badge = page.locator('[data-testid="live-console-lane-credential"]').first();
      await expect(badge).toHaveAttribute('data-state', 'unknown');
      await expect(badge).toContainText('unknown');
    });

    test('a lane whose credential is dead is badged `dead`', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-1588B', tokenId: 'tok-dead-e2e', tokenLabel: 'dispatch-bootstrap' });
      await seedDeadCredential(page, URL_KEY, 'tok-dead-e2e');

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-lane"]');
      const badge = page.locator('[data-testid="live-console-lane-credential"]').first();
      await expect(badge).toHaveAttribute('data-state', 'dead');
      await expect(badge).toContainText('credential dead');
    });

    test('a token with recent successes but NO ownerless breadcrumb is not dead', async ({ page }) => {
      // Negative control: this isolates the badge from a hardcoded "any token is
      // dead" — the ownerless note is half of Beat 1's conjunction.
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-1588C', tokenId: 'tok-live-e2e', tokenLabel: 'dispatch-bootstrap' });
      await page.request.get(`/test/seed-proxy-event?urlKey=${URL_KEY}&tokenId=tok-live-e2e&status=200&endpoint=/api/proxy/me`);

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-lane"]');
      const badge = page.locator('[data-testid="live-console-lane-credential"]').first();
      await expect(badge).toHaveAttribute('data-state', 'ok');
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
