import { test, expect } from '../fixtures/test-base.js';
import { featuresParam } from '../helpers.js';

// LIN-1728 Phase 3/4 — the escalation surface: the ambient "waiting on you"
// nav badge and the filtered rulings tab + option-button primitive. Seeding
// mirrors tests/e2e/session-page.spec.js's seedSessionWithDecision (the live
// feed reconstructs sessions/loops from the dispatch stores, so a decision is
// posted through the real consumer take+feedback flow) — extended here with
// `options`/`recommended` so the option-button row actually has buttons to
// press, which session-page.spec.js's own decision fixture never needed.

let URL_KEY;
let OBSERVATION_URL;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

// Seed a taken worker carrying a `kind: 'decision'` entry with real options
// (unlike session-page.spec.js's minimal question-only fixture). Posting
// `[blocked]` first yields `wakeMarker: 'blocked'` → disposition `resumable`;
// omitting it (agentState stays the take-default `running`) yields `mid-turn`.
async function seedDecisionWorker(page, { issueIdentifier, issueTitle, decisionId, blocked }) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);

  if (blocked) {
    const blockedResp = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
      headers: auth, data: { message: '[blocked] need a ruling before continuing' }
    });
    expect(blockedResp.status(), `blocked feedback failed: ${await blockedResp.text()}`).toBe(200);
  }

  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: {
      kind: 'decision',
      message: JSON.stringify({
        decision_id: decisionId,
        question: 'Proceed with option A?',
        options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
        recommended: 'a'
      })
    }
  });
  expect(decision.status(), `decision feedback failed: ${await decision.text()}`).toBe(200);
  return { workerId };
}

test.describe('Rulings tab (LIN-1728 Phase 4)', () => {
  test('a third tab renders alongside Autopilot/Sessions', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    const tabs = page.locator('#obs-tabs .obs-tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('.obs-tab[data-view="rulings"]')).toBeVisible();
    await expect(page.locator('.obs-tab[data-view="rulings"]')).not.toHaveClass(/is-active/);
  });

  test('a resumable ruling renders with pressable option buttons; the session views hide while active', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-R', issueTitle: 'Resumable ruling', decisionId: 'd-rulings-1', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();
    await expect(page.locator('.obs-tab[data-view="rulings"]')).toHaveClass(/is-active/);

    // The session-views shell (Filter/Active/Archive) hides while the rulings
    // tab is active — a ruling is not a session, and the two must not bleed.
    await expect(page.locator('#obs-session-views')).toBeHidden();
    await expect(page.locator('#obs-rulings-section')).toBeVisible();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-R' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Proceed with option A?');
    await expect(row.locator('.chat-options-caption')).toHaveText('Reply & continue');
    const buttons = row.locator('.chat-option-btn');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.filter({ hasText: 'Approve' })).toHaveClass(/chat-option--recommended/);
  });

  test('pressing an option delivers a durable comment (decisionLoopId/decisionId) then a follow-up dispatch, and the row clears', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-P', issueTitle: 'Press-through ruling', decisionId: 'd-rulings-2', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-P' });
    await expect(row).toBeVisible();

    const [commentReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      row.locator('.chat-option-btn').filter({ hasText: 'Approve' }).click()
    ]);
    const commentPayload = commentReq.postDataJSON();
    expect(commentPayload.decisionLoopId).toBe(workerId);
    expect(commentPayload.decisionId).toBe('d-rulings-2');
    expect(commentPayload.body).toBe('Approve');
    expect((await commentReq.response()).status()).toBe(201);

    // The comment write stamps `markDecisionAnswered` best-effort — a later
    // poll's /rulings read no longer carries this decision. Budget generously:
    // the server-side sessionsFeedCache is a 5s-TTL stale-while-revalidate
    // cache (lib/sessions-feed-cache.js) — the poll that crosses the TTL still
    // serves the STALE (pre-answer) value while kicking a background refresh,
    // so it takes a SECOND post-TTL read to observe the fresh count. Measured
    // at ~8s server-side in practice; 20s leaves real headroom above that.
    await expect(page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-P' })).toHaveCount(0, { timeout: 20000 });
  });

  test('partial failure (comment recorded, resume delivery fails) surfaces a Retry delivery affordance, which re-fires only the dispatch call', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-F', issueTitle: 'Partial-failure ruling', decisionId: 'd-rulings-4', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-F' });
    await expect(row).toBeVisible();

    // Fail the follow-up dispatch call once (simulating a synchronous 503) —
    // the comment write must still land untouched (mirrors
    // tests/e2e/session-page.spec.js's equivalent public/session.js coverage).
    let dispatchAttempts = 0;
    let commentAttempts = 0;
    await page.route('**/api/dispatch', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      dispatchAttempts += 1;
      if (dispatchAttempts === 1) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'queue temporarily unavailable' }) });
      }
      return route.continue();
    });
    await page.route('**/api/comments/**', async (route) => {
      if (route.request().method() === 'POST') commentAttempts += 1;
      return route.continue();
    });

    await row.locator('.chat-option-btn').filter({ hasText: 'Approve' }).click();

    const feedback = row.locator('.obs-ruling-feedback');
    await expect(feedback).toContainText('Recorded');
    await expect(feedback).toContainText('Could not resume');
    const retryBtn = row.locator('.obs-ruling-retry-delivery');
    await expect(retryBtn).toBeVisible();
    expect(commentAttempts).toBe(1);

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      retryBtn.click()
    ]);
    expect((await request.response()).status()).toBe(201);
    // The comment is never resent by the retry (I4 invariant, LIN-2200) —
    // only the dispatch call re-fires.
    expect(commentAttempts).toBe(1);
    await expect(feedback).toContainText('recorded ✓');
  });

  test('a mid-turn ruling renders read-only — no buttons, no dispatch attempted', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-M', issueTitle: 'Mid-turn ruling', decisionId: 'd-rulings-3', blocked: false });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-M' });
    await expect(row).toBeVisible();
    await expect(row.locator('.chat-options-caption')).toHaveText('still running — reply disabled');
    await expect(row.locator('.chat-option-btn')).toHaveCount(0);

    let dispatchFired = false;
    page.on('request', (r) => { if (r.url().includes('/api/dispatch') && r.method() === 'POST') dispatchFired = true; });
    await page.waitForTimeout(300);
    expect(dispatchFired).toBe(false);
  });
});

test.describe('Ambient rulings nav badge (LIN-1728 Phase 3)', () => {
  // The badge's own poll (public/app.js) is loaded on the projects page (and
  // most other pages) but deliberately NOT on Observation (lib/render-
  // observation.js's scripts are common.js/chat.js/observation.js — see
  // the Phase 3 plan note on this pre-existing limitation, same as the queue
  // badge). Exercise the live client wiring where it actually runs.
  test('hidden with no rulings, shows a workspace-scoped count once one exists, gated on the dispatch flag like the queue badge', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ dispatch: true })}`);
    await clearRuns(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toBeAttached();
    await expect(badge).toHaveClass(/hidden/);

    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-B', issueTitle: 'Badge ruling', decisionId: 'd-rulings-badge-1', blocked: true });
    // The page's own initRulingsBadge() already read+cached a count-0 result on
    // load (before the seed above) — drop the server-side sessionsFeedCache
    // entry so the next read is a cold miss (fresh, synchronous) rather than a
    // stale-while-revalidate hit inside the still-warm 5s TTL window
    // (lib/sessions-feed-cache.js).
    await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);

    // Drive the real client function directly rather than waiting out the 5s
    // RULINGS_POLL_INTERVAL_MS timer — same determinism trade the existing
    // queue-badge e2e coverage makes.
    await page.evaluate((urlKey) => window.updateRulingsBadge(urlKey), URL_KEY);
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.rulings-count')).toHaveText('1');

    // Server-side scoping check: the count comes from `req.session.workspaces`,
    // never fleet-wide.
    const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.workspaces.map(w => w.urlKey)).toContain(URL_KEY);
  });

  test('absent when the dispatch flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-rulings-badge]')).toHaveCount(0);
  });
});

// LIN-2191 (open question from the LIN-1728 plan): a second badge in
// `.nav-primary-row`'s `.nav-actions` risks reproducing/worsening the
// pre-existing ≤320px header-clearance breach that ticket already tracks.
// Measured here, not assumed — see the test body for the verdict this feeds.
test.describe('.nav-primary-row width at ≤320px with both badges visible (LIN-2191 follow-up check)', () => {
  test('two visible badges do not add a wrapped row beyond the pre-existing single-badge breach', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ dispatch: true })}`);
    await clearRuns(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Baseline: both badges hidden (0 queued, 0 rulings) — today's shipped shape.
    const baselineRows = await page.evaluate(() => {
      const els = document.querySelectorAll('.nav-primary-row > *');
      return new Set(Array.from(els).map(el => Math.round(el.getBoundingClientRect().top))).size;
    });

    // Force both badges visible (as if there were 1 queued item and 1 ruling) —
    // the worst case this ticket's plan flags, without needing a real queued
    // dispatch item seeded too.
    await page.evaluate(() => {
      document.querySelectorAll('[data-queue-badge], [data-rulings-badge]').forEach(b => b.classList.remove('hidden'));
    });
    const bothVisibleRows = await page.evaluate(() => {
      const els = document.querySelectorAll('.nav-primary-row > *');
      return new Set(Array.from(els).map(el => Math.round(el.getBoundingClientRect().top))).size;
    });

    // Not a strict "must not wrap" assertion — LIN-2191 already documents this
    // row wrapping at ≤320px independent of any badge (that pre-existing
    // reproduction is captured in `baselineRows` itself, not this comparison).
    // This guards specifically against a SECOND badge adding an ADDITIONAL
    // wrapped row on top of that pre-existing shape — the "worsens" half of
    // the Phase 3 plan note; a bare reproduction is recorded (not silently
    // absorbed) by this test's own existence rather than by failing it.
    expect(bothVisibleRows, `.nav-primary-row grew from ${baselineRows} row(s) to ${bothVisibleRows} row(s) at 320px with both badges visible`).toBeLessThanOrEqual(baselineRows);
  });
});
