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
    await expect(page.locator('[data-testid="session-run"]').first()).toBeVisible();

    // The transcript rendered with the evidence link.
    await expect(page.locator('[data-testid="session-transcript"]')).toBeVisible();
    const link = page.locator('[data-testid="session-transcript-link"]').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com/pr/42');

    // Back-to-feed link points at the observation feed.
    await expect(page.locator('[data-testid="session-back"]'))
      .toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);
  });

  test('an unknown sessionId 404s with a not-found body', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);

    const resp = await page.request.get(`/workspace/${URL_KEY}/observation/session/does-not-exist`);
    expect(resp.status()).toBe(404);
    expect(await resp.text()).toContain('data-testid="session-not-found"');
  });

  test('the route inherits workspace auth (no session → not our workspace)', async ({ page }) => {
    // No /test/set-session: the caller has no workspaces, so workspaceFromUrl
    // rejects before the handler runs (cross-workspace isolation for free).
    await page.goto(`/test/clear-session`);
    const resp = await page.request.get(`/workspace/${URL_KEY}/observation/session/whatever`);
    expect(resp.status()).not.toBe(200);
  });
});
