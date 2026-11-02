/**
 * LIN-4114 — Home's "Waiting on you" section, end to end through the local harness.
 *
 * Witnesses 7, 9 (rendered Home), 11, 12, 13, 14, 15 (count line, read off the page), 17 (plan rev 2). Each test seeds
 * through the real routes (the seed endpoint, the dispatch API for a run-raised ruling, the scan route for a task-bound
 * one). All of these are NEW and must FAIL against the unmodified code: there is no Waiting section yet.
 *
 * Selectors this spec expects (new; to be added to SELECTORS.homeDesk in tests/helpers.js when the section is built):
 *   [data-testid="waiting-on-you"]        the section (role="region"), first desk section on Home
 *   [data-testid="waiting-task-line"]     the task line Home draws above each card (identifier, linked)
 *   [data-testid="waiting-header"]        the section header (the DESK_SECTIONS toggle)
 * The card, its options, Answer and the count line use the selectors the shared card already has.
 *
 * Witness 16 (a member and a keyless owner see no section, and no card text leaks through /api/home-rows) needs a
 * second session, and is not in this file yet (noted in the PR, to be written with its session helper).
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const CARD = `${SECTION} [data-testid="session-question-card"]`;
const COUNT = '[data-testid="in-progress-count"]';
const BADGE = '.rulings-badge .rulings-count';

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
});

/** A small tree: a started charter, a started middle, a Todo task three levels down, and a Todo task on its own. */
async function seedTree(page, { extraIssues = [] } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = [
    { id: id('charter'), identifier: 'LOCAL-0', title: 'Charter root, started', projectId: id('proj-0'), sortOrder: 0, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('mid'), identifier: 'LOCAL-M', title: 'Middle task, started', projectId: id('proj-0'), parentId: id('charter'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('deep'), identifier: 'LOCAL-D', title: 'Deep task, Todo', projectId: id('proj-0'), parentId: id('mid'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('solo'), identifier: 'LOCAL-S', title: 'Solo task, Todo', projectId: id('proj-0'), sortOrder: 3, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    ...extraIssues.map(issue => ({ ...issue, id: id(issue.raw), projectId: id('proj-0'), createdAt: OLD })),
  ].map(({ raw, ...issue }) => issue);
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

const THREE_OPTIONS = {
  options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }, { id: 'split', label: 'Split the change' }],
  recommended: 'wait',
};

/** The count line's "N waiting on you", or '' when the line says no such thing. */
async function waitingCount(page) {
  const text = (await page.locator(COUNT).textContent()) || '';
  const m = text.match(/(\d+) waiting on you/);
  return m ? Number(m[1]) : 0;
}

// ---- witness 7: one card per ruling, deep in the tree, equal to the count line and the badge -----------------------

test('W7: a ruling three levels down and a solo ruling each get one card, and the count line and the badge agree', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-D', THREE_OPTIONS);
  await seedRuling(page, 'LOCAL-S', { options: [{ id: 'a', label: 'Yes' }] });
  await page.goto(`/workspace/${URL_KEY}/`);

  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  await expect(section.locator('[data-testid="session-question-card"]')).toHaveCount(2);
  await expect(section.locator('[data-testid="waiting-task-line"]', { hasText: 'LOCAL-D' })).toHaveCount(1);
  await expect(section.locator('[data-testid="waiting-task-line"]', { hasText: 'LOCAL-S' })).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('2 waiting on you');
  await expect(page.locator(BADGE)).toHaveText('2', { timeout: 15000 });
});

// ---- witness 1 (press semantics), 3 (double press, in-flight lock): browser behaviour -----------------------------

test('W1: the recommended answer is the main button; a press sends its own label even when text is typed', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  await expect(card.locator('input[type="radio"]')).toHaveCount(0);
  const primary = card.locator('.btn--primary');
  await expect(primary, 'the recommended option is the main button').toHaveCount(1, { timeout: 5000 });
  await expect(primary).toHaveAttribute('data-option-id', 'wait');
  await expect(primary).toHaveAttribute('data-recommended', 'true');

  await card.locator('[data-testid="session-question-card-input"]').fill('my own words');
  const commentBody = page.waitForRequest(req => req.method() === 'POST' && /\/api\/comments\//.test(req.url()));
  await card.locator('[data-option-id="split"]').click();
  const body = (await commentBody).postDataJSON();
  expect(body.prompt ?? body.body ?? JSON.stringify(body)).toContain('Split the change');
  expect(JSON.stringify(body)).not.toContain('my own words');
});

test('W3: a double press on one option sends exactly one comment; the card\'s buttons stay off after success', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);

  const card = page.locator(CARD).first();
  let comments = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/api\/comments\//.test(req.url())) comments++; });
  const primary = card.locator('.btn--primary');
  await expect(primary, 'the recommended option is the main button').toHaveCount(1, { timeout: 5000 });
  await primary.dblclick();
  await expect(card.locator('[data-option-id]').first()).toBeDisabled({ timeout: 5000 });
  await page.waitForTimeout(2500);
  expect(comments, 'one comment for two presses').toBe(1);
  for (const button of await card.locator('[data-option-id]').all()) await expect(button).toBeDisabled();
});

// ---- witnesses 12, 15: a run-raised ruling answered in place, count line and badge fall ---------------------------

test('W12: pressing the recommended button answers in place; the card goes, the count line and the badge drop, and a reload agrees', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-D', THREE_OPTIONS);
  await seedRuling(page, 'LOCAL-S', { options: [{ id: 'a', label: 'Yes' }] });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 waiting on you');
  await expect(page.locator(BADGE)).toHaveText('2', { timeout: 15000 });

  const deep = page.locator(CARD, { has: page.locator('[data-testid="waiting-task-line"]', { hasText: 'LOCAL-D' }) });
  await expect(deep.locator('.btn--primary'), 'the recommended option is the main button').toHaveCount(1, { timeout: 5000 });
  await deep.locator('.btn--primary').click();
  await expect(deep).toHaveCount(0);
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
  await expect(page.locator(BADGE)).toHaveText('1', { timeout: 15000 });

  await page.reload();
  await expect(page.locator(CARD)).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
});

test('W12b: a press on a non-recommended option answers the same way, and the last card removes the section and the count line part', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  const card = page.locator(CARD).first();
  await card.locator('[data-option-id="ship"]').click();
  await expect(page.locator(SECTION)).toHaveCount(0);
  await expect(page.locator(COUNT)).not.toContainText('waiting on you');
  await expect(page.locator(BADGE)).toHaveText('0', { timeout: 15000 });
});

// ---- witness 13: partial failure keeps the card; retry removes it ------------------------------------------------

test('W13: comment written, run fails: the card stays with "Retry delivery"; after a successful retry it goes and the count drops', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', { options: [{ id: 'a', label: 'Yes' }] });
  await seedRuling(page, 'LOCAL-D', { options: [{ id: 'a', label: 'Yes' }] });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 waiting on you');

  let failDispatch = true;
  await page.route('**/api/dispatch**', route => {
    if (failDispatch && route.request().method() === 'POST') return route.fulfill({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' });
    return route.continue();
  });
  const card = page.locator(CARD, { has: page.locator('[data-testid="waiting-task-line"]', { hasText: 'LOCAL-S' }) });
  await card.locator('[data-option-id="a"]').click();
  await expect(card.locator('.sess-reply-retry-delivery')).toBeVisible({ timeout: 15000 });
  await expect(card).toHaveCount(1);

  failDispatch = false;
  await card.locator('.sess-reply-retry-delivery').click();
  await expect(card).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(COUNT)).toContainText('1 waiting on you');
  await page.unroute('**/api/dispatch**');
});

// ---- witness 11: a scan-raised (task-bound) ruling answered and dismissed through Home --------------------------

test('W11: a scan-raised ruling answered by pressing an option closes: the card goes, count and badge drop', async ({ page, seedLocal }) => {
  const issueId = randomUUID();
  await seedLocal({
    projects: [],
    issues: [{
      id: issueId, identifier: 'SCAN-H1', title: 'Task-bound scan fixture for Home',
      description: `This task is blocked pending an operator decision. (${issueId})`,
      state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${issueId}`,
    }],
  });
  const scan = await page.request.post(`/workspace/${URL_KEY}/api/scan/${issueId}`);
  expect(scan.status(), `scan seed failed: ${await scan.text()}`).toBe(200);
  await page.goto(`/workspace/${URL_KEY}/`);
  const card = page.locator(CARD, { has: page.locator('[data-testid="waiting-task-line"]', { hasText: 'SCAN-H1' }) });
  await expect(card).toHaveCount(1);
  await card.locator('[data-option-id]').first().click();
  await expect(card).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(COUNT)).not.toContainText('waiting on you');
});

test('W11b: a scan-raised ruling dismissed on Home closes the same way', async ({ page, seedLocal }) => {
  const issueId = randomUUID();
  await seedLocal({
    projects: [],
    issues: [{
      id: issueId, identifier: 'SCAN-H2', title: 'Task-bound scan fixture to dismiss',
      description: `This task is blocked pending an operator decision. (${issueId})`,
      state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${issueId}`,
    }],
  });
  const scan = await page.request.post(`/workspace/${URL_KEY}/api/scan/${issueId}`);
  expect(scan.status()).toBe(200);
  await page.goto(`/workspace/${URL_KEY}/`);
  const card = page.locator(CARD, { has: page.locator('[data-testid="waiting-task-line"]', { hasText: 'SCAN-H2' }) });
  await card.locator('[data-testid="session-question-card-dismiss"]').click();
  await expect(card).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(COUNT)).not.toContainText('waiting on you');
});

// ---- witness 14: the same ruling twice on a page; search and the opened task are the other copies ------------------

test('W14: answering a waiting task\'s card inside search removes the Waiting card too, and the count line and badge drop', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(CARD)).toHaveCount(1);

  await page.locator('.search-toggle').click();
  await page.locator('#search-input').fill('Solo task');
  const results = page.locator('[data-testid="home-search-results"]');
  await expect(results.locator('[data-identifier="LOCAL-S"]').first()).toBeVisible();
  await expect(page.locator(SECTION)).toHaveCount(0, { timeout: 5000 });
  await results.locator('[data-identifier="LOCAL-S"]').first().click();
  const opened = page.locator('[data-testid="opened-task"]').first();
  await opened.locator('[data-option-id="wait"]').click();
  await expect(opened.locator('[data-option-id]').first()).toBeDisabled({ timeout: 15000 });

  await page.locator('#search-input').fill('');
  await expect(page.locator(SECTION)).toHaveCount(0);
  await expect(page.locator(COUNT)).not.toContainText('waiting on you');
  await expect(page.locator(BADGE)).toHaveText('0', { timeout: 15000 });
});

// ---- witnesses 9 (rendered Home: each task once), and the named context exception -----------------------------------

test('W9: no task is drawn twice on Home across its sections, a waiting task included', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-D', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(SECTION)).toBeVisible();

  const repeats = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('main [data-identifier]')) {
      if (el.closest('.home-search-results')) continue;
      const id = el.getAttribute('data-identifier');
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(repeats, 'a task is drawn in two places on Home').toEqual([]);
});

test('W9b: a started waiting task with a running child is the named context row: no card for it, and it is drawn once', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-M', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('waiting on you');
  await expect(page.locator(CARD, { has: page.locator('[data-testid="waiting-task-line"]', { hasText: 'LOCAL-M' }) })).toHaveCount(0);
  const drawn = await page.locator('main [data-identifier="LOCAL-M"]').count();
  expect(drawn).toBe(1);
  await expect(page.locator('main [data-identifier="LOCAL-M"] [data-testid="issue-row-state"]'), 'the context row has no state words').toHaveCount(0);
});

// ---- witness 17: search hides the section; collapse persists across a reload; reset opens it ------------------------

test('W17: search hides the section and clearing it restores it; collapsing persists across reload and "reset" opens it', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedRuling(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(SECTION)).toBeVisible();

  await page.locator('.search-toggle').click();
  await page.locator('#search-input').fill('Solo');
  await expect(page.locator(SECTION)).toBeHidden();
  await page.locator('#search-input').fill('');
  await expect(page.locator(SECTION)).toBeVisible();

  await page.locator(`${SECTION} [data-testid="waiting-header"]`).click();
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeHidden();
  await page.reload();
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeHidden();
  await page.locator('[data-testid="desk-reset"]').click();
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeVisible();
});
