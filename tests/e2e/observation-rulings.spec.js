import { test, expect } from '../fixtures/test-base.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { featuresParam, SELECTORS } from '../helpers.js';

// LIN-1728 Phase 3/4 — the escalation surface: the ambient "waiting on you"
// nav badge and the filtered rulings tab + option-button primitive. Seeding
// mirrors tests/e2e/session-page.spec.js's seedSessionWithDecision (the live
// feed reconstructs sessions/loops from the dispatch stores, so a decision is
// posted through the real consumer take+feedback flow) — extended here with
// `options`/`recommended` so the option-button row actually has buttons to
// press, which session-page.spec.js's own decision fixture never needed.

let URL_KEY;
let OBSERVATION_URL;

test.beforeEach(async ({ page, workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  // LIN-3198: drop the in-process comment-dedupe caches. The F1 cross-workspace
  // ruling re-posts the same "Approve" body to the same (workspace, issue) every
  // run; the 5-min server-side dedupe window would otherwise collapse the second
  // run's fresh 201 into a deduped 200, making the exact-201 assertion retry-fatal.
  // Global clear (the dedupe key is hashed, so it can't be urlKey-scoped).
  await page.request.get('/test/clear-comment-dedupe');
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

// LIN-2991/LIN-3022 D3: seeds a GENUINE two-loop lineage through the real
// dispatch API — a root loop, then a child dispatched with `followUpTo:
// rootId` (the exact reply-box wire shape; no `sessionId`), which
// dispatch-factory.js's followUpTo-inheritance seam turns into a shared
// `rootItemId` (see lib/dispatch-store.js's `doc.rootItemId = item.rootItemId
// || doc._id`), never a hand-built fixture. The root carries no decision of
// its own; only the child raises one — so `collectUnansweredDecisions`
// anchors the row on the root (found by lineageId) while the CONTENT loop
// (and hence `stampLoopId`) is the child, giving the resumable path two
// genuinely different values to thread through instead of one that happens
// to look right.
async function seedGroupedDecisionWorker(page, { issueIdentifier, issueTitle, decisionId, urlKey = URL_KEY }) {
  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const rootResp = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(rootResp.status(), `root seed failed: ${await rootResp.text()}`).toBe(201);
  const rootId = (await rootResp.json()).item.id;
  const rootTake = await page.request.post(`/api/dispatch/take/${rootId}`, { headers: auth });
  expect(rootTake.status(), `root take failed: ${await rootTake.text()}`).toBe(200);
  const rootFeedback = await page.request.post(`/api/dispatch/feedback/${rootId}`, {
    headers: auth, data: { message: '[working] dispatched a wake follow-up' }
  });
  expect(rootFeedback.status()).toBe(200);

  const childResp = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'continue', followUpTo: rootId, issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(childResp.status(), `child seed failed: ${await childResp.text()}`).toBe(201);
  const childId = (await childResp.json()).item.id;
  const childTake = await page.request.post(`/api/dispatch/take/${childId}`, { headers: auth });
  expect(childTake.status(), `child take failed: ${await childTake.text()}`).toBe(200);

  const blockedResp = await page.request.post(`/api/dispatch/feedback/${childId}`, {
    headers: auth, data: { message: '[blocked] need a ruling before continuing' }
  });
  expect(blockedResp.status()).toBe(200);

  const decision = await page.request.post(`/api/dispatch/feedback/${childId}`, {
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
  return { rootId, childId };
}

async function clearRunsFor(page, urlKey) {
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-agent-status?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-observation-sessions?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
}

test.describe('Rulings tab (LIN-1728 Phase 4)', () => {
  test('the Rulings tab renders alongside Runs (LIN-3983)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    const tabs = page.locator('[data-testid^="obs-tab-"]');
    await expect(tabs).toHaveCount(2);
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).toBeVisible();
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).not.toHaveClass(/is-active/);
  });

  test('a resumable ruling renders with pressable option buttons; the session views hide while active', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-R', issueTitle: 'Resumable ruling', decisionId: 'd-rulings-1', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).toHaveClass(/is-active/);

    // The session-views shell (Filter/Active/Archive) hides while the rulings
    // tab is active — a ruling is not a session, and the two must not bleed.
    await expect(page.locator(SELECTORS.observation.sessionViews)).toBeHidden();
    await expect(page.locator(SELECTORS.observation.rulingsSection)).toBeVisible();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-R' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Proceed with option A?');
    // LIN-2775 Area 5: captions are effect-first — a resumable row's
    // resolved effect is unconditionally 'resume' (resolveEffect branch 1),
    // so this now reads "Answer & resume", not the old disposition caption
    // "Reply & continue". A real, intended behaviour change, not a loosened
    // assertion.
    await expect(row.locator('.chat-options-caption')).toHaveText('Answer & resume');
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
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-P' });
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

    // The comment write stamps `markDecisionAnswered` and (LIN-2755)
    // invalidates the sessionsFeedCache before responding, so the very next
    // poll already reconstructs — the row should disappear quickly. The
    // generous timeout stays as headroom for the poll interval + a render
    // pass, not because staleness is expected: this same-tab disappearance
    // is also covered by `rulingsSettled`'s client-side masking regardless
    // (LIN-2444), so this assertion alone does not prove server-side
    // invalidation — see the LIN-2755 round-trip test below for that.
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-P' })).toHaveCount(0, { timeout: 20000 });
  });

  // LIN-2991/LIN-3022 D3: a genuinely grouped decision — raised on a non-root
  // (child) loop of a real followUpTo lineage — must stamp the CONTENT loop
  // (child) while the follow-up dispatch still resumes the ANCHOR (root).
  // Mutation: reverting observation.js's decisionLoopId back to `anchor?.loopId`
  // makes the comment assertion below fail (root !== child).
  test('D3: a grouped decision stamps the content loop while the follow-up dispatch resumes the anchor', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { rootId, childId } = await seedGroupedDecisionWorker(page, {
      issueIdentifier: 'LIN-1728-D3', issueTitle: 'Grouped ruling', decisionId: 'd-rulings-grouped'
    });
    expect(rootId).not.toBe(childId);

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-D3' });
    await expect(row).toBeVisible();

    const [commentReq, dispatchReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      row.locator('.chat-option-btn').filter({ hasText: 'Approve' }).click()
    ]);
    const commentPayload = commentReq.postDataJSON();
    expect(commentPayload.decisionLoopId, 'the STAMP target must be the content (child) loop').toBe(childId);
    expect(commentPayload.decisionId).toBe('d-rulings-grouped');
    expect((await commentReq.response()).status()).toBe(201);

    const dispatchPayload = dispatchReq.postDataJSON();
    expect(dispatchPayload.followUpTo, 'the RESUME target must be the anchor (root) loop, never the stamp target').toBe(rootId);
    expect((await dispatchReq.response()).status()).toBe(201);

    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-D3' })).toHaveCount(0, { timeout: 20000 });
  });

  // LIN-2209 (F1/L1): the test above proves the UI-driven flow works, but no
  // single test connects a real stamp write to a real /rulings READ — every
  // link (attribute emitted, threaded into the POST body, route calls the
  // store, store persists, answeredDecisionId derives, predicate excludes) is
  // covered individually elsewhere. This is the composition witness, driven
  // directly against the API (no UI, so `rulingsSettled`'s client-side
  // same-tab masking — public/observation.js — is structurally out of the
  // loop; nothing here ever renders the page) so it isolates the round trip
  // itself.
  //
  // LIN-2755 (beat 4): before that fix, the comment route's best-effort stamp
  // never invalidated sessionsFeedCache, so a read landing inside the 5s TTL
  // window served the stale pre-answer value, and even the FIRST read past
  // the TTL still served it once more (SWR: a stale read returns the last
  // good value immediately and only KICKS a background refresh) — a second
  // post-TTL read was required to observe the change. That two-read,
  // TTL-gated shape is what this test used to assert (see git history) —
  // it was pinning the bug's own symptom as expected behavior. Now that the
  // stamp calls `sessionsFeedCache.clear(urlKey)` on success
  // (routes/workspace-api-issue-write.js's `stampDecisionAnswers`), the very NEXT read —
  // taken immediately, well inside the old 5s TTL window, with no wait at
  // all — already reconstructs and excludes the answered row. Asserting that
  // with zero wait is what makes this a genuine witness of server-side cache
  // invalidation rather than of the TTL eventually expiring on its own: an
  // unfixed build would still read `count: 1` here, because nothing would
  // have dropped the cache entry and under 5s has not elapsed.
  test('LIN-2755/LIN-2209: the answer-a-ruling round trip invalidates the cache immediately — GET /rulings count 1 -> save -> count 0 on the very next read, no TTL wait', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-2209-RT', issueTitle: 'Round-trip ruling', decisionId: 'd-rulings-roundtrip', blocked: true });

    const before = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.count).toBe(1);
    expect(beforeBody.rulings[0].decision.decision_id).toBe('d-rulings-roundtrip');

    const commentResp = await page.request.post(`/workspace/${URL_KEY}/api/comments/LIN-2209-RT`, {
      data: { body: 'proceeding', decisionLoopId: workerId, decisionId: 'd-rulings-roundtrip' }
    });
    expect(commentResp.status()).toBe(201);

    // No `waitForTimeout` at all — the write is expected to have already
    // invalidated the cache by the time this response is in hand, so the
    // very next poll must reconstruct, well before the 5s TTL would have
    // expired it on its own.
    const afterRead = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    const afterBody = await afterRead.json();
    expect(afterBody.count, 'THE WITNESS: the very next poll — no TTL wait — already excludes the answered row').toBe(0);
  });

  // LIN-2755 (beat 4): the sibling witness for the OTHER loop-backed write
  // site — `POST .../rulings/dismiss` (routes/dashboard.js), the ticket's
  // own named Agree/dismiss flow. Same shape and same reasoning as the
  // round-trip test above: driven directly against the API (no UI, so
  // `rulingsSettled` never enters into it) and asserts the very next poll —
  // no TTL wait — already excludes the dismissed row.
  test('LIN-2755: the dismiss round trip invalidates the cache immediately — GET /rulings count 1 -> dismiss -> count 0 on the very next read, no TTL wait', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-2755-DT', issueTitle: 'Dismiss round-trip ruling', decisionId: 'd-rulings-dismiss-rt', blocked: true });

    const before = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.count).toBe(1);
    expect(beforeBody.rulings[0].decision.decision_id).toBe('d-rulings-dismiss-rt');

    const dismissResp = await page.request.post(`/workspace/${URL_KEY}/api/dashboard/rulings/dismiss`, {
      data: { decisionLoopId: workerId, decisionId: 'd-rulings-dismiss-rt' }
    });
    expect(dismissResp.status()).toBe(200);

    // No wait — see the round-trip test above for why zero wait is what
    // makes this a witness of invalidation rather than of the TTL elapsing.
    const afterRead = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    const afterBody = await afterRead.json();
    expect(afterBody.count, 'THE WITNESS: the very next poll — no TTL wait — already excludes the dismissed row').toBe(0);
  });

  test('partial failure (comment recorded, resume delivery fails) surfaces a Retry delivery affordance, which re-fires only the dispatch call', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-1728-F', issueTitle: 'Partial-failure ruling', decisionId: 'd-rulings-4', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-F' });
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

    const feedback = row.locator(SELECTORS.observation.ruling.feedback);
    await expect(feedback).toContainText('Recorded');
    await expect(feedback).toContainText('Could not resume');
    const retryBtn = row.locator(SELECTORS.observation.ruling.retryDelivery);
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
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-M' });
    await expect(row).toBeVisible();
    await expect(row.locator('.chat-options-caption')).toHaveText('still running — reply disabled');
    await expect(row.locator('.chat-option-btn')).toHaveCount(0);

    let dispatchFired = false;
    page.on('request', (r) => { if (r.url().includes('/api/dispatch') && r.method() === 'POST') dispatchFired = true; });
    await page.waitForTimeout(300);
    expect(dispatchFired).toBe(false);
  });

  test('LIN-2225: free-text answer on a resumable ruling reuses the option-press comment/dispatch path', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-2225-T', issueTitle: 'Free-text ruling', decisionId: 'd-rulings-freetext', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-T' });
    await expect(row).toBeVisible();

    // The declared options stay present and untouched (LIN-2225's scoping
    // guard) — free text is additive, not a replacement.
    await expect(row.locator('.chat-option-btn')).toHaveCount(2);

    await row.locator(SELECTORS.observation.ruling.answerInput).fill('why was I asked this?');
    const [commentReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      row.locator(SELECTORS.observation.ruling.answer).click()
    ]);
    const commentPayload = commentReq.postDataJSON();
    expect(commentPayload.body).toBe('why was I asked this?');
    expect(commentPayload.decisionLoopId).toBe(workerId);
    expect(commentPayload.decisionId).toBe('d-rulings-freetext');
    expect((await commentReq.response()).status()).toBe(201);

    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-T' })).toHaveCount(0, { timeout: 20000 });
  });

  test('LIN-2225: dismiss on a resumable ruling stamps outcome:dismissed with no comment, and the row clears', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId } = await seedDecisionWorker(page, { issueIdentifier: 'LIN-2225-D', issueTitle: 'Dismiss ruling', decisionId: 'd-rulings-dismiss', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-D' });
    await expect(row).toBeVisible();

    let commentFired = false;
    page.on('request', (r) => { if (r.url().includes('/api/comments/') && r.method() === 'POST') commentFired = true; });

    const [dismissReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dashboard/rulings/dismiss') && r.method() === 'POST'),
      row.locator(SELECTORS.observation.ruling.dismiss).click()
    ]);
    const dismissPayload = dismissReq.postDataJSON();
    expect(dismissPayload.decisionLoopId).toBe(workerId);
    expect(dismissPayload.decisionId).toBe('d-rulings-dismiss');
    expect((await dismissReq.response()).status()).toBe(200);
    expect(commentFired).toBe(false);

    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-D' })).toHaveCount(0, { timeout: 20000 });
  });

  test('LIN-2225: a mid-turn ruling has no free-text composer but IS dismissable', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2225-M', issueTitle: 'Mid-turn dismiss', decisionId: 'd-rulings-midturn-dismiss', blocked: false });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-M' });
    await expect(row).toBeVisible();
    await expect(row.locator(SELECTORS.observation.ruling.answerInput)).toHaveCount(0);
    await expect(row.locator(SELECTORS.observation.ruling.dismiss)).toBeVisible();

    const [dismissReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dashboard/rulings/dismiss') && r.method() === 'POST'),
      row.locator(SELECTORS.observation.ruling.dismiss).click()
    ]);
    expect((await dismissReq.response()).status()).toBe(200);
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2225-M' })).toHaveCount(0, { timeout: 20000 });
  });

  test('LIN-1728 review F1: a ruling from a non-page workspace writes its comment/stamp/dispatch in the RULING\'s own workspace, and clears', async ({ page, secondWorkerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&multiWorkspace=true`);
    // LIN-3383: both seeds and the ruling's dispatch enqueue on a runner target
    // (owner-only); the session must own both workspaces.
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    await seedWorkspaceOwnership(page, secondWorkerUrlKey, 'owner');
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
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-X' });
    await expect(row).toBeVisible();
    // The workspace's name, since two workspaces are showing; the raw key is never shown (LIN-3983 PR 2).
    await expect(row.locator(SELECTORS.observation.ruling.ws)).toBeVisible();
    await expect(row).not.toContainText(secondWorkerUrlKey);

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
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-X' })).toHaveCount(0, { timeout: 20000 });
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
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-Q' });
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
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-Q' })).toHaveCount(0, { timeout: 20000 });
  });

  test('LIN-3631: a background poll landing while the operator types keeps the text, the box and its focus', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-3631-T', issueTitle: 'Typing ruling', decisionId: 'd-rulings-typing', blocked: true });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-3631-T' });
    const box = row.locator(SELECTORS.observation.ruling.answerInput);
    await expect(box).toBeVisible();
    // Identity, not just text: a rebuilt row with the text copied back would
    // still have dropped the focus and any keystrokes typed mid-repaint.
    await box.evaluate((el) => { el.dataset.testMarker = 'original'; });

    await box.click();
    await page.keyboard.type('half typed');
    // Wait for a real background poll (POLL_MS = 5s) to land and repaint.
    await page.waitForResponse(r => r.url().includes('/api/dashboard/rulings') && r.request().method() === 'GET', { timeout: 7000 });
    await page.waitForTimeout(200);
    // Keep typing with no re-click: the keys go to whatever holds focus.
    await page.keyboard.type(' and more');

    await expect(box).toHaveAttribute('data-test-marker', 'original');
    await expect(box).toHaveValue('half typed and more');
    await expect(box).toBeFocused();
  });
});

// LIN-2444 review F4 — no e2e coverage existed anywhere for the suggested-
// dismissal UI: the in-page bulk question, a real <input type="checkbox">
// selection, the bulk bar's real `hidden`, or `selectAll.indeterminate`.
// Seeds a real standing suggestion via the actual proxy suggest-dismissal
// route (the same one an agent uses in production), never a fabricated
// client-side `suggestedDismissal` field.
async function suggestDismissal(page, decisionId, { urlKey = URL_KEY, reason = 'shipped separately' } = {}) {
  const tokenResp = await page.request.get(`/test/create-proxy-token?scope=readWrite&label=suggest&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const resp = await page.request.post(`/api/proxy/rulings/${decisionId}/suggest-dismissal`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { reason }
  });
  expect(resp.status(), `suggest-dismissal failed: ${await resp.text()}`).toBe(201);
}

test.describe('Bulk-agree suggested rulings (LIN-2444 Phase 5) — e2e', () => {
  test.beforeEach(async ({ page }) => {
    await clearRuns(page);
    await page.goto(`/test/clear-dismissal-suggestions?urlKey=${URL_KEY}`);
  });

  test('a suggested row renders the banner + a real checkbox, and selecting rows drives the bulk bar\'s real hidden/count/indeterminate state', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2444-BULK-1', issueTitle: 'Bulk suggested A', decisionId: 'd-bulk-a', blocked: true });
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2444-BULK-2', issueTitle: 'Bulk suggested B', decisionId: 'd-bulk-b', blocked: true });
    await suggestDismissal(page, 'd-bulk-a');
    await suggestDismissal(page, 'd-bulk-b');

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const rowA = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-1' });
    const rowB = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-2' });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA).toContainText('proposed dismissal');

    const bar = page.locator(SELECTORS.observation.ruling.bulkBar);
    await expect(bar).toBeVisible();
    const selectAll = page.locator(SELECTORS.observation.ruling.selectAll);
    const count = page.locator(SELECTORS.observation.ruling.selectedCount);
    const agreeSelected = page.locator(SELECTORS.observation.ruling.bulkApply);
    await expect(count).toHaveText('0 selected');
    await expect(agreeSelected).toBeDisabled();

    const checkboxA = rowA.locator(SELECTORS.observation.ruling.select);
    await expect(checkboxA).toBeVisible();
    await checkboxA.check();

    await expect(count).toHaveText('1 selected');
    await expect(agreeSelected).toBeEnabled();
    await expect(agreeSelected).toHaveText('Apply 1 as proposed');
    // A real DOM tri-state: one of two selectable rows selected.
    expect(await selectAll.evaluate((el) => el.indeterminate)).toBe(true);
    expect(await selectAll.evaluate((el) => el.checked)).toBe(false);

    await rowB.locator(SELECTORS.observation.ruling.select).check();
    await expect(count).toHaveText('2 selected');
    await expect(selectAll).toBeChecked();
    expect(await selectAll.evaluate((el) => el.indeterminate)).toBe(false);

    await checkboxA.uncheck();
    await expect(count).toHaveText('1 selected');
    expect(await selectAll.evaluate((el) => el.indeterminate)).toBe(true);
  });

  test('cancelling the native confirm() sends no dismiss request and leaves the row(s) selected and unanswered', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2444-BULK-3', issueTitle: 'Bulk cancel', decisionId: 'd-bulk-cancel', blocked: true });
    await suggestDismissal(page, 'd-bulk-cancel');

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-3' });
    await row.locator(SELECTORS.observation.ruling.select).check();

    let dismissRequested = false;
    await page.route('**/api/dashboard/rulings/dismiss', async (route) => { dismissRequested = true; return route.continue(); });
    await page.locator(SELECTORS.observation.ruling.bulkApply).click();
    // The question is asked on the page (LIN-3983 PR 2), not in a native dialog.
    const ask = page.locator(SELECTORS.observation.bulkConfirm.panel);
    await expect(ask).toBeVisible();
    await expect(page.locator(SELECTORS.observation.bulkConfirm.text)).toContainText('Apply 1 selected proposal');
    await expect(page.locator(SELECTORS.observation.bulkConfirm.text)).toContainText('cannot be undone');
    await page.locator(SELECTORS.observation.bulkConfirm.no).click();
    await expect(ask).toBeHidden();
    await page.waitForTimeout(200);

    expect(dismissRequested, 'cancelling the in-page question must send no dismiss request').toBe(false);
    // Still there, still selected, still checked — nothing was silently discarded.
    await expect(row).toBeVisible();
    await expect(row.locator(SELECTORS.observation.ruling.select)).toBeChecked();
    await expect(page.locator(SELECTORS.observation.ruling.selectedCount)).toHaveText('1 selected');
  });

  test('accepting the native confirm() agrees every selected row for real: both settle immediately, and the feed eventually clears', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2444-BULK-4', issueTitle: 'Bulk accept A', decisionId: 'd-bulk-accept-a', blocked: true });
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2444-BULK-5', issueTitle: 'Bulk accept B', decisionId: 'd-bulk-accept-b', blocked: true });
    await suggestDismissal(page, 'd-bulk-accept-a');
    await suggestDismissal(page, 'd-bulk-accept-b');

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const rowA = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-4' });
    const rowB = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-5' });
    await page.locator(SELECTORS.observation.ruling.selectAll).check();
    await expect(page.locator(SELECTORS.observation.ruling.selectedCount)).toHaveText('2 selected');

    await page.locator(SELECTORS.observation.ruling.bulkApply).click();
    await page.locator(SELECTORS.observation.bulkConfirm.yes).click();

    // Both rows settle at the moment of success — no wait for a poll: controls
    // disabled, feedback recorded, selection emptied, bar hidden.
    await expect(rowA.locator(SELECTORS.observation.ruling.feedback)).toHaveText('dismissed as proposed');
    await expect(rowB.locator(SELECTORS.observation.ruling.feedback)).toHaveText('dismissed as proposed');
    await expect(rowA.locator(SELECTORS.observation.ruling.select)).toBeDisabled();
    await expect(page.locator(SELECTORS.observation.ruling.bulkBar)).toBeHidden();
    await expect(page.locator(SELECTORS.observation.ruling.selectedCount)).toHaveText('0 selected');

    // Genuinely dismissed server-side, not just locally settled — same
    // sessionsFeedCache SWR TTL budget as the existing option-press test above.
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-4' })).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2444-BULK-5' })).toHaveCount(0, { timeout: 20000 });
  });

  // LIN-2756 close-out (review ledger item 4): the ticket's own bug, at
  // browser level. Every other LIN-2756 test is `node --test` against the
  // module; this is the only one that renders two loops sharing ONE
  // `decision_id` through the real feed and presses a real select-all. Before
  // the fix both rows collapsed onto `${urlKey}::${decisionId}`, so the row
  // map kept only the last <li>, select-all counted 1, and bulk agree stamped
  // exactly one loop — the live repro in the ticket's Finding.
  //
  // The suggestion is deliberately seeded in the LEGACY, workspace-wide shape
  // (no `decisionLoopId`), which is both what a pre-LIN-2756 agent wrote and
  // what an un-updated one still writes: it must fan out to BOTH loop rows,
  // so both are selectable and both agree.
  test('two loops sharing one decision_id render two rows: select-all counts 2 and bulk agree dismisses both (LIN-2756)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    const SHARED = 'lin2384-f6-gate';
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2756-LOOP-A', issueTitle: 'Review loop', decisionId: SHARED, blocked: true });
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2756-LOOP-B', issueTitle: 'Close-out loop', decisionId: SHARED, blocked: true });
    await suggestDismissal(page, SHARED);

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const rowA = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2756-LOOP-A' });
    const rowB = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2756-LOOP-B' });

    // Acceptance limb 1: two rows, two keys — not one surviving <li>.
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);
    // The legacy workspace-wide suggestion reaches both, so both are selectable.
    await expect(rowA.locator(SELECTORS.observation.ruling.select)).toBeVisible();
    await expect(rowB.locator(SELECTORS.observation.ruling.select)).toBeVisible();

    // Acceptance limb 2: select-all counts BOTH.
    await page.locator(SELECTORS.observation.ruling.selectAll).check();
    await expect(page.locator(SELECTORS.observation.ruling.selectedCount)).toHaveText('2 selected');

    // Acceptance limb 3: bulk agree dismisses BOTH, not just the last one.
    await page.locator(SELECTORS.observation.ruling.bulkApply).click();
    await page.locator(SELECTORS.observation.bulkConfirm.yes).click();
    await expect(rowA.locator(SELECTORS.observation.ruling.feedback)).toHaveText('dismissed as proposed');
    await expect(rowB.locator(SELECTORS.observation.ruling.feedback)).toHaveText('dismissed as proposed');

    // Genuinely dismissed server-side — the pre-fix failure was precisely a
    // row that LOOKED handled and came back on the next poll still unanswered.
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2756-LOOP-A' })).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2756-LOOP-B' })).toHaveCount(0, { timeout: 20000 });
  });
});

// LIN-2758 — the batch-progress/Stop/completion-summary mechanism end to
// end, over 3 seeded suggested rows (per Acceptance).
//
// Beat 3 correction: the plan's own D4 suggestion (a fixed artificial delay
// via page.route, e.g. 300ms) turned out to be a genuine flakiness trap, not
// just a slow-batch nicety — it races real wall-clock overhead (locator
// resolution, IPC round-trips between test and browser) against a FIXED
// per-row delay. At 300ms the intermediate "Applying 2 of 3…" state was
// observed to be skipped entirely by Playwright's own polling; at 1200ms the
// Stop test still occasionally let every row complete before the click
// landed, because there is no guarantee about WHICH row is in flight when a
// human-speed `stopBtn.click()` actually fires. Tuning the delay upward is
// not a fix, only a smaller chance of the same race.
//
// Fixed by GATING each row's write behind an explicitly-released promise
// instead of a fixed timer: `installGatedDismissRoute` intercepts the
// per-row dismiss endpoint and holds each request open until the test calls
// `release()` — turning "assert progress, then let this specific row
// finish" into a fully deterministic step with no wall-clock race at all.
function installGatedDismissRoute(page) {
  let releaseCurrent;
  let currentGate = new Promise((resolve) => { releaseCurrent = resolve; });
  page.route('**/api/dashboard/rulings/dismiss', async (route) => {
    await currentGate;
    await route.continue();
  });
  return {
    release() {
      releaseCurrent();
      currentGate = new Promise((resolve) => { releaseCurrent = resolve; });
    }
  };
}

test.describe('Bulk-agree progress / Stop / completion summary (LIN-2758) — e2e', () => {
  test.beforeEach(async ({ page }) => {
    await clearRuns(page);
    await page.goto(`/test/clear-dismissal-suggestions?urlKey=${URL_KEY}`);
  });

  async function seedThreeSuggestedRows(page) {
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2758-1', issueTitle: 'Progress row A', decisionId: 'd-2758-a', blocked: true });
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2758-2', issueTitle: 'Progress row B', decisionId: 'd-2758-b', blocked: true });
    await seedDecisionWorker(page, { issueIdentifier: 'LIN-2758-3', issueTitle: 'Progress row C', decisionId: 'd-2758-c', blocked: true });
    await suggestDismissal(page, 'd-2758-a');
    await suggestDismissal(page, 'd-2758-b');
    await suggestDismissal(page, 'd-2758-c');
  }

  test('a full 3-row run shows mid-batch progress and ends with the all-applied summary; the bar re-enables', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await seedThreeSuggestedRows(page);
    const { release } = installGatedDismissRoute(page);

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    await page.locator(SELECTORS.observation.ruling.selectAll).check();
    await expect(page.locator(SELECTORS.observation.ruling.selectedCount)).toHaveText('3 selected');

    await page.locator(SELECTORS.observation.ruling.bulkApply).click();
    await page.locator(SELECTORS.observation.bulkConfirm.yes).click();

    const progress = page.locator(SELECTORS.observation.ruling.bulkProgress);
    await expect(progress).toHaveText('Applying 1 of 3…');
    release();
    await expect(progress).toHaveText('Applying 2 of 3…');
    release();
    await expect(progress).toHaveText('Applying 3 of 3…');
    release();

    await expect(progress).toHaveText('3 applied.');
    await expect(page.locator(SELECTORS.observation.ruling.bulkBar)).toBeHidden();
    await expect(page.locator(SELECTORS.observation.ruling.selectAll)).toBeEnabled();
    // agreeBtn is deliberately NOT asserted enabled here: a full successful
    // run empties rulingsSelected (every row succeeded), and the button's
    // own pre-existing, unrelated rule (`disabled: selectedCount === 0`)
    // correctly keeps it disabled — nothing to do with the run-state flag.
    // That rule is exercised by the Stop test below instead, where a
    // genuinely non-empty selection survives the run.
  });

  test('pressing Stop mid-batch halts the run: the remaining rows stay checked/selected, and the summary reads stopped-early', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await seedThreeSuggestedRows(page);
    const { release } = installGatedDismissRoute(page);

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    await page.locator(SELECTORS.observation.ruling.selectAll).check();

    await page.locator(SELECTORS.observation.ruling.bulkApply).click();
    await page.locator(SELECTORS.observation.bulkConfirm.yes).click();

    // Row 1's own write is held open by the gate — deterministically "in
    // flight" for as long as the test needs to press Stop, no race.
    const progress = page.locator(SELECTORS.observation.ruling.bulkProgress);
    await expect(progress).toHaveText('Applying 1 of 3…');

    const stopBtn = page.locator(SELECTORS.observation.ruling.bulkStop);
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();
    // Row 1 is already in flight (no AbortController) — it is never
    // aborted, only let to finish; releasing it now lets the loop reach its
    // next-iteration check, which sees Stop and breaks before row 2.
    release();

    await expect(progress).toHaveText('Stopped after 1 of 3 — 2 remain selected.');

    // The two rows Stop pre-empted are still visible, still checked, still
    // selected — never silently dropped. Deliberately COUNT-based, not
    // identity-based (e.g. "row B and row C"): `rulingsSelected` is a Set
    // iterated via `Array.from`, and its iteration order is insertion order
    // into that Set — driven by `setAllRulingsSelected`'s own walk of
    // `rulingsSelectableKeys()`/the feed's render order, NOT this test's
    // seed order. Measured directly: with these three rows, the row that
    // actually processes first is LIN-2758-3 (seeded LAST), not -1 — so an
    // assertion naming specific surviving rows would be pinning an
    // accidental ordering detail, not the behavior under test.
    await expect(page.locator(`${SELECTORS.observation.ruling.select}:checked`)).toHaveCount(2);
    await expect(page.locator(`${SELECTORS.observation.ruling.select}:disabled`)).toHaveCount(1);

    await expect(page.locator(SELECTORS.observation.ruling.selectAll)).toBeEnabled();
    await expect(page.locator(SELECTORS.observation.ruling.bulkApply)).toBeEnabled();
    await expect(stopBtn).toBeHidden();
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
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
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

  test('absent when the workspace has no way to run (LIN-3849)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=0`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-rulings-badge]')).toHaveCount(0);
  });

  test('LIN-1728 review F7: the badge actually initializes and updates on the Observation page itself', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
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
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
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
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).toHaveClass(/is-active/);
    await expect(page.locator(SELECTORS.observation.rulingsSection)).toBeVisible();
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-1728-B6' })).toBeVisible();
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
//
// LIN-1728 close-out (review `5ac8e83f`, H1): the three metrics above are all
// pinned by CSS structure and cannot move, so none of them is the guard —
// keep them for the shape they document, but do not read them as coverage.
// `parentRows` is already at its structural maximum of 2 at 320px (the row has
// three children, the wordmark, `.nav-filters` and `.nav-actions`, over two lines: LIN-4009);
// `.nav-actions` sets no width and no `overflow-x` (`public/style.css:616-620`),
// so `scrollWidth === clientWidth` by construction and `overflowPx` is always
// exactly 0; and `align-items: baseline` puts the `<a>` badge ~2px above the
// `<button>` badges, so `childRows` reads 2 in every state — rounding noise
// compared against rounding noise. The review injected `min-width: 900px` on
// the rulings badge and all three numbers were unchanged (2 / 2 / 0) while the
// page itself blew out from 320px to 1029px.
//
// `document.body.scrollWidth` is the metric that actually moves, so THAT is the
// assertion carrying this test: a second badge must not widen the page beyond
// the zero-badge baseline. The `pageWidth` case below is the one a regression
// fails on; the other three are descriptive.
test.describe('.nav-actions width at ≤320px with both badges visible (LIN-2191 follow-up check)', () => {
  test('two visible badges do not add wrapping or overflow beyond the pre-existing zero-badge shape', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
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
      if (!actions) return { parentRows, childRows: 0, overflowPx: 0, pageWidth: document.body.scrollWidth };
      const childRows = new Set(
        Array.from(actions.children).map(el => Math.round(el.getBoundingClientRect().top))
      ).size;
      const overflowPx = Math.max(0, actions.scrollWidth - actions.clientWidth);
      // The load-bearing metric (H1): unlike the three above, this one moves
      // when a badge grows past what the viewport can hold.
      const pageWidth = document.body.scrollWidth;
      return { parentRows, childRows, overflowPx, pageWidth };
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
    // The assertion that can actually fail (H1). `.nav-actions` grows 38px →
    // 218px inside the 320px viewport when both badges appear, and the page
    // width must stay put; a badge wide enough to push the document past the
    // viewport fails here and nowhere else.
    expect(bothVisible.pageWidth, `the page grew from ${baseline.pageWidth}px to ${bothVisible.pageWidth}px at a 320px viewport with both badges visible`).toBeLessThanOrEqual(baseline.pageWidth);
  });
});

// ─── LIN-2754 close-out, ledger L3 — the E2E witness Plan Step 11 names ───
// Every witness for the Agree-as-answer path shipped as a unit test against a
// DOM shim. That proves the branch logic; it does not prove an operator can
// press Agree in a real browser and have the ruling come back ANSWERED.
// This is that press: a real proposal written through the real
// `suggest-answer` proxy route (never a fabricated client-side field), a real
// click, and a read-back of the durable stamp from storage — which is the
// only place "answered, not dismissed" is actually distinguishable.
async function suggestAnswer(page, decisionId, { optionId = 'a', urlKey = URL_KEY, reason = 'John ruled this in the relay' } = {}) {
  const tokenResp = await page.request.get(`/test/create-proxy-token?scope=readWrite&label=suggest&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const resp = await page.request.post(`/api/proxy/rulings/${decisionId}/suggest-answer`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { optionId, reason }
  });
  expect(resp.status(), `suggest-answer failed: ${await resp.text()}`).toBe(201);
}

test.describe('Agree on a PROPOSED ANSWER (LIN-2754 L3) — e2e', () => {
  test.beforeEach(async ({ page }) => {
    await clearRuns(page);
    await page.goto(`/test/clear-dismissal-suggestions?urlKey=${URL_KEY}`);
  });

  test('a real Agree press answers the ruling with the proposed option — the durable stamp carries option_id and is NOT a dismissal', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    const { workerId } = await seedDecisionWorker(page, {
      issueIdentifier: 'LIN-2754-ANSWER', issueTitle: 'Relayed ruling', decisionId: 'd-2754-answer', blocked: true
    });
    await suggestAnswer(page, 'd-2754-answer', { optionId: 'a' });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.tab('rulings')).click();

    const row = page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2754-ANSWER' });
    await expect(row).toBeVisible();
    // The banner must name the PROPOSED ANSWER and its option's own label —
    // the pre-LIN-2792 UI had no such branch and read "proposed dismissal"
    // for this exact row.
    await expect(row).toContainText('proposed answer: Approve');

    // Held as an ElementHandle, deliberately, BEFORE the click: once the
    // answer lands server-side the ruling leaves the /rulings payload and a
    // background poll removes the row, so a locator-based assertion on the
    // settle text races that removal (it did, in CI, while passing locally).
    // A handle keeps reading the node `deliverRulingReply` actually wrote
    // its feedback into, attached or not — the settle text is written
    // synchronously on delivery, before any repaint can intervene.
    const feedbackHandle = await row.locator(SELECTORS.observation.ruling.feedback).elementHandle();

    await row.locator(SELECTORS.observation.ruling.agree).click();

    // Delivered, not dismissed: the answer branch's own feedback text.
    await expect.poll(async () => feedbackHandle.textContent(), { timeout: 15000 }).toBe('recorded ✓');

    // The proof that matters, read back from storage rather than from the
    // page: ONE `decision-answer` stamp, carrying the chosen `option_id`,
    // with no `outcome: 'dismissed'` anywhere on it.
    let stamps = [];
    await expect.poll(async () => {
      const itemResp = await page.request.get(`/test/dispatch-item?urlKey=${URL_KEY}&itemId=${workerId}`);
      const { feedback } = await itemResp.json();
      stamps = feedback.filter((f) => f.kind === 'decision-answer').map((f) => JSON.parse(f.message));
      return stamps.length;
    }, { message: 'expected exactly one decision-answer stamp in storage', timeout: 15000 }).toBe(1);
    expect(stamps[0].decision_id).toBe('d-2754-answer');
    expect(stamps[0].option_id, 'the chosen option must reach the durable stamp — Shape B').toBe('a');
    expect(stamps[0].outcome, 'an agreed ANSWER must never be stamped as a dismissal').toBeUndefined();

    // And it genuinely clears the operator's inbox — the same SWR cache
    // budget every other clearing assertion in this file uses.
    await expect(page.locator(SELECTORS.observation.ruling.row).filter({ hasText: 'LIN-2754-ANSWER' })).toHaveCount(0, { timeout: 20000 });
  });
});

// LIN-4009: on a phone the wordmark stays, and it leads the first line beside the actions, with the filters
// on a line of their own. The worst case for that line is both badges visible, so this asserts the wordmark
// and `.nav-actions` overlap vertically at every phone width the LIN-2191 guard covers and above.
test.describe('Phone header: the wordmark shares the first line with the actions (LIN-4009)', () => {
  test('both badges visible at 320-480px: the wordmark is visible and on the actions line', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    for (const width of [320, 360, 390, 412, 430, 480]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${URL_KEY}/`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => {
        document.querySelectorAll('[data-queue-badge], [data-rulings-badge]').forEach(b => b.classList.remove('hidden'));
      });
      const { visible, sameLine } = await page.evaluate(() => {
        const wordmark = document.querySelector('.nav-bar .wordmark').getBoundingClientRect();
        const actions = document.querySelector('.nav-actions').getBoundingClientRect();
        return {
          visible: wordmark.width > 0 && wordmark.height > 0,
          sameLine: wordmark.top < actions.bottom && actions.top < wordmark.bottom,
        };
      });
      expect(visible, `the wordmark must stay visible at ${width}px`).toBe(true);
      expect(sameLine, `the wordmark must share a line with .nav-actions at ${width}px`).toBe(true);
    }
  });
});
