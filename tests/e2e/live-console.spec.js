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

// Dispatch a worker, claim it, then post a terminal feedback marker so the
// loop reconstructs with a `terminalStatus`/`terminalCompletedAt` — a DONE or
// FAILED timeline run. `dispatchedAt` is always "now" (no test seam backdates
// it), so this can only produce runs well inside the live 24h window; the
// clipped-start (dispatch predates the window) and truncation-cap paths are
// unit-tested instead (tests/unit/live-console-timeline.test.js), where `now`
// is injected and arbitrary timestamps are cheap.
async function seedTerminalWorker(page, key, { task, message }) {
  const worker = await page.request.post(`/workspace/${key}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: task, issueTitle: `${task} worker`, target: 'cli' },
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner-${task}&urlKey=${key}`)).json();
  await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
  await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message },
  });
  return workerId;
}

// A CSS color token (e.g. `--red`) resolved to the browser's computed rgb()
// form, so it can be compared against an element's computed background-color
// without hardcoding either side's exact string format.
async function resolveColorToken(page, token) {
  return page.evaluate((varName) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const probe = document.createElement('div');
    probe.style.color = value;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);
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

    // Route-A regression assertion (LIN-1741, Phase 0 of LIN-1720). Pins the
    // pre-panel geometry of the strip and its page container so a later phase's
    // render/CSS change fails this test if it disturbs either — the recorded,
    // non-image substitute for a pixel-diff gate this repo has no harness for.
    // Values captured fresh against current markup, not assumed from prose:
    // .lc-page's 1rem side padding plus the root's `scrollbar-gutter: stable`
    // reservation narrow the mobile strip well below a naive viewport-minus-padding
    // guess, so 319 (not 358) is the real pinned width at 390px.
    test('route A: .lc-pulse geometry and .lc-page max-width stay pinned (LIN-1741)', async ({ page }) => {
      const pulse = page.locator('.lc-pulse');

      const desktop = await pulse.evaluate(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { width: r.width, height: r.height, display: cs.display, position: cs.position };
      });
      expect(desktop).toEqual({ width: 868, height: 46, display: 'block', position: 'static' });

      const maxWidth = await page.locator('.lc-page').evaluate(el => getComputedStyle(el).maxWidth);
      expect(maxWidth).toBe('900px');

      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await pulse.evaluate(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { width: r.width, height: r.height, display: cs.display, position: cs.position };
      });
      expect(mobile).toEqual({ width: 319, height: 46, display: 'block', position: 'static' });
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
    // Same discipline as the session-page credential specs: these seed a live
    // (non-terminal) run plus proxy-event rows, both of which persist in the dev
    // store, so the block clears on the way OUT as well as in — otherwise its
    // leftovers become the next spec file's starting condition.
    test.afterEach(async ({ page }) => {
      await clearFeed(page, URL_KEY);
    });

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

  // Timeline (LIN-1742, Phase 1 of LIN-1720): static, non-zoomable last-24h
  // swimlane panel between the filter chips and the "working now" lanes rail.
  test.describe('Timeline (LIN-1742)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
    });
    test.afterEach(async ({ page }) => {
      await clearFeed(page, URL_KEY);
    });

    test('one bar renders per seeded run, and the bars viewport never overflows horizontally', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8001', message: '[done] shipped it' });
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8002', message: '[failed] broke on step 3' });
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-8003' });

      await page.goto(PAGE_URL);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="live-console-timeline-bar"]').length >= 3);
      await expect(page.locator('[data-testid="live-console-timeline-bar"]')).toHaveCount(3);

      // Route-A-style invariant (LIN-1741 honesty note extended to this new
      // element): the bars viewport is never meant to natively overflow —
      // re-layout, not zoom-via-CSS-transform, is the design for Phase 2+.
      const viewport = page.locator('[data-testid="live-console-timeline"]');
      const overflow = await viewport.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test('the bars viewport never overflows horizontally at a 390×844 mobile viewport either', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8005', message: '[done] shipped it' });
      await page.goto(PAGE_URL);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const viewport = page.locator('[data-testid="live-console-timeline"]');
      const overflow = await viewport.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test('a terminal-failed run renders data-kind="failed" with the --red background', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8010', message: '[failed] broke on step 3' });
      await page.goto(PAGE_URL);
      // waitForSelector first (generous default timeout) — the poll+paint cycle
      // can occasionally still be in flight right after goto, and expect()'s
      // own default timeout (5s) is tighter than that first-paint race allows.
      await page.waitForSelector('[data-testid="live-console-timeline-bar"][data-kind="failed"]');
      const bar = page.locator('[data-testid="live-console-timeline-bar"][data-kind="failed"]').first();
      await expect(bar).toBeVisible();
      // The attribute alone would also pass on an uncoloured bar — the computed
      // background-color read is the assertion that actually exercises the fix.
      const bg = await bar.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(await resolveColorToken(page, '--red'));
    });

    test('a still-running run renders data-kind="working" with the --amber background', async ({ page }) => {
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-8020' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"][data-kind="working"]');
      const bar = page.locator('[data-testid="live-console-timeline-bar"][data-kind="working"]').first();
      await expect(bar).toBeVisible();
      const bg = await bar.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(await resolveColorToken(page, '--amber'));
    });

    test('a done run renders data-kind="done" with the --green background', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8025', message: '[done] shipped it' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"][data-kind="done"]');
      const bar = page.locator('[data-testid="live-console-timeline-bar"][data-kind="done"]').first();
      await expect(bar).toBeVisible();
      const bg = await bar.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(await resolveColorToken(page, '--green'));
    });

    test('chip-filter parity: a bar carries the seeding workspace on data-ws', async ({ page }) => {
      // A single-workspace test session keeps the chip row itself hidden
      // (LIN-1436 house rule), but `isVisibleWs` filtering is wired from the
      // SAME `data-ws` attribute a multi-workspace session's chips toggle —
      // this pins that the bar carries the right key for that filter to act on.
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8030', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const bar = page.locator('[data-testid="live-console-timeline-bar"]').first();
      await expect(bar).toHaveAttribute('data-ws', URL_KEY);
    });

    test('empty state shows with no runs in the window, and hides once one is seeded', async ({ page }) => {
      await page.goto(PAGE_URL);
      await expect(page.locator('#live-console-timeline-empty')).toBeVisible();

      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8040', message: '[done] ok' });
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      await expect(page.locator('#live-console-timeline-empty')).toBeHidden();
    });

    test('a bar keeps the SAME DOM node across a poll tick (keyed reconcile, never innerHTML-replaced)', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8050', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const bar = page.locator('[data-testid="live-console-timeline-bar"]').first();
      await expect(bar).toBeVisible();
      // Tag the live node directly; if the next poll rebuilt it via innerHTML
      // instead of updating in place, this custom attribute would be gone.
      await bar.evaluate(el => { el.dataset.probe = 'still-here'; });
      await page.waitForTimeout(5500); // one more 5s poll tick
      await expect(bar).toHaveAttribute('data-probe', 'still-here');
    });
  });
});
