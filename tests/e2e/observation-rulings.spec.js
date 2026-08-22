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
// `urlKey` defaults to the page's own workspace; a two-workspace ruling test
// seeds it under a DIFFERENT workspace than the one being viewed (F1).
// `issueIdentifier`/`issueTitle` are optional — omitting both seeds an
// issueless run (F4), whose decision-bearing loop carries no issue anchor.
async function seedDecisionWorker(page, { issueIdentifier, issueTitle, decisionId, blocked, urlKey = URL_KEY }) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
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

async function clearRunsFor(page, urlKey) {
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-agent-status?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-observation-sessions?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
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

  test('LIN-1728 review F1: a ruling from a non-page workspace writes its comment/stamp/dispatch in the RULING\'s own workspace, and clears', async ({ page, secondWorkerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&multiWorkspace=true`);
    await clearRuns(page);
    await clearRunsFor(page, secondWorkerUrlKey);

    // Seed the decision-bearing loop under the SECOND workspace, then view it
    // from the FIRST workspace's Observation page — the exact cross-workspace
    // shape the review's repro steps describe.
    const { workerId } = await seedDecisionWorker(page, {
      issueIdentifier: 'LIN-1728-X', issueTitle: 'Cross-workspace ruling', decisionId: 'd-rulings-xws', blocked: true, urlKey: secondWorkerUrlKey
    });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-X' });
    await expect(row).toBeVisible();
    await expect(row).toContainText(secondWorkerUrlKey); // the workspace chip (renderRulingRow)

    const [commentReq, dispatchReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      row.locator('.chat-option-btn').filter({ hasText: 'Approve' }).click()
    ]);

    // Both writes must target the RULING's workspace, never the page's.
    expect(commentReq.url()).toContain(`/workspace/${secondWorkerUrlKey}/api/comments/`);
    expect(commentReq.url()).not.toContain(`/workspace/${URL_KEY}/api/comments/`);
    expect((await commentReq.response()).status()).toBe(201);
    const commentPayload = commentReq.postDataJSON();
    expect(commentPayload.decisionLoopId).toBe(workerId);
    expect(commentPayload.decisionId).toBe('d-rulings-xws');

    expect(dispatchReq.url()).toContain(`/workspace/${secondWorkerUrlKey}/api/dispatch`);
    expect(dispatchReq.url()).not.toContain(`/workspace/${URL_KEY}/api/dispatch`);
    expect((await dispatchReq.response()).status()).toBe(201);

    // The stamp landed in the RIGHT workspace's store (markDecisionAnswered
    // filters on {_id, urlKey}) — proven by the row actually clearing, which
    // it never would if the stamp had been written against the page's
    // workspace instead (F1's core bug: the row stays forever).
    await expect(page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-X' })).toHaveCount(0, { timeout: 20000 });
  });

  // LIN-1728 review F4 (issueless resumable ruling — no invalid
  // `/api/comments/null` write) is covered as a unit test, not here:
  // `lib/pipeline-loops.js`'s own reconstruction guard drops ANY dispatch
  // item with no `issueIdentifier` before it ever reaches `getLoopsForWorkspace`
  // (`!item.issueIdentifier` → "skipping malformed live item"), so a truly
  // issueless loop can never be seeded through the real dispatch pipeline
  // this suite drives — there is no live fixture path for it, only a
  // constructed one. See tests/unit/observation-ruling-delivery.test.js's
  // "resumable disposition" describe block, which builds the row directly.

  test('LIN-1728 review F3: a poll landing mid-reply does not discard the pending row — buttons stay disabled on the same visible row through the hold, and the reply still completes cleanly', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-Q', issueTitle: 'Poll-race ruling', decisionId: 'd-rulings-race', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="rulings"]').click();

    const row = page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-Q' });
    await expect(row).toBeVisible();
    // Tag the actual DOM node so we can assert IDENTITY survives the poll
    // below, not just that "a" row with the same text is visible (a rebuilt
    // replacement row would satisfy a text-only check just as well).
    await row.evaluate((el) => { el.dataset.testMarker = 'original'; });

    // Hold the comment write in flight for longer than one 5s poll tick
    // (POLL_MS, public/observation.js) so a real background poll lands while
    // the press is still outstanding — the exact race the review describes.
    await page.route('**/api/comments/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((r) => setTimeout(r, 6000));
      return route.continue();
    });

    const buttons = row.locator('.chat-option-btn');
    // Register the poll waiter BEFORE clicking so it catches the very next
    // background poll rather than racing a poll that landed between the
    // click and the wait — a deterministic signal instead of a guessed delay.
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/dashboard/rulings') && r.request().method() === 'GET', { timeout: 7000 }),
      row.locator('.chat-option-btn').filter({ hasText: 'Approve' }).click()
    ]);

    // Still the SAME DOM node (identity, not just matching text) and still
    // disabled — not a freshly repainted, re-enabled row that silently
    // discarded the in-flight state and left `deliverRulingReply`'s
    // restore()/setFeedback closures writing into a detached node (pre-fix:
    // the buttons would quietly re-enable here with no visible feedback at
    // all on a plain failure).
    await expect(row).toHaveAttribute('data-test-marker', 'original');
    await expect(buttons.first()).toBeDisabled();

    // Let the held comment (and the follow-up dispatch) complete. The reply
    // itself must still succeed cleanly — the row eventually clears once the
    // server-side answer stamp is reflected (same stale-while-revalidate
    // cache budget as the "pressing an option..." test above; the immediate
    // post-completion repaint(s) can legitimately still show the ruling as
    // unanswered and rebuild a fresh, blank row before the cache catches up
    // — a pre-existing SWR property, not part of this race). A failed reply
    // would instead leave the row durably present (or preserved with a
    // "Could not resume" error), so this is a real proof of success, not
    // just an absence check.
    await expect(page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-Q' })).toHaveCount(0, { timeout: 20000 });
  });
});

test.describe('Ambient rulings nav badge (LIN-1728 Phase 3)', () => {
  // The badge's poll (public/common.js's initRulingsBadge/updateRulingsBadge)
  // is loaded on EVERY page that renders the badge markup, including
  // Observation (LIN-1728 review F7 — it used to live in public/app.js,
  // which Observation never loads, so the badge there was permanently dead:
  // no initial count, no live updates, and the two `window.updateRulingsBadge`
  // guards in the press handler could never fire). Exercised on the projects
  // page here; the Observation-specific coverage is below.
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

  test('LIN-1728 review F7: the badge actually initializes and updates on the Observation page itself', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ dispatch: true })}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-B7', issueTitle: 'F7 badge ruling', decisionId: 'd-rulings-badge-f7', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    // Before the fix this was permanently dead on Observation: no seeded
    // count on load (initRulingsBadge lived in app.js, which Observation
    // never loads) and the two `window.updateRulingsBadge` guards inside
    // deliverRulingReply could never resolve to a function.
    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toBeAttached();
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.rulings-count')).toHaveText('1');
    expect(await page.evaluate(() => typeof window.updateRulingsBadge)).toBe('function');
  });

  test('LIN-1728 review F6: the badge is a real link into the Rulings tab, not a button that does nothing', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ dispatch: true })}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-B6', issueTitle: 'F6 badge ruling', decisionId: 'd-rulings-badge-f6', blocked: true });

    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toHaveJSProperty('tagName', 'A');
    await expect(badge).toHaveAttribute('href', `/workspace/${URL_KEY}/observation?view=rulings`);

    await badge.click();
    await page.waitForURL(`**/workspace/${URL_KEY}/observation?view=rulings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.obs-tab[data-view="rulings"]')).toHaveClass(/is-active/);
    await expect(page.locator('#obs-rulings-section')).toBeVisible();
    await expect(page.locator('#obs-rulings .obs-ruling').filter({ hasText: 'LIN-1728-B6' })).toBeVisible();
  });
});

// LIN-2191 (open question from the LIN-1728 plan): a second badge in
// `.nav-primary-row`'s `.nav-actions` risks reproducing/worsening the
// pre-existing ≤320px header-clearance breach that ticket already tracks.
// Measured here, not assumed — see the test body for the verdict this feeds.
//
// LIN-1728 review (`2d47a7c8`, test-quality note) + re-review (`9c5b22f6`,
// G2): the original version of this test only counted distinct
// `.nav-primary-row > *` top positions. Both badges live inside
// `.nav-actions`, a SINGLE direct child of `.nav-primary-row`, so that metric
// can see `.nav-actions` as a whole wrapping onto row 2 of the two-row header
// (`.nav-primary-row` is `flex-wrap: wrap`, public/style.css) but is blind to
// growth/overflow happening INSIDE `.nav-actions` itself — the actual risk a
// second badge adds, since `.nav-actions` is `display:flex` with NO
// `flex-wrap` set anywhere, so its own children can only overflow, never
// wrap onto their own line. The two failure modes are independent, so this
// measures BOTH: the parent row's wrap count (restored) and `.nav-actions`'
// own internal child-row count plus horizontal overflow (`scrollWidth` vs
// `clientWidth`).
test.describe('.nav-actions width at ≤320px with both badges visible (LIN-2191 follow-up check)', () => {
  test('two visible badges do not add wrapping or overflow beyond the pre-existing zero-badge shape', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ dispatch: true })}`);
    await clearRuns(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const measure = () => {
      const primaryRow = document.querySelector('.nav-primary-row');
      const parentRows = primaryRow
        ? new Set(
            Array.from(primaryRow.children).map(el => Math.round(el.getBoundingClientRect().top))
          ).size
        : 0;
      const actions = document.querySelector('.nav-actions');
      if (!actions) return { parentRows, childRows: 0, overflowPx: 0 };
      const childRows = new Set(
        Array.from(actions.children).map(el => Math.round(el.getBoundingClientRect().top))
      ).size;
      const overflowPx = Math.max(0, actions.scrollWidth - actions.clientWidth);
      return { parentRows, childRows, overflowPx };
    };

    // Baseline: both badges hidden (0 queued, 0 rulings) — today's shipped
    // zero-badge shape (NOT a single-badge shape — both are hidden here).
    const baseline = await page.evaluate(measure);

    // Force both badges visible (as if there were 1 queued item and 1 ruling) —
    // the worst case this ticket's plan flags, without needing a real queued
    // dispatch item seeded too.
    await page.evaluate(() => {
      document.querySelectorAll('[data-queue-badge], [data-rulings-badge]').forEach(b => b.classList.remove('hidden'));
    });
    const bothVisible = await page.evaluate(measure);

    // Not a strict "must never overflow/wrap" assertion — LIN-2191 already
    // tracks whatever header-clearance breach exists at ≤320px independent
    // of any badge (captured in `baseline` itself, not this comparison).
    // This guards specifically against a SECOND badge making the header
    // WORSE than the zero-badge shape already shipped, on both independent
    // failure modes: `.nav-primary-row` wrapping onto a second header row,
    // and `.nav-actions` overflowing internally. A bare reproduction of the
    // pre-existing breach is recorded (not silently absorbed) by this test's
    // own existence rather than by failing it.
    expect(bothVisible.parentRows, `.nav-primary-row grew from ${baseline.parentRows} row(s) to ${bothVisible.parentRows} at 320px with both badges visible`).toBeLessThanOrEqual(baseline.parentRows);
    expect(bothVisible.childRows, `.nav-actions grew from ${baseline.childRows} internal row(s) to ${bothVisible.childRows} at 320px with both badges visible`).toBeLessThanOrEqual(baseline.childRows);
    expect(bothVisible.overflowPx, `.nav-actions overflow grew from ${baseline.overflowPx}px to ${bothVisible.overflowPx}px at 320px with both badges visible`).toBeLessThanOrEqual(baseline.overflowPx);
  });
});
