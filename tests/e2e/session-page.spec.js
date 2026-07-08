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

    // Wait for client JS to render transcript entries before expanding.
    await page.waitForFunction(() => {
      return document.querySelectorAll('[data-testid="session-transcript-entry"]').length > 0;
    });

    // Click the toggle to expand the first run card so the transcript becomes visible.
    await page.locator('[data-testid="session-run-toggle"]').first().click();
    await page.waitForFunction(() => {
      return document.querySelector('.sess-run--expanded') !== null;
    });

    // The per-run transcript is now visible.
    await expect(page.locator('[data-testid="session-run-transcript"]').first()).toBeVisible();
    const link = page.locator('[data-testid="session-transcript-link"]').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com/pr/42');

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
    await expect(page.locator('[data-testid="session-waiting-cta"]')).toContainText('follow-up box');
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

  test('the reply box POSTs a plain follow-up (no force) for a waiting session (LIN-1004)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The box renders on a cli session and is tagged non-terminal (waiting → warm).
    const box = page.locator('[data-testid="session-reply"]');
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('data-session-terminal', 'false');

    // Capture the outbound dispatch POST to assert the wire shape.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await page.locator('[data-testid="session-reply-input"]').fill('please continue with option A');
        await page.locator('[data-testid="session-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // Additive plain follow-up: followUpTo = the session's own id, cli target,
    // NO force (warm/waiting), and crucially NO kind:'wake' (no wake collision).
    expect(payload.followUpTo).toBe(sessionId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBeUndefined();
    expect(payload.kind).toBeUndefined();
    expect(payload.prompt).toContain('option A');

    // The UI confirms QUEUED (not delivered) — honest about the async handoff.
    await expect(page.locator('[data-testid="session-reply-feedback"]')).toContainText('queued');
  });

  test('the reply box sends force:true for a finalized (terminal) session (LIN-1004)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedTerminalSessionWithBlockedWorker(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const box = page.locator('[data-testid="session-reply"]');
    await expect(box).toBeVisible();
    // A finished session is terminal → the reply asserts "resume anyway".
    await expect(box).toHaveAttribute('data-session-terminal', 'true');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await page.locator('[data-testid="session-reply-input"]').fill('one more thing');
        await page.locator('[data-testid="session-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    expect(payload.followUpTo).toBe(sessionId);
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
});
// Note: cross-workspace / no-session isolation is workspaceFromUrl's contract
// (shared middleware, covered by existing specs) and is not re-tested here — in
// PAT mode the server auto-recreates a session on the next visit, so "no
// session" is not reproducible from an e2e. The 404 test above already exercises
// this route's own missing-session handling behind a valid session.
