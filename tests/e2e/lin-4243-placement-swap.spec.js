/**
 * LIN-4243 — Home's placement follows a change of the Waiting set: Running, Up next and the count line are swapped from one
 * read of the Home document, never per tick, and never under the reader's open task. Rows swapped in are bound once (one
 * click opens a task once; its opened task mounts once), and the reader's fold state survives (a collapsed desk section
 * stays collapsed; the persisted expanded rows open as on a reload). Reads are counted from the page's own Home requests.
 *
 * The refresh is `window.refreshWaitingOnYou()`, which runs the Waiting merge and then the placement check. What waits is an
 * open question record the task's run asked the person (LIN-4538: what Home reads), seeded through
 * tests/fixtures/question-records.js.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const WAIT_CARD = `${SECTION} .waiting-question`;
const RUNNING = '[data-testid="running-section"]';
const UP_NEXT = '[data-testid="home-up-next-section"]';
const COUNT = '[data-testid="in-progress-count"]';
const LIVE = '[data-testid="home-desk-live"]';
const THREE_OPTIONS = { options: ['Ship it now', 'Wait for review', 'Split the change'], recommended: 'Wait for review' };

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
  await page.request.get(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
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

/** A run on `identifier` parked on `[blocked]`, and the open question it asked the person (a question record). */
async function seedQuestionOn(page, identifier, { options, recommended }) {
  if (!RUNNER_TOKEN) RUNNER_TOKEN = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
  const runId = await askingRun(page, URL_KEY, identifier, { token: RUNNER_TOKEN });
  return seedQuestion(page, URL_KEY, { ticket: identifier, runId, asks: `Which for ${identifier}?`, options, recommended });
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
  // The question record card: an option chosen, then Answer sends it (lib/question-record-card.js). The card stays, settled.
  const card = waitingCard(elsewhere, identifier).locator('[data-testid="question-record-card"]');
  await card.locator('[data-option-id="Ship it now"]').click();
  await card.locator('[data-testid="question-record-card-answer"]').click();
  await expect(card).toHaveAttribute('data-settled', 'true', { timeout: 15000 });
  await elsewhere.close();
}

test('a question on a Running task moves it to Waiting only, with one Home read; answered elsewhere, it comes back', async ({ page, context }) => {
  await seedDesk(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  const docReads = homeDocReads(page, URL_KEY);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(1);
  await expect(row(page, RUNNING, 'LOCAL-B')).toHaveCount(1);
  const countBefore = await page.locator(COUNT).textContent();

  await seedQuestionOn(page, 'LOCAL-A', THREE_OPTIONS);
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

  await seedQuestionOn(page, 'LOCAL-A', THREE_OPTIONS);
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
  // Teardown witness: count destroy() calls on the old row's mounted PromptSection. A detached node would still lose its
  // data-mounted attribute, so only a destroy call proves the section was torn down before the swap.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="home-up-next-section"] [data-prompt-mount][data-mounted="true"]');
    const handle = el._promptSectionHandle;
    const destroy = handle.destroy;
    window.__destroyed = 0;
    handle.destroy = (...args) => { window.__destroyed++; return destroy.apply(handle, args); };
  });
  // Fresh-rowData witness: take LOCAL-T's record off the page, so only the swap's merge from the fetched document can
  // put it back before the new row mounts.
  const tangoKey = await page.evaluate(() => {
    const key = document.querySelector('[data-testid="home-up-next-section"] [data-prompt-mount][data-mounted="true"]').dataset.nodeKey;
    delete window.__HOME_PROMPT_OPTS__.rowData[key];
    return key;
  });
  expect(tangoKey).toBeTruthy();

  await seedQuestionOn(page, 'LOCAL-A', THREE_OPTIONS);
  await refresh(page);
  await expect(row(page, RUNNING, 'LOCAL-A')).toHaveCount(0);
  await expect(row(page, RUNNING, 'LOCAL-B')).toHaveCount(1);
  expect(docReads.length).toBe(1);

  // Running is still collapsed (the section and its header were kept); its rows are the fresh ones.
  await expect(page.locator('.running-body')).toBeHidden();
  await expect(page.locator('.running-header')).toContainText('▶');
  // The old rows' mounted opened task went with them; LOCAL-T's fresh row is unopened.
  await expect(page.locator(`${UP_NEXT} [data-prompt-mount][data-mounted="true"]`)).toHaveCount(0);
  expect(await page.evaluate(() => window.__destroyed)).toBe(1);

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
  expect(await page.evaluate(() => document.querySelector('[data-testid="home-up-next-section"] .details:not(.hidden) [data-prompt-mount]').dataset.nodeKey)).toBe(tangoKey);
  // A second click closes it: one toggle per click.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'false');

  // Persisted expanded rows open on the new rows as a reload opens them: LOCAL-T is opened by a click, so the reader's
  // state marks it expanded, then its details are hidden without a click (an open row holds the swap), so the state
  // still says expanded and the next swap opens it, as a reload would. app.js is a module (LIN-4463 piece 5), so the
  // state is reached through the page, not as a global.
  await row(page, UP_NEXT, 'LOCAL-T').click();
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => {
    const details = document.querySelector('[data-testid="home-up-next-section"] .details:not(.hidden)');
    details.classList.add('hidden');
  });
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden)`)).toHaveCount(0);
  await answerElsewhere(context, 'LOCAL-A');
  await refresh(page);
  await expect(page.locator(`${RUNNING} .line[data-identifier="LOCAL-A"], ${UP_NEXT} .line[data-identifier="LOCAL-A"]`)).toHaveCount(1);
  expect(docReads.length).toBe(2);
  await expect(row(page, UP_NEXT, 'LOCAL-T')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden)[data-details-for="${idOf('t')}"]`)).toHaveCount(1);
  await expect(page.locator(`${UP_NEXT} .details:not(.hidden) [data-prompt-mount][data-mounted="true"]`)).toHaveCount(1, { timeout: 15000 });
});
