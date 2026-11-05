/**
 * LIN-4242 — Home's "Waiting on you" refreshes live, end to end through the local harness.
 *
 * A ruling raised after Home loaded gets its card on the next refresh; a card answered elsewhere leaves; a half-typed
 * answer on a card that is still open survives the refresh (the same node, its text intact); the section and count line
 * are hidden, not removed, when the set is empty. The refresh is `window.refreshWaitingOnYou()`, the same function the
 * rulings tick runs, so the tests need no timed waits: each step waits on the page's own state.
 *
 * The seeding helpers mirror tests/e2e/lin-4114-waiting-on-you.spec.js (a run-raised ruling through the dispatch API).
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const CARD = `${SECTION} [data-testid="session-question-card"]`;
const WAIT_CARD = `${SECTION} .waiting-card`;
const COUNT = '[data-testid="in-progress-count"]';
const LIVE = '[data-testid="home-desk-live"]';
const BADGE = '.rulings-badge .rulings-count';
const THREE_OPTIONS = {
  options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }, { id: 'split', label: 'Split the change' }],
  recommended: 'wait',
};

let URL_KEY;
let RUNNER_TOKEN = null;

test.setTimeout(180000);

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  RUNNER_TOKEN = null;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-task-decisions?urlKey=${URL_KEY}`);
});

/** A started charter with two Todo tasks under it, and nothing waiting. */
async function seedTree(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = [
    { id: id('charter'), identifier: 'LOCAL-0', title: 'Charter root, started', projectId: id('proj-0'), sortOrder: 0, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('deep'), identifier: 'LOCAL-D', title: 'Deep task, Todo', projectId: id('proj-0'), parentId: id('charter'), sortOrder: 1, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('solo'), identifier: 'LOCAL-S', title: 'Solo task, Todo', projectId: id('proj-0'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey: URL_KEY, runnerKey: true, projects: [{ id: id('proj-0'), name: 'Project 0', content: 'Seeded', sortOrder: 0 }], issues },
  });
  expect(resp.ok()).toBeTruthy();
}

/** A worker waiting on a ruling, written through the dispatch API the way a runner writes it (enqueue, take, `[decision]`). */
async function seedRuling(page, identifier, decision) {
  if (!RUNNER_TOKEN) RUNNER_TOKEN = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
  const token = RUNNER_TOKEN;
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data,
  });
  expect((await feedback({ message: '[blocked] which way?' })).status()).toBe(200);
  const res2 = await feedback({ kind: 'decision', message: JSON.stringify({ decision_id: `d-${identifier}`, question: `Which for ${identifier}?`, ...decision }) });
  expect(res2.status(), `decision failed: ${await res2.text()}`).toBe(200);
}

/** Runs one refresh on the page and resolves when it has finished (the function returns its promise). */
const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());

const waitingCard = (page, identifier) => page.locator(WAIT_CARD, {
  has: page.locator('[data-testid="waiting-task-line"]', { hasText: identifier }),
});

test('a ruling raised after load gets its card on refresh; the count line and badge agree; answering it hides the section again', async ({ page }) => {
  await seedTree(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  // Zero rulings: the owner's section is on the page, hidden, and the count line has no waiting part.
  await expect(page.locator(SECTION)).toBeHidden();
  await expect(page.locator(CARD)).toHaveCount(0);

  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);
  await expect(page.locator(SECTION)).toBeVisible();
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
  await expect(page.locator(BADGE)).toHaveText('1', { timeout: 15000 });

  await waitingCard(page, 'LOCAL-S').locator('[data-option-id="wait"]').click();
  await expect(page.locator(CARD)).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(SECTION)).toBeHidden();
  await expect(page.locator(COUNT).filter({ hasText: 'waiting on you' })).toHaveCount(0);
  await expect(page.locator(BADGE)).toHaveText('0', { timeout: 15000 });
});

test('a card answered elsewhere leaves on refresh and says so; a half-typed answer on a card still open survives as the same node', async ({ page, context }) => {
  await seedTree(page);
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await seedRuling(page, 'LOCAL-D', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 waiting on you');

  const typed = waitingCard(page, 'LOCAL-S').locator('[data-testid="session-question-card-input"]');
  await typed.fill('half a sentence about the solo task');
  await typed.focus();
  // Mark the kept card's node: a refresh that re-renders it would drop the mark.
  await waitingCard(page, 'LOCAL-S').locator('[data-testid="session-question-card"]').evaluate(el => { el.dataset.keepMark = 'yes'; });

  // The other tab answers LOCAL-D. This page's copy is still there until it refreshes.
  const elsewhere = await context.newPage();
  await elsewhere.goto(`/workspace/${URL_KEY}/`);
  await waitingCard(elsewhere, 'LOCAL-D').locator('[data-option-id="split"]').click();
  await expect(waitingCard(elsewhere, 'LOCAL-D')).toHaveCount(0, { timeout: 15000 });
  await elsewhere.close();

  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-D')).toHaveCount(0);
  await expect(page.locator(LIVE)).toHaveText('Answered elsewhere');
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
  await expect(typed).toHaveValue('half a sentence about the solo task');
  await expect(page.locator(`${SECTION} [data-keep-mark="yes"]`)).toHaveCount(1);
});

test('a stale card that answers a settled ruling is refused and its card goes with "Answered elsewhere"', async ({ page, context }) => {
  await seedTree(page);
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);

  const elsewhere = await context.newPage();
  await elsewhere.goto(`/workspace/${URL_KEY}/`);
  await waitingCard(elsewhere, 'LOCAL-S').locator('[data-option-id="ship"]').click();
  await expect(waitingCard(elsewhere, 'LOCAL-S')).toHaveCount(0, { timeout: 15000 });
  await elsewhere.close();

  // This page still shows the card (no refresh yet). Its answer is refused as settled: the card leaves, no failure copy.
  await waitingCard(page, 'LOCAL-S').locator('[data-option-id="wait"]').click();
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(LIVE)).toHaveText('Answered elsewhere');
  await expect(page.locator('body')).not.toContainText('reply failed');
});
