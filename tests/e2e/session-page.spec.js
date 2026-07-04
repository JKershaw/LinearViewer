import { test, expect } from '../fixtures/test-base.js';

// LIN-1003 Phase 1: the dedicated per-session page
// (GET /workspace/:urlKey/observation/session/:sessionId), the promoted
// Observation drill-down. Seeds a real session carrying feedback[] the same way
// observation.spec does — through the user dispatch API + the real consumer
// take+feedback flow (no store-primitive change) — then asserts the transcript,
// tasks, and per-run surfaces render, plus 404/cross-workspace isolation.

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

// Seed one autopilot run and drive it through the real consumer take+feedback
// flow so it reconstructs as a session carrying feedback[] (the transcript).
async function seedSessionWithTranscript(page, { issueIdentifier, issueTitle }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const item = (await res.json()).item;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}` };

  const take = await page.request.post(`/api/dispatch/take/${item.id}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);

  const fb1 = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { message: 'working on the plan' }
  });
  expect(fb1.status(), `feedback 1 failed: ${await fb1.text()}`).toBe(200);

  const fb2 = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { message: '[evidence] opened a pull request', url: 'https://example.com/pr/1', urlLabel: 'PR #1' }
  });
  expect(fb2.status(), `feedback 2 failed: ${await fb2.text()}`).toBe(200);

  return item;
}

// Resolve the reconstructed session's id from the feed (sessionId = the anchor
// run's id, the LIN-591 spine). Polls briefly to ride past the feed's SWR cache.
async function resolveSessionId(page, seedIssue) {
  for (let i = 0; i < 10; i++) {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
    if (res.ok()) {
      const body = await res.json();
      const sess = (body.active || []).concat(body.recent || []).find(s => s.seedIssue === seedIssue);
      if (sess) return sess.sessionId;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`session for ${seedIssue} never appeared in the feed`);
}

test.describe('Per-session page (LIN-1003)', () => {
  test('renders the transcript, tasks, and per-run surfaces for a seeded session', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page, { issueIdentifier: 'LIN-1003', issueTitle: 'Per-session page seed' });
    const sessionId = await resolveSessionId(page, 'LIN-1003');

    const resp = await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    expect(resp.status()).toBe(200);

    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();

    // Transcript: the raw feedback message + the evidence link both render.
    const transcript = page.locator('[data-testid="session-transcript"]');
    await expect(transcript).toBeVisible();
    await expect(transcript).toContainText('working on the plan');
    await expect(transcript.locator('[data-testid="session-transcript-entry"]').first()).toBeVisible();
    await expect(transcript.locator('a[href="https://example.com/pr/1"]')).toBeVisible();

    // Tasks-touched + at least one run block.
    await expect(page.locator('[data-testid="session-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-run"]').first()).toBeVisible();

    // Back link returns to the feed.
    await expect(page.locator('[data-testid="session-back"]')).toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);
  });

  test('404s on an unknown sessionId (cross-workspace isolation)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    const resp = await page.goto(`/workspace/${URL_KEY}/observation/session/no-such-session-id`);
    expect(resp.status()).toBe(404);
    await expect(page.locator('body')).toContainText('was not found');
  });
});
