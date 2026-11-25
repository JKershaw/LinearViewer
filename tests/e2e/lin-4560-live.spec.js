import { test, expect } from '../fixtures/test-base.js';
import { seedHistoryFeedback } from '../fixtures/history-feedback.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';

/**
 * LIN-4560 beat 4: a live run's transcript updates without a reload, on the run page and in Dispatch history, through the
 * one shared follower (public/transcript-live.js) and the signed-in hold-open read (GET …/api/dispatch/transcripts).
 *  (a) the run page: a new entry posted while the page is open appears without a reload; an opened child-agent thread
 *      stays open; the in-progress marker is on the newest bubble only; at done the transcript has no marker at all;
 *  (b) the same in Dispatch history, for a row with no words when the page loaded;
 *  (e) a secret in a row stored before intake masking (written raw through the history seam) renders masked on both.
 */

async function clearRuns(page, urlKey) {
  for (const seam of ['clear-ticket-records', 'clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-observation-sessions', 'clear-sessions-feed-cache']) {
    await page.goto(`/test/${seam}?urlKey=${urlKey}`);
  }
}

/** One autopilot session whose worker is taken; returns a poster for the worker's feedback and its id. */
async function seedLiveRun(page, urlKey) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-4560', issueTitle: 'Live seed', target: 'cli' }
  });
  expect(anchor.status(), await anchor.text()).toBe(201);
  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-4560', issueTitle: 'Live worker', target: 'cli', sessionId: (await anchor.json()).item.id }
  });
  expect(worker.status(), await worker.text()).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  expect((await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  const post = async (data) => {
    const res = await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data });
    expect(res.status(), await res.text()).toBe(200);
  };
  return { workerId, post };
}

async function sessionIdOf(page, urlKey) {
  const body = await (await page.request.get(`/workspace/${urlKey}/api/dashboard/sessions`)).json();
  const seeded = [...(body.active || []), ...(body.recent || [])].find((s) => String(s.sessionId || '').length > 0);
  expect(seeded, JSON.stringify(body.counts)).toBeTruthy();
  return seeded.sessionId;
}

/** Counts page loads, so a spec can show the new entry arrived without one. */
function countLoads(page) {
  const loads = { n: 0 };
  page.on('load', () => { loads.n += 1; });
  return loads;
}

test.describe('LIN-4560: live transcripts without a reload', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await clearRuns(page, workerUrlKey);
  });

  test('(a) run page: a new entry appears without a reload, an opened thread stays open, and done leaves no marker', async ({ page, workerUrlKey }) => {
    const { workerId, post } = await seedLiveRun(page, workerUrlKey);
    await post({ message: 'first words', kind: 'assistant-text' });
    await post({ message: 'Searching lib/.', kind: 'agent-text', agent: 'a1b2c3' });
    const sessionId = await sessionIdOf(page, workerUrlKey);
    await page.goto(`/workspace/${workerUrlKey}/observation/session/${encodeURIComponent(sessionId)}`);
    const loads = countLoads(page);
    const run = page.locator(`[data-testid="session-run"][data-loop-id="${workerId}"]`);
    await run.locator('[data-testid="session-run-toggle"]').click();
    const tx = run.locator('[data-testid="session-run-transcript"]');
    await tx.locator('[data-testid="transcript-agent-summary"]').click();
    await expect(tx.locator('[data-testid="transcript-agent-thread"] details')).toHaveAttribute('open', '');

    await post({ message: 'second words, posted while the page is open', kind: 'assistant-text' });
    await expect(tx.locator('[data-testid="transcript-entry"]').filter({ hasText: 'second words' })).toBeVisible({ timeout: 15000 });
    expect(loads.n, 'no reload').toBe(0);
    await expect(tx.locator('[data-testid="transcript-agent-thread"] details'), 'the opened thread stays open').toHaveAttribute('open', '');
    await expect(tx.locator('.status-pill--in-progress')).toHaveCount(1);
    await expect(tx.locator('[data-testid="transcript-entry"]').last().locator('.status-pill--in-progress')).toHaveCount(1);

    await post({ message: '[done] landed the change', kind: 'status' });
    await expect(tx.locator('[data-testid="transcript-entry"]').filter({ hasText: 'landed the change' })).toBeVisible({ timeout: 15000 });
    await expect(tx.locator('.status-pill--in-progress'), 'a finished run has no in-progress marker').toHaveCount(0);
    expect(loads.n).toBe(0);
  });

  test('(b) Dispatch history: a live row\'s first and later entries appear without a reload, and done leaves no marker', async ({ page, workerUrlKey }) => {
    const { workerId, post } = await seedLiveRun(page, workerUrlKey);
    // No networkidle: the page's held transcripts read keeps a connection open by design.
    await page.goto(`/workspace/${workerUrlKey}/dispatch`);
    const loads = countLoads(page);
    const row = page.locator(`.history-item[data-row-id="${workerId}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="history-transcript"]')).toHaveCount(0);

    await post({ message: 'first words, posted while the page is open', kind: 'assistant-text' });
    const tx = row.locator('[data-testid="history-transcript"]');
    await expect(tx.locator('[data-testid="transcript-entry"]').filter({ hasText: 'first words' })).toBeVisible({ timeout: 15000 });
    await post({ message: 'second words', kind: 'assistant-text' });
    await expect(tx.locator('[data-testid="transcript-entry"]')).toHaveCount(2, { timeout: 15000 });
    await expect(tx.locator('.status-pill--in-progress')).toHaveCount(1);
    expect(loads.n, 'no reload').toBe(0);

    await post({ message: '[done] landed', kind: 'status' });
    await expect(tx.locator('[data-testid="transcript-entry"]')).toHaveCount(3, { timeout: 15000 });
    await expect(tx.locator('.status-pill--in-progress'), 'a finished run has no in-progress marker').toHaveCount(0);
    expect(loads.n).toBe(0);
  });

  test('(e) a secret in a row stored before intake masking renders masked on the run page and in Dispatch history', async ({ page, workerUrlKey }) => {
    const secret = FIXTURE_SECRETS.githubPat;
    const { workerId } = await seedLiveRun(page, workerUrlKey);
    // Written raw onto the stored document, as rows were before intake masking (LIN-4556).
    await seedHistoryFeedback(page, workerUrlKey, workerId, [{ kind: 'assistant-text', message: `the token was ${secret} in .env` }]);

    const sessionId = await sessionIdOf(page, workerUrlKey);
    await page.goto(`/workspace/${workerUrlKey}/observation/session/${encodeURIComponent(sessionId)}`);
    const run = page.locator(`[data-testid="session-run"][data-loop-id="${workerId}"]`);
    await run.locator('[data-testid="session-run-toggle"]').click();
    await expect(run.locator('[data-testid="transcript-entry"]').filter({ hasText: 'the token was' })).toContainText('[redacted]');
    expect(await page.content(), 'the run page never carries the secret').not.toContain(secret);

    await page.goto(`/workspace/${workerUrlKey}/dispatch`);
    const row = page.locator(`.history-item[data-row-id="${workerId}"]`);
    await expect(row.locator('[data-testid="transcript-entry"]').filter({ hasText: 'the token was' })).toContainText('[redacted]');
    expect(await page.content(), 'Dispatch history never carries the secret').not.toContain(secret);
  });
});
