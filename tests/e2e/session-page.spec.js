import { test, expect } from '../fixtures/test-base.js';

// LIN-1003 (Phase 1 of LIN-950): the dedicated per-session page
// (GET /workspace/:urlKey/observation/session/:sessionId) — the Observation
// in-feed drill-down promoted to a server-rendered page with its own URL.
//
// Seeding mirrors observation.spec.js: the live feed reconstructs sessions from
// the dispatch/agent-status stores (Mongo-only), so we seed an autopilot anchor
// + a worker stamped with the anchor id as sessionId (the LIN-591 spine), then
// drive the worker to a terminal outcome through the real consumer take+feedback
// flow so the run reconstructs WITH a `feedback[]` transcript. The sessionId is
// discovered from the sessions feed so the test never guesses the derived key.

let URL_KEY;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

// Seed an autopilot session with one worker driven to a terminal [done] outcome
// (which carries an evidence link in its feedback). Returns nothing — the caller
// discovers the sessionId from the feed.
async function seedSessionWithTranscript(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1003', issueTitle: 'Session-page seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1003', issueTitle: 'Session-page worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A feedback entry carrying an explicit url/urlLabel → a link-rich transcript
  // entry (the endpoint stores url/urlLabel on the entry; LIN-1003 renders them).
  const fb = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: 'opened the pull request', url: 'https://example.com/pr/42', urlLabel: 'PR #42' }
  });
  expect(fb.status(), `evidence feedback failed: ${await fb.text()}`).toBe(200);
  const done = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[done] landed the change' }
  });
  expect(done.status(), `done feedback failed: ${await done.text()}`).toBe(200);
}

// Seed an autopilot session with one worker left in a [blocked] state (paused on
// a human, never driven to [done]) — the LIN-1005 "waiting on user" case.
async function seedBlockedSession(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1005', issueTitle: 'Waiting seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1005', issueTitle: 'Waiting worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A [blocked] feedback marker with no subsequent [done]: the run stays a
  // pause/wait signal, so the session rolls up to a waiting-on-user state.
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[blocked] need your decision on the auth flow' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);
}

// Seed a WARM autopilot session: a worker taken and mid-run with only a plain
// progress note — no terminal ([done]/[failed]) and no wait ([blocked]) marker —
// so the session is non-terminal AND not waiting (the genuinely warm/EXECUTING
// case that must still omit `force`, LIN-1252).
async function seedWarmSession(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1252', issueTitle: 'Warm seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1252', issueTitle: 'Warm worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A plain progress note — no [done]/[failed]/[blocked]/[pending] marker — so the
  // run stays warm (in-progress), neither terminal nor waiting.
  const progress = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: 'made progress on the refactor' }
  });
  expect(progress.status(), `progress feedback failed: ${await progress.text()}`).toBe(200);
}

// Seed a FINISHED autopilot session (anchor driven to [done]) that still has a
// worker left in a [blocked] state — the LIN-1005 session-level terminal-gate
// case: the session is terminal, so it must NOT surface as waiting even though a
// child run is still blocked ("a finished session is never waiting").
async function seedTerminalSessionWithBlockedWorker(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1005', issueTitle: 'Done seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1005', issueTitle: 'Lingering blocked worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Worker: [blocked] with no [done] — stays a pause/wait signal.
  const wTake = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(wTake.status(), `worker take failed: ${await wTake.text()}`).toBe(200);
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need your decision on the auth flow' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);

  // Anchor: driven to [done] — the session anchor is terminal, so the whole
  // session is terminal (terminality follows the anchor loop, LIN-592).
  const aTake = await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: auth });
  expect(aTake.status(), `anchor take failed: ${await aTake.text()}`).toBe(200);
  const aDone = await page.request.post(`/api/dispatch/feedback/${anchorId}`, {
    headers: auth, data: { message: '[done] orchestration complete' }
  });
  expect(aDone.status(), `anchor done feedback failed: ${await aDone.text()}`).toBe(200);
}

// Seed a STANDALONE (non-autopilot, no sessionId) warm cli session — the LIN-1194
// human-dispatched case that reconstructs as its own single-loop session keyed by
// its own dispatch id. Left non-terminal (a plain progress note, no [done]/
// [blocked]) so the reply box omits force, isolating the LIN-1292 stitch from the
// force/kill-first behavior already covered above.
async function seedStandaloneWarm(page, { issueIdentifier, issueTitle }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'investigate the flake', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const item = (await res.json()).item;
  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${item.id}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  const progress = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
    headers: auth, data: { message: 'looked at the failing run' }
  });
  expect(progress.status(), `progress feedback failed: ${await progress.text()}`).toBe(200);
  return { item, token };
}

// Read the sessions feed and return the first session's id.
async function discoverSessionId(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  const seeded = all.find(s => String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session in the feed: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

test.describe('Dedicated per-session page (LIN-1003)', () => {
  test('renders overview, runs, and a link-rich transcript for a seeded session', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The page shell rendered.
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('.page-header.sess-header h1')).toContainText('Session');

    // Tasks-touched surface carries the seeded task.
    await expect(page.locator('[data-testid="session-tasks"]')).toContainText('LIN-1003');

    // At least one run row rendered.
    const run = page.locator('[data-testid="session-run"]').first();
    await expect(run).toBeVisible();

    // The run card has an expand/collapse toggle.
    await expect(page.locator('[data-testid="session-run-toggle"]').first()).toBeVisible();

    // Per-run transcript data is embedded in data-feedback attribute (JSON).
    const transcript = page.locator('[data-testid="session-run-transcript"]').first();
    const feedbackData = await transcript.getAttribute('data-feedback');
    expect(feedbackData).toBeTruthy();
    expect(feedbackData).toContain('opened the pull request');
    expect(feedbackData).toContain('https://example.com/pr/42');
    expect(feedbackData).toContain('[done] landed the change');

    // The run has a body container for the transcript (initially hidden via CSS).
    await expect(page.locator('[data-testid="session-run-body"]').first()).toBeAttached();

    // LIN-1309: the transcript is the shared chat.css thread, and each feedback
    // entry client-renders as a chat bubble (speaker pill + surface body) —
    // the same conversational idiom as Task Chat / the reply echo threads —
    // rather than the old bespoke `.sess-run-tx-entry` list markup.
    await expect(transcript).toHaveClass(/chat-thread/);
    const entries = transcript.locator('[data-testid="session-transcript-entry"].chat-msg');
    await expect(entries).toHaveCount(2);
    await expect(entries.first().locator('.status-pill.chat-msg__who')).toContainText('agent');
    await expect(entries.first().locator('.surface.chat-msg__body')).toContainText('opened the pull request');
    await expect(entries.first().locator('.sess-tx-link')).toHaveAttribute('href', 'https://example.com/pr/42');
    await expect(entries.last().locator('.surface.chat-msg__body')).toContainText('landed the change');

    // Back-to-feed link points at the observation feed.
    await expect(page.locator('[data-testid="session-back"]'))
      .toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);
  });

  test('shows the "waiting on you" banner for a [blocked] (paused) session (LIN-1005)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    // The feed rolls the session up to a waiting status with the blocked message.
    const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
    const body = await feed.json();
    const s = [...(body.active || []), ...(body.recent || [])].find(x => x.sessionId === sessionId);
    expect(s.status).toBe('waiting');
    expect(s.waiting).toBe(true);
    expect(s.waitingMessage).toContain('need your decision on the auth flow');

    // The session page renders the prominent alert banner + follow-up CTA.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');
    const banner = page.locator('[data-testid="session-waiting-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Waiting on you');
    await expect(page.locator('[data-testid="session-waiting-message"]')).toContainText('need your decision on the auth flow');
    // LIN-1163: the page-level box the banner used to point at is gone; the
    // copy now points at the per-run reply box.
    await expect(page.locator('[data-testid="session-waiting-cta"]')).toContainText('own reply box');
  });

  test('a finished session with a lingering blocked worker is NOT waiting — no banner (LIN-1005 terminal gate)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedTerminalSessionWithBlockedWorker(page);
    const sessionId = await discoverSessionId(page);

    // Feed: the session is terminal, so the waiting flag is gated off — the card
    // reports done with no waiting flag/message even though a worker is [blocked].
    const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
    const body = await feed.json();
    const s = [...(body.active || []), ...(body.recent || [])].find(x => x.sessionId === sessionId);
    expect(s.terminal).toBe(true);
    expect(s.status).not.toBe('waiting');
    expect(s.waiting).toBe(false);
    expect(s.waitingMessage).toBe(null);

    // Session page: no "waiting on you" banner on a finished session.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-waiting-banner"]')).toHaveCount(0);
  });

  // LIN-1163: the page-level reply box was removed — every reply now goes
  // through a run's own inline box, which must be expanded first (the
  // whole-card click, item 3) before its textarea/send button are interactable.
  async function expandRun(page, textFilter) {
    const run = page.locator('[data-testid="session-run"]').filter({ hasText: textFilter });
    await run.click();
    await expect(run.locator('[data-testid="session-inline-reply"]')).toBeVisible();
    return run;
  }

  test('the inline reply sends force:true for a run whose session is waiting (paused-on-human) (LIN-1252)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The blocked worker's own run: non-terminal itself, but the SESSION is
    // waiting — the paused-on-human state the runner must kill-first to resume
    // (LIN-1252) still forces via data-session-waiting.
    const run = await expandRun(page, 'Waiting worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'false');
    await expect(box).toHaveAttribute('data-session-waiting', 'true');
    const loopId = await box.getAttribute('data-loop-id');

    // Capture the outbound dispatch POST to assert the wire shape.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('please continue with option A');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // Additive follow-up: followUpTo = the RUN's own loopId (per-run, not the
    // session id), cli target, force:true (waiting → resume anyway / kill-first,
    // LIN-1252/LIN-546), and crucially NO kind:'wake' (no wake collision).
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBe(true);
    expect(payload.kind).toBeUndefined();
    expect(payload.prompt).toContain('option A');

    // The server accepts the forced follow-up (force + followUpTo is valid).
    const resp = await request.response();
    expect(resp.status()).toBe(201);

    // The UI confirms QUEUED (not delivered) — honest about the async handoff.
    await expect(box.locator('.sess-reply-feedback')).toContainText('queued');

    // LIN-1298: the sent reply is echoed as a conversational "you" bubble in the
    // reply thread — the shared Task Chat chat UI, reused on the session surface.
    const youBubble = box.locator('[data-testid="session-reply-you"]');
    await expect(youBubble).toHaveCount(1);
    await expect(youBubble).toContainText('option A');
    // It composes the shared speaker-pill + surface primitives.
    await expect(youBubble.locator('.status-pill.chat-msg__who')).toContainText('you');
    await expect(youBubble.locator('.surface.chat-msg__body')).toBeVisible();
  });

  test('the inline reply omits force for a run in a genuinely warm/executing session (LIN-1252)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    // A running worker with NO terminal/blocked marker → non-terminal AND not
    // waiting: the warm/EXECUTING case that must still omit force.
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Warm worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'false');
    await expect(box).toHaveAttribute('data-session-waiting', 'false');
    const loopId = await box.getAttribute('data-loop-id');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('a note for the warm session');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // Warm/executing run: plain follow-up, NO force (don't kill a live writer).
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBeUndefined();
    expect(payload.kind).toBeUndefined();

    await expect(box.locator('.sess-reply-feedback')).toContainText('queued');
  });

  test('the inline reply sends force:true for a finalized (terminal) run (LIN-1004)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedTerminalSessionWithBlockedWorker(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The anchor run itself was driven to [done] — terminal — so ITS OWN inline
    // box forces to "resume anyway", independent of the still-blocked worker.
    const run = await expandRun(page, 'Done seed');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'true');
    const loopId = await box.getAttribute('data-loop-id');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('one more thing');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBe(true);

    // The server accepts the forced follow-up (force + followUpTo is valid).
    const resp = await request.response();
    expect(resp.status()).toBe(201);
  });

  test('an unknown sessionId 404s with a not-found body', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);

    const resp = await page.request.get(`/workspace/${URL_KEY}/observation/session/does-not-exist`);
    expect(resp.status()).toBe(404);
    expect(await resp.text()).toContain('data-testid="session-not-found"');
  });

  test('Observation nav tab is active and links to the feed, not the session page (LIN-1149)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The page rendered.
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    // The page-local back link points to the Observation feed.
    await expect(page.locator('[data-testid="session-back"]'))
      .toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);

    // The shared Observation nav tab is active (aria-current) on the session page.
    const observationTab = page.locator('[data-testid="nav-view-observation"]');
    await expect(observationTab).toBeVisible();
    await expect(observationTab).toHaveAttribute('aria-current', 'page');
    // The Observation tab is a direct link to the feed, not the session page —
    // verified by navigating from a different surface.
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');
    // On the swipe page the Observation tab is a clickable anchor (not active).
    const tabHref = await page.locator('[data-testid="nav-view-observation"]').getAttribute('href');
    expect(tabHref).toBe(`/workspace/${URL_KEY}/observation`);
  });
});

// LIN-1292: the render-side follow-up thread stitch, driven through the REAL
// producer path (the reply box in public/session.js posting {prompt, followUpTo,
// target} with no sessionId) rather than a hand-built fixture — closing the
// close-out ledger's "no test drives a real reply-box POST through the store and
// asserts the follow-up renders inside the original session" gap. A standalone
// (non-autopilot, no-sessionId) anchor is the exact reproduction the ticket
// described: before the stitch, this follow-up fell into LIN-1194 pass 3 and
// surfaced as its own separate session — "vanished discussion."
test.describe('Follow-up thread stitching through the real reply-box path (LIN-1292)', () => {
  test('a human reply to a standalone cli session stitches into the same session, not a new one', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { item: anchor, token } = await seedStandaloneWarm(page, { issueIdentifier: 'LIN-1292', issueTitle: 'Standalone thread-split repro' });

    // The standalone loop reconstructs as its own session keyed by its own dispatch id.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-run"]')).toHaveCount(1);

    // LIN-1163: reply is driven through the (single) run's own inline box —
    // the page-level box this test used to drive is gone. Expand the card
    // first (whole-card click, item 3) to reach the now-collapsed reply.
    const run = page.locator('[data-testid="session-run"]');
    await run.click();
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('data-terminal', 'false');

    // Drive the REAL reply-box producer path: fill + send, exactly what a human does.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('one more thing on the flake');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // The exact wire shape a human reply sends: followUpTo pointing at the
    // standalone anchor's own dispatch id, no sessionId.
    expect(payload.followUpTo).toBe(anchor.id);
    expect(payload.sessionId).toBeUndefined();
    const resp = await request.response();
    expect(resp.status()).toBe(201);
    const followUp = (await resp.json()).item;

    // Drive the follow-up to completion so it carries its own transcript.
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const take2 = await page.request.post(`/api/dispatch/take/${followUp.id}`, { headers: auth });
    expect(take2.status(), `follow-up take failed: ${await take2.text()}`).toBe(200);
    const done2 = await page.request.post(`/api/dispatch/feedback/${followUp.id}`, {
      headers: auth, data: { message: '[done] fixed the flake' }
    });
    expect(done2.status(), `follow-up done feedback failed: ${await done2.text()}`).toBe(200);

    // The live sessions feed: still ONE session at the anchor's id — the follow-up
    // did NOT spawn a second standalone session (the LIN-1292 stitch engaging).
    // Standalone sessions surface only under the Sessions tab (LIN-1194, `?view=sessions`).
    const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions?view=sessions`);
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const all = [...(body.active || []), ...(body.recent || [])];
    const matches = all.filter(s => s.sessionId === anchor.id || s.sessionId === followUp.id);
    expect(matches.map(s => s.sessionId)).toEqual([anchor.id]);

    // The per-session page — reloaded from the ORIGINAL anchor's own URL, the only
    // one a human would have bookmarked — shows BOTH runs: the follow-up's own
    // transcript is reachable from the original session, not vanished into a
    // separate one.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-run"]')).toHaveCount(2);
    const loopIds = await page.locator('[data-testid="session-run"]').evaluateAll(els => els.map(el => el.getAttribute('data-loop-id')));
    expect(loopIds).toContain(anchor.id);
    expect(loopIds).toContain(followUp.id);
    await expect(page.locator('[data-testid="session-page"]')).toContainText('fixed the flake');

    // The follow-up's own dispatch id was never promoted to a session identity of
    // its own — the only live view of it is nested inside the original session.
    const directResp = await page.request.get(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(followUp.id)}`);
    expect(directResp.status()).toBe(404);
  });
});

// Note: cross-workspace / no-session isolation is workspaceFromUrl's contract
// (shared middleware, covered by existing specs) and is not re-tested here — in
// PAT mode the server auto-recreates a session on the next visit, so "no
// session" is not reproducible from an e2e. The 404 test above already exercises
// this route's own missing-session handling behind a valid session.
