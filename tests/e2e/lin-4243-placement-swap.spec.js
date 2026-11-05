/**
 * LIN-4243 — Home's placement follows a change of the Waiting set: Running, Up next and the count line are swapped from one
 * read of the Home document, never per tick, and never under the reader's open task. Rows swapped in are bound once (one
 * click opens a task once; its opened task mounts once), and the reader's fold state survives (a collapsed desk section
 * stays collapsed; the persisted expanded rows open as on a reload). Reads are counted from the page's own Home requests.
 *
 * The refresh is `window.refreshWaitingOnYou()`, which runs the Waiting merge and then the placement check. Seeding mirrors
 * tests/e2e/lin-4242-waiting-live.spec.js.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const WAIT_CARD = `${SECTION} .waiting-card`;
const RUNNING = '[data-testid="running-section"]';
const UP_NEXT = '[data-testid="home-up-next-section"]';
const COUNT = '[data-testid="in-progress-count"]';
const LIVE = '[data-testid="home-desk-live"]';
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

/** Two started tasks (Running) and two Todo tasks (Up next), nothing waiting. */
async function seedDesk(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = [
    { id: id('a'), identifier: 'LOCAL-A', title: 'Alpha, started', projectId: id('proj-0'), sortOrder: 0, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('b'), identifier: 'LOCAL-B', title: 'Bravo, started', projectId: id('proj-1'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('s'), identifier: 'LOCAL-S', title: 'Solo, Todo', projectId: id('proj-0'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('t'), identifier: 'LOCAL-T', title: 'Tango, Todo', projectId: id('proj-1'), sortOrder: 3, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      projects: [
        { id: id('proj-0'), name: 'Project 0', content: 'Seeded', sortOrder: 0 },
        { id: id('proj-1'), name: 'Project 1', content: 'Seeded', sortOrder: 1 },
      ],
      issues,
    },
  });
  expect(resp.ok()).toBeTruthy();
  return { idOf: id };
}

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

const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());
// Every read of the Home document the page makes (the swap's one read): a fetch of the page's own path.
const homeDocReads = (page, urlKey) => {
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.resourceType() === 'fetch' && u.pathname === `/workspace/${urlKey}/`) seen.push(u.pathname);
  });
  return seen;
};
const row = (page, region, identifier) => page.locator(`${region} .line[data-identifier="${identifier}"]`);
const waitingCard = (page, identifier) => page.locator(WAIT_CARD, {
  has: page.locator('[data-testid="waiting-task-line"]', { hasText: identifier }),
});

async function answerElsewhere(context, identifier) {
  const elsewhere = await context.newPage();
  await elsewhere.goto(`/workspace/${URL_KEY}/`);
  await waitingCard(elsewhere, identifier).locator('[data-option-id="ship"]').click();
  await expect(waitingCard(elsewhere, identifier)).toHaveCount(0, { timeout: 15000 });
  await elsewhere.close();
}

test('a ruling on a Running task moves it to Waiting only, with one Home read; answered elsewhere, it comes back', async ({ page, context }) => {
  await seedDesk(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  const docReads = homeDocReads(page, URL_KEY);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(1);
  await expect(row(page, RUNNING, 'LOCAL-B')).toHaveCount(1);
  const countBefore = await page.locator(COUNT).textContent();

  await seedRuling(page, 'LOCAL-A', THREE_OPTIONS);
  await refresh(page);
  // Waiting only: the card is in Waiting and the row has left Running (the 4117 reachability property, on the live page).
  await expect(waitingCard(page, 'LOCAL-A')).toHaveCount(1);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(0);
  await expect(row(page, RUNNING, 'LOCAL-B')).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
  expect(await page.locator(COUNT).textContent()).not.toBe(countBefore);
  expect(docReads.length).toBe(1);

  // Unchanged set: further ticks read nothing.
  await refresh(page);
  await refresh(page);
  expect(docReads.length).toBe(1);

  await answerElsewhere(context, 'LOCAL-A');
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-A')).toHaveCount(0);
  await expect(page.locator(`${RUNNING} .line[data-identifier="LOCAL-A"], ${UP_NEXT} .line[data-identifier="LOCAL-A"]`)).toHaveCount(1);
  await expect(page.locator(COUNT).filter({ hasText: 'waiting on you' })).toHaveCount(0);
  expect(docReads.length).toBe(2);
});

test('an opened task defers the swap and says so; closing it lets the next tick swap', async ({ page }) => {
  await seedDesk(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  const docReads = homeDocReads(page, URL_KEY);
  // Open LOCAL-T (Up next) and wait for its opened task to mount.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden) [data-prompt-mount][data-mounted="true"]`)).toHaveCount(1, { timeout: 15000 });

  await seedRuling(page, 'LOCAL-A', THREE_OPTIONS);
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-A')).toHaveCount(1);
  // Deferred: nothing swapped, nothing read, and the live region says so.
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(1);
  await expect(page.locator(LIVE)).toContainText('Home changed');
  expect(docReads.length).toBe(0);
  await refresh(page);
  expect(docReads.length).toBe(0);

  // Close the task: the next tick swaps.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await refresh(page);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(0);
  expect(docReads.length).toBe(1);
});

test('after a swap rows are bound once, the opened task mounts once, and fold state survives', async ({ page, context }) => {
  const { idOf } = await seedDesk(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  const docReads = homeDocReads(page, URL_KEY);
  // Fold state before the swap: Running collapsed by its header; LOCAL-T opened and closed (its opened task mounted, now hidden).
  await page.locator('.running-header').click();
  await expect(page.locator('.running-body')).toBeHidden();
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(page.locator(`${UP_NEXT} [data-prompt-mount][data-mounted="true"]`)).toHaveCount(1, { timeout: 15000 });
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden)`)).toHaveCount(0);

  await seedRuling(page, 'LOCAL-A', THREE_OPTIONS);
  await refresh(page);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(0);
  await expect(row(page, RUNNING, 'LOCAL-B')).toHaveCount(1);
  expect(docReads.length).toBe(1);

  // Running is still collapsed (the section and its header were kept); its rows are the fresh ones.
  await expect(page.locator('.running-body')).toBeHidden();
  await expect(page.locator('.running-header')).toContainText('▶');
  // The old rows' mounted opened task went with them; LOCAL-T's fresh row is unopened.
  await expect(page.locator(`${UP_NEXT} [data-prompt-mount][data-mounted="true"]`)).toHaveCount(0);

  // Bound once: one click opens LOCAL-T (a double-bound toggle would open and close it), and its opened task mounts once.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden) [data-prompt-mount][data-mounted="true"]`)).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden) [data-prompt-mount]`)).toHaveCount(1);
  // The opened task read the fresh rowData for its row (the server's record for that node key).
  const hasRowData = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-up-next-section"] .details:not(.hidden) [data-prompt-mount]');
    return !!(window.__HOME_PROMPT_OPTS__.rowData || {})[el.dataset.nodeKey];
  });
  expect(hasRowData).toBe(true);
  // A second click closes it: one toggle per click.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'false');

  // Persisted expanded rows open on the new rows as a reload opens them: LOCAL-T is marked expanded in the reader's state
  // (as another tab would leave it), and the next swap opens it, as a reload would.
  await page.evaluate((id) => { state.expanded.push({ id, section: 'home-up-next' }); }, idOf('t'));
  await answerElsewhere(context, 'LOCAL-A');
  await refresh(page);
  await expect(page.locator(`${RUNNING} .line[data-identifier="LOCAL-A"], ${UP_NEXT} .line[data-identifier="LOCAL-A"]`)).toHaveCount(1);
  expect(docReads.length).toBe(2);
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden)[data-details-for="${idOf('t')}"]`)).toHaveCount(1);
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden) [data-prompt-mount][data-mounted="true"]`)).toHaveCount(1, { timeout: 15000 });
});
