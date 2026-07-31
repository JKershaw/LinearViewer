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

// LIN-1743 (Phase 2) gesture helpers — real DOM events dispatched on the
// timeline viewport, not reaching into module-private state. Touch/TouchEvent
// constructors work in this project's bundled Chromium regardless of a
// `hasTouch` context, so pinch/pan are exercised as genuine touch sequences.
async function wheelZoom(page, selector, { deltaY, ctrlKey = true }) {
  await page.locator(selector).evaluate((el, opts) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new WheelEvent('wheel', {
      deltaY: opts.deltaY, ctrlKey: opts.ctrlKey, bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    }));
  }, { deltaY, ctrlKey });
}

async function pinch(page, selector, { startSpread, endSpread }) {
  await page.locator(selector).evaluate((el, opts) => {
    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    const touchesAt = (spread) => [
      new Touch({ identifier: 1, target: el, clientX: midX - spread / 2, clientY: midY }),
      new Touch({ identifier: 2, target: el, clientX: midX + spread / 2, clientY: midY }),
    ];
    el.dispatchEvent(new TouchEvent('touchstart', { touches: touchesAt(opts.startSpread), bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: touchesAt(opts.endSpread), bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  }, { startSpread, endSpread });
}

async function dragPan(page, selector, { startX, dx }) {
  await page.locator(selector).evaluate((el, opts) => {
    const rect = el.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const touchAt = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [touchAt(opts.startX)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [touchAt(opts.startX + opts.dx)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  }, { startX, dx });
}

// A vertical-dominant one-finger drag (F3): unlike native touch input, a
// synthetic TouchEvent never drives the browser's own scrolling regardless of
// `touch-action` — but that's exactly why it still proves this fix. F3's fix
// is plain JS (`els.timeline.scrollTop` / `window.scrollBy`) reacting to the
// touchmove handler's OWN axis-lock + delta math, not native touch-scroll, so
// a synthetic event exercises the real code path end to end.
async function dragPanVertical(page, selector, { startY, dy }) {
  await page.locator(selector).evaluate((el, opts) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const touchAt = (y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [touchAt(opts.startY)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [touchAt(opts.startY + opts.dy)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  }, { startY, dy });
}

// The viewport's own current { start, end } window (public/live-console.js's
// syncTimelineWindowAttrs), in epoch ms. A seeded run in these specs is only
// ever a second or two old, which sits under updateTimelineBarNode's MIN_W
// visibility floor at EVERY span the presets/gestures can reach — its bar's
// own rendered geometry is therefore useless for telling spans apart. The
// window bounds are the real, floor-free signal these tests need.
async function timelineWindow(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="live-console-timeline"]');
    return { start: Number(el.dataset.windowStart), end: Number(el.dataset.windowEnd) };
  });
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

    test('a just-seeded, still-running run renders with a measurable width (min-width sliver survives for a fresh/near-now run)', async ({ page }) => {
      // Regression for the review's blocking finding: `100 - startPct` degenerates
      // to the run's own duration-percentage for anything ending at/near "now", so
      // the 0.6% MIN_W floor was silently defeated for exactly the newest work —
      // the bar landed in the DOM with the right data-kind but at sub-pixel width
      // (measured ~0.28px on the review's own repro), so the panel read as visually
      // empty even with live runs seeded. `toBeVisible()` alone can't catch this —
      // it passes on a 0.0025px-wide box — so this asserts a measured px width.
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-8022' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"][data-kind="working"]');
      const { barWidth, viewportWidth } = await page.evaluate(() => {
        const viewport = document.querySelector('[data-testid="live-console-timeline"]');
        const bar = document.querySelector('[data-testid="live-console-timeline-bar"][data-kind="working"]');
        return { barWidth: bar.getBoundingClientRect().width, viewportWidth: viewport.clientWidth };
      });
      // The 0.6% MIN_W floor in px for this viewport, with a small tolerance for
      // sub-pixel rounding — well above the sub-1px width a defeated floor renders.
      const expectedFloorPx = viewportWidth * 0.006;
      expect(barWidth).toBeGreaterThanOrEqual(expectedFloorPx - 0.5);
    });

    test('a fresh/still-running bar is actually painted at a desktop (1280px) viewport, not just present in the DOM', async ({ page }) => {
      // General paint-identity smoke test, not tied to any particular layout:
      // `toBeVisible()` and a `getBoundingClientRect().width` check (the prior
      // test) both describe the bar's OWN box and are blind to an ancestor's
      // overflow clip. `elementFromPoint` at the bar's own centre resolves to
      // the bar itself when painted, and to some clipping ancestor when not —
      // this caught real bugs across review cycles 1-3 (a defeated min-width
      // floor, then two generations of a full-bleed breakout overshooting its
      // container; see the CSS comment on `.lc-timeline-section` in
      // public/live-console.css). The breakout is gone now — the timeline
      // lays out in `.lc-page`'s ordinary column — but this stays as a cheap,
      // durable guarantee that a bar is genuinely rendered to the user.
      await page.setViewportSize({ width: 1280, height: 720 });
      await seedRunningLoopWithToken(page, URL_KEY, { task: 'LIN-8023' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"][data-kind="working"]');
      const paintedTestid = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="live-console-timeline-bar"][data-kind="working"]');
        const rect = bar.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return hit ? hit.getAttribute('data-testid') : null;
      });
      expect(paintedTestid).toBe('live-console-timeline-bar');
    });

    test('the bars viewport is exactly as wide as the page column (no breakout, no inset) at both mobile and desktop widths', async ({ page }) => {
      // Cycle-3 review's suggested durable check, generalized: the existing
      // mobile overflow test (`scrollWidth <= clientWidth`) is one-directional
      // and passes on a box that is too NARROW, which is exactly the bug a
      // prior full-bleed-breakout attempt introduced below 640px (measured
      // 294px vs. the page column's 319px at 390px). Comparing the bars
      // viewport's width directly against `.lc-lanes-section` — a sibling
      // section that has never had a breakout — catches both an overshoot and
      // an inset, at any viewport, and fails on either regression.
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-8024', message: '[done] shipped it' });
      for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(size);
        await page.goto(PAGE_URL);
        await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
        const widths = await page.evaluate(() => ({
          timeline: document.querySelector('[data-testid="live-console-timeline"]').getBoundingClientRect().width,
          lanes: document.querySelector('[data-testid="live-console-lanes"]').getBoundingClientRect().width,
        }));
        expect(widths.timeline).toBeCloseTo(widths.lanes, 0);
      }
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

  // Zoom/pan/gestures (LIN-1743, Phase 2 of LIN-1720): the 1h/24h presets,
  // ctrl/meta+wheel desktop zoom, and touch pinch+drag on the timeline
  // viewport built in Phase 1. `timelineWindow` reads the window bounds off
  // the viewport element rather than a bar's rendered geometry, because a
  // freshly-seeded run's actual duration (a second or two) sits under
  // updateTimelineBarNode's MIN_W visibility floor at every span these tests
  // reach, which would make its rendered width identical regardless of zoom.
  test.describe('Zoom & pan gestures (LIN-1743)', () => {
    const TIMELINE = '[data-testid="live-console-timeline"]';
    const PRESET_1H = '[data-testid="live-console-timeline-preset-1h"]';
    const PRESET_24H = '[data-testid="live-console-timeline-preset-24h"]';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const HOUR_MS = 60 * 60 * 1000;

    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ liveConsole: true })}&urlKey=${URL_KEY}`);
      await clearFeed(page, URL_KEY);
    });
    test.afterEach(async ({ page }) => {
      await clearFeed(page, URL_KEY);
    });

    test('the 1h preset narrows the window to exactly 1h and marks itself pressed', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9001', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const before = await timelineWindow(page);
      expect(before.end - before.start).toBe(DAY_MS); // Phase 1's unchanged default

      await page.locator(PRESET_1H).click();
      const after = await timelineWindow(page);

      expect(after.end - after.start).toBe(HOUR_MS);
      await expect(page.locator(PRESET_1H)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(PRESET_24H)).toHaveAttribute('aria-pressed', 'false');
    });

    test('the 24h preset returns to the default live window after a 1h detour', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9002', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');

      await page.locator(PRESET_1H).click();
      await page.locator(PRESET_24H).click();
      const restored = await timelineWindow(page);

      expect(restored.end - restored.start).toBe(DAY_MS);
      await expect(page.locator(PRESET_24H)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(PRESET_1H)).toHaveAttribute('aria-pressed', 'false');
    });

    test('ctrl+wheel zooms in smoothly; a plain wheel (no ctrl/meta) leaves the window untouched', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9003', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const baseline = await timelineWindow(page);

      await wheelZoom(page, TIMELINE, { deltaY: -200, ctrlKey: false });
      expect(await timelineWindow(page)).toEqual(baseline); // native page scroll instead

      await wheelZoom(page, TIMELINE, { deltaY: -800, ctrlKey: true }); // negative deltaY: zoom in
      const zoomed = await timelineWindow(page);
      expect(zoomed.end - zoomed.start).toBeLessThan(baseline.end - baseline.start);
      // Both presets go un-pressed once the span is a custom (non-preset) value.
      await expect(page.locator(PRESET_1H)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator(PRESET_24H)).toHaveAttribute('aria-pressed', 'false');
    });

    test('a poll tick mid-gesture does not reset a custom (non-preset) zoom level', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9004', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');

      await wheelZoom(page, TIMELINE, { deltaY: -1200, ctrlKey: true });
      const zoomed = await timelineWindow(page);
      expect(zoomed.end - zoomed.start).toBeLessThan(DAY_MS);
      await page.waitForTimeout(5500); // one more 5s poll tick
      expect(await timelineWindow(page)).toEqual(zoomed);
    });

    test('pinch-zoom (touch-emulated) narrows the window as the fingers spread', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9005', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const baseline = await timelineWindow(page);

      await pinch(page, TIMELINE, { startSpread: 20, endSpread: 240 });
      const zoomed = await timelineWindow(page);
      expect(zoomed.end - zoomed.start).toBeLessThan(baseline.end - baseline.start);
    });

    test('single-finger drag pans the window (bounds shift) without changing its span', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9006', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      // At the default 24h span the window already covers the FULL allowed
      // axis [now-24h, now] — there is nowhere to pan without immediately
      // hitting both edge clamps, which would snap it right back to itself.
      // Zoom in first (1h) so a pan has room to move.
      await page.locator(PRESET_1H).click();
      const before = await timelineWindow(page);

      // Dragging right reveals EARLIER time — the window shifts back in time,
      // preserving its span exactly (no clamp in play, well inside the axis).
      await dragPan(page, TIMELINE, { startX: 300, dx: 150 });
      const after = await timelineWindow(page);

      expect(after.end - after.start).toBe(before.end - before.start);
      expect(after.start).toBeLessThan(before.start);
      expect(after.end).toBeLessThan(before.end);
    });

    test('a gesture that does not originate on the timeline leaves its window untouched (normal page scroll survives)', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9007', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const baseline = await timelineWindow(page);

      // Dispatched on a sibling section, never reaching the timeline's own
      // listeners — the gesture handlers are scoped to els.timeline only.
      await pinch(page, '[data-testid="live-console-lanes"]', { startSpread: 20, endSpread: 240 });
      await dragPan(page, '[data-testid="live-console-lanes"]', { startX: 300, dx: 150 });

      expect(await timelineWindow(page)).toEqual(baseline);
    });

    test('a run entirely outside the zoomed window is culled, not shown as a phantom edge sliver (F1)', async ({ page }) => {
      // seedTerminalWorker always dispatches "now" (see its own comment above),
      // so a genuinely stale run needs a route-intercept — the same technique
      // the LIN-1743 review used to surface this in the first place.
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9010', message: '[done] ok' });
      let injected = false;
      await page.route(`**${EVENTS_API}`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (!injected) {
          injected = true;
          const now = body.serverNow;
          const staleRun = {
            id: 'f1-stale-run', issueIdentifier: 'LIN-9099', kind: 'implementation', promptName: null,
            outcomeKind: 'done', start: now - 22 * HOUR_MS, end: now - 22 * HOUR_MS + 60000,
            stillRunning: false, clippedStart: false, groupKey: 'f1-stale-run', followUpTo: null,
            workspaceUrlKey: URL_KEY,
          };
          body.timeline = body.timeline || { rows: [] };
          body.timeline.rows = [...(body.timeline.rows || []), [staleRun]];
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      const staleBar = page.locator('[data-testid="live-console-timeline-bar"][aria-label*="LIN-9099"]');
      // At the default 24h span both the fresh and the 22h-old run overlap the window.
      await expect(staleBar).toBeVisible();

      // Zoom to 1h: the 22h-old run no longer overlaps the window at all, so it
      // must disappear — not clamp to a 0.6%-wide sliver pinned to the left edge.
      await page.locator(PRESET_1H).click();
      await expect(staleBar).toBeHidden();
    });

    test('zooming into a span with nothing in it shows the empty state, even without a poll in between (F1)', async ({ page }) => {
      let injected = false;
      await page.route(`**${EVENTS_API}`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (!injected) {
          injected = true;
          const now = body.serverNow;
          const staleRun = {
            id: 'f1-empty-state-run', issueIdentifier: 'LIN-9098', kind: 'implementation', promptName: null,
            outcomeKind: 'done', start: now - 20 * HOUR_MS, end: now - 20 * HOUR_MS + 60000,
            stillRunning: false, clippedStart: false, groupKey: 'f1-empty-state-run', followUpTo: null,
            workspaceUrlKey: URL_KEY,
          };
          body.timeline = { rows: [[staleRun]], connectors: [], truncated: false, totalInWindow: 1 };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });

      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      await expect(page.locator('#live-console-timeline-empty')).toBeHidden();

      // Zoom to 1h — the run's 20h-old activity is fully outside this window,
      // so the panel has nothing to show and must say so immediately (F1's
      // second finding: visibleCount previously counted every run regardless
      // of window overlap, so this empty state was unreachable at any zoom).
      await page.locator(PRESET_1H).click();
      await expect(page.locator('#live-console-timeline-empty')).toBeVisible();
    });

    test('a plain mouse drag pans the window on desktop (F2)', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9011', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      // Zoom in first (1h) so a pan has room to move, same reasoning as the
      // touch drag-pan test above.
      await page.locator(PRESET_1H).click();
      const before = await timelineWindow(page);

      const box = await page.locator(TIMELINE).boundingBox();
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.3, y);
      await page.mouse.down();
      // Drag right: reveals EARLIER time, mirroring the touch drag-pan test's
      // direction convention exactly.
      await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
      await page.mouse.up();

      const after = await timelineWindow(page);
      expect(after.end - after.start).toBe(before.end - before.start);
      expect(after.start).toBeLessThan(before.start);
      expect(after.end).toBeLessThan(before.end);
    });

    test('a vertical-dominant one-finger swipe over the timeline scrolls the page instead of hitting a dead zone (F3)', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9012', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      // A single seeded run packs into one row — well under Q4's ~15-row
      // internal-scroll threshold, so the viewport itself has no overflow to
      // absorb the swipe and the whole delta must fall through to the page.
      const before = await page.evaluate(() => window.scrollY);

      await dragPanVertical(page, TIMELINE, { startY: 200, dy: -220 });

      const after = await page.evaluate(() => window.scrollY);
      expect(after).toBeGreaterThan(before);
    });

    test('a mostly-vertical swipe with a small horizontal wobble locks to the vertical axis and does not pan the window (F3)', async ({ page }) => {
      await seedTerminalWorker(page, URL_KEY, { task: 'LIN-9013', message: '[done] ok' });
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid="live-console-timeline-bar"]');
      await page.locator(PRESET_1H).click(); // give a pan somewhere to go, if it wrongly fires
      const baseline = await timelineWindow(page);

      await page.locator(TIMELINE).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const touchAt = (dx, dy) => new Touch({ identifier: 1, target: el, clientX: x + dx, clientY: y + dy });
        // Small horizontal wobble (2px), large vertical travel (60px) — the
        // axis should lock to vertical on the first move past the jitter
        // threshold and stay there for the rest of the gesture.
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touchAt(0, 0)], bubbles: true, cancelable: true }));
        el.dispatchEvent(new TouchEvent('touchmove', { touches: [touchAt(2, 60)], bubbles: true, cancelable: true }));
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
      });

      expect(await timelineWindow(page)).toEqual(baseline);
    });
  });
});
