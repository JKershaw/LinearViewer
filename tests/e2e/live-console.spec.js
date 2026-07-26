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

// ─── per-lane credential state (LIN-1588, Beat 2 of LIN-1577) ────────────────
//
// The lane badge answers, at a glance across the whole fleet, which working
// session is authenticated-but-stranded. The verdict is Beat 1's
// (`credentialVerdict`, lib/proxy-events.js), resolved at the route and injected
// into the pure transform — nothing here re-derives it.
//
// A genuine `token_ownerless` row cannot be produced under NODE_ENV=test (the
// 503 path that writes the note is short-circuited), so the audit rows are seeded
// through Beat 1's own `/test/seed-proxy-event` seam.
test.describe('Live Console lane credential (LIN-1588)', () => {
  // Same discipline as the sibling session-page suite: agent-status writes fire
  // the observation-sessions materializer, and `clearFeed` above does not reach
  // those rows — so a spec later in this shard would inherit a workspace that
  // looks busy. Clear what we seeded, including the materialized sessions.
  test.afterEach(async ({ page }) => {
    await clearFeed(page, URL_KEY);
    await page.request.get(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
    await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
  });

  // A running worker whose agent-status row carries a token → a lane with a
  // non-null agentTokenId. The tokenId forwarding in /test/seed-agent-status is
  // itself part of this ticket; without it no lane could leave `unknown`.
  async function seedRunningLaneWithToken(page, { task, tokenId, tokenLabel = 'dispatch-bootstrap' }) {
    const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: task, issueTitle: 'Credential lane', target: 'cli' },
    });
    expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
    const workerId = (await worker.json()).item.id;
    const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
    await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (tokenId) {
      // `dispatchId` is required, not decorative: taking the worker moves it to
      // history with `resolvedAt` stamped, which closes the timestamp window
      // `_matchAgentStatusToLoop` would otherwise use — a status row seeded even
      // milliseconds later falls outside it. The dispatchId exact-match path is
      // the deterministic one.
      const seeded = await page.request.post('/test/seed-agent-status', {
        data: { urlKey: URL_KEY, taskIdentifier: task, action: 'implementation', status: 'in_progress', summary: `on ${task}`, tokenId, tokenLabel, dispatchId: workerId },
      });
      expect(seeded.status(), `agent-status seed failed: ${await seeded.text()}`).toBe(200);
    }
    return workerId;
  }

  test('a stranded worker is badged dead on its lane', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
    await clearFeed(page, URL_KEY);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);

    const tokenId = 'lin1588-lane-dead';
    await seedRunningLaneWithToken(page, { task: 'LIN-1588', tokenId });
    // Both rows the predicate requires within its 15-min window: the ownerless
    // breadcrumb AND a sub-400 success proving the worker itself is still alive.
    await page.request.get(`/test/seed-proxy-event?urlKey=${URL_KEY}&tokenId=${tokenId}&status=503&note=token_ownerless&endpoint=/api/proxy/issues`);
    await page.request.get(`/test/seed-proxy-event?urlKey=${URL_KEY}&tokenId=${tokenId}&status=201&endpoint=/api/proxy/agent/status`);

    await page.goto(PAGE_URL);
    await page.waitForSelector('[data-testid="live-console-lane"]');

    // Scoped to THIS task's lane, not `.first()` — a residual lane from another
    // spec in the same shard would otherwise decide what we assert on.
    const lane = page.locator('[data-testid="live-console-lane"]', { hasText: 'LIN-1588' }).first();
    const badge = lane.locator('[data-testid="live-console-lane-credential"]');
    await expect(badge).toHaveAttribute('data-state', 'dead');
    await expect(badge).toContainText('dead');
  });

  test('a lane with no token renders unknown — the ordinary case, and never healthy', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
    await clearFeed(page, URL_KEY);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);

    await page.request.post('/test/seed-agent-status', {
      data: { urlKey: URL_KEY, taskIdentifier: 'LIN-1588-NOTOK', action: 'implementation', status: 'in_progress', summary: 'no credential identity' },
    });

    await page.goto(PAGE_URL);
    await page.waitForSelector('[data-testid="live-console-lane"]');

    const lane = page.locator('[data-testid="live-console-lane"]', { hasText: 'LIN-1588-NOTOK' }).first();
    const badge = lane.locator('[data-testid="live-console-lane-credential"]');
    await expect(badge).toHaveAttribute('data-state', 'unknown');
    // The one direction this must never fail in.
    await expect(badge).not.toHaveAttribute('data-state', 'ok');
  });

  test('the events endpoint carries credential state on every lane', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
    await clearFeed(page, URL_KEY);
    await page.request.post('/test/seed-agent-status', {
      data: { urlKey: URL_KEY, taskIdentifier: 'LIN-1588-API', action: 'implementation', status: 'in_progress', summary: 'lane shape' },
    });

    const resp = await page.request.get(EVENTS_API);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.lanes.length).toBeGreaterThan(0);
    for (const lane of body.lanes) {
      expect(lane.credential, `lane ${lane.task} carries credential`).toBeTruthy();
      expect(['dead', 'ok', 'unknown']).toContain(lane.credential.state);
    }
  });
});
