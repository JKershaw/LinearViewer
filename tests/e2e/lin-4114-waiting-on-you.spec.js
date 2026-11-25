/**
 * LIN-4114 — Home's "Waiting on you" section, end to end through the local harness.
 *
 * Witnesses 7, 9 (rendered Home), 12, 13, 14, 15 (count line, read off the page), 17 (plan rev 2). Each test seeds
 * through the real routes (the seed endpoint and the dispatch API for a run-raised ruling). All of these are NEW and must FAIL against the unmodified code: there is no Waiting section yet.
 *
 * Selectors this spec expects (new; to be added to SELECTORS.homeDesk in tests/helpers.js when the section is built):
 *   [data-testid="waiting-on-you"]        the section (role="region"), first desk section on Home
 *   [data-testid="question-record-card-task"]  the card's own task line (identifier linked, title; LIN-4549)
 *   [data-testid="waiting-header"]        the section header (the DESK_SECTIONS toggle)
 * The card, its options, Answer and the count line use the selectors the shared card already has.
 *
 * LIN-4538 (P7a): Home's waiting rows are open question records a run asked the person (seeded through
 * tests/fixtures/question-records.js), drawn as the question record card (lib/question-record-card.js): an option chooses,
 * Answer sends the option and the person's words together, and a card answered here stays, settled, out of the count and the
 * badge (LIN-4532).
 *
 * LIN-4242: the owner's section is always on Home, hidden when empty (W12b asserts hidden after a reload). Witness 16
 * (a keyless owner sees no section, and no card text leaks through /api/home-rows) seeds its open question through
 * /test/seed-question-record with no run, which needs only the signed-in session and mints no token (LIN-4540: it used to
 * seed through the retired comment scan).
 */
import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const CARD = `${SECTION} [data-testid="question-record-card"]`;
const OPEN_CARD = `${CARD}:not([data-settled="true"])`;
// A waiting card's wrapper: the task line and the shared card are its children, so the task filter runs on the wrapper.
const WAIT_CARD = `${SECTION} .waiting-question`;
const ANSWER = '[data-testid="question-record-card-answer"]';
const FEEDBACK = '[data-testid="question-record-card-feedback"]';
const COUNT = '[data-testid="in-progress-count"]';
// LIN-4563: the rail's count on Home (the band draws a second copy for a phone), the bar's on a page not yet moved.
const BADGE = SELECTORS.questionsBadge;

/**
 * LIN-4242: the badge reads the rulings feed through the 5s cache and moves only on the interval. Clear the cache and read
 * the badge once, so each badge assertion waits on this read and not on the interval.
 */
async function syncBadge(page) {
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  await page.evaluate((urlKey) => window.updateRulingsBadge(urlKey), URL_KEY);
}

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
  // Question records are durable too: one from an earlier test would otherwise stay on Home.
  await page.request.get(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
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

/** A run on `identifier` parked on `[blocked]`, and the open question it asked the person. Returns the question id. */
async function seedWaiting(page, identifier, { options, recommended = null }) {
  if (!RUNNER_TOKEN) RUNNER_TOKEN = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
  const runId = await askingRun(page, URL_KEY, identifier, { token: RUNNER_TOKEN });
  return seedQuestion(page, URL_KEY, { ticket: identifier, runId, asks: `Which for ${identifier}?`, options, recommended });
}

/** Answer one question card as the person does: choose the option, then press Answer. */
async function answerWith(card, option) {
  await card.locator(`[data-option-id="${option}"]`).click();
  await card.locator(ANSWER).click();
}

const THREE_OPTIONS = { options: ['Ship it now', 'Wait for review', 'Split the change'], recommended: 'Wait for review' };
const ONE_OPTION = { options: ['Yes'] };

/** The count line's "N questions" (LIN-4552), or 0 when the line says no such thing. */
async function waitingCount(page) {
  const text = (await page.locator(COUNT).textContent()) || '';
  const m = text.match(/(\d+) questions?\b/);
  return m ? Number(m[1]) : 0;
}

// ---- witness 7: one card per ruling, deep in the tree, equal to the count line and the badge -----------------------

test('W7: a question three levels down and a solo question each get one card, and the count line and the badge agree', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-D', THREE_OPTIONS);
  await seedWaiting(page, 'LOCAL-S', ONE_OPTION);
  await page.goto(`/workspace/${URL_KEY}/`);

  const section = page.locator(SECTION);
  await expect(section).toBeVisible();
  await expect(section.locator('[data-testid="question-record-card"]')).toHaveCount(2);
  await expect(section.locator('[data-testid="question-record-card-task"]', { hasText: 'LOCAL-D' })).toHaveCount(1);
  await expect(section.locator('[data-testid="question-record-card-task"]', { hasText: 'LOCAL-S' })).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('2 questions');
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('2 questions', { timeout: 15000 });
});

// ---- witness 1 (press semantics), 3 (double press, in-flight lock): browser behaviour -----------------------------

test('W1: the recommended answer comes first and is labelled; a press chooses an option, and Answer sends it with the typed words in one request', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  await expect(card.locator('input[type="radio"]')).toHaveCount(0);
  // LIN-4551: the recommended option is marked by its "recommended" label and its place first, not the main button style (which
  // Answer now carries, and no option keeps).
  const primary = card.locator('[data-testid="question-record-card-option"][data-recommended="true"]');
  await expect(primary, 'one option is the recommended one').toHaveCount(1, { timeout: 5000 });
  await expect(primary).toHaveAttribute('data-option-id', 'Wait for review');
  await expect(primary).toHaveAttribute('data-recommended', 'true');
  await expect(card.locator('[data-testid="question-record-card-option"]').first()).toHaveAttribute('data-option-id', 'Wait for review');
  await expect(primary.locator('[data-testid="question-record-card-recommended"]')).toHaveText('recommended');
  await expect(card.locator('[data-testid="question-record-card-option"].btn--primary'), 'no option keeps the main button style').toHaveCount(0);

  // A press on an option only chooses it: nothing is sent until Answer.
  let answers = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/questions\/[^/]+\/answer$/.test(req.url())) answers++; });
  await card.locator('[data-option-id="Split the change"]').click();
  await expect(card.locator('[data-option-id="Split the change"]')).toHaveAttribute('aria-pressed', 'true');
  await card.locator('[data-testid="question-record-card-input"]').fill('my own words');
  expect(answers, 'choosing an option sends nothing').toBe(0);
  const sent = page.waitForRequest(req => req.method() === 'POST' && /\/questions\/[^/]+\/answer$/.test(req.url()));
  await card.locator(ANSWER).click();
  expect((await sent).postDataJSON()).toEqual({ option: 'Split the change', words: 'my own words' });
  await expect(card).toHaveAttribute('data-settled', 'true');
});

test('W3: while an answer is in flight, no button on the card can send a second one (a double press, another option, Answer)', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);

  const card = page.locator(CARD).first();
  // Hold the answer open, so the card is genuinely in flight when the second presses land.
  let answers = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(/\/questions\/[^/]+\/answer$/, async route => {
    if (route.request().method() === 'POST') answers++;
    await gate;
    await route.continue();
  });
  await answerWith(card, 'Wait for review');
  await expect.poll(() => answers, { timeout: 5000 }).toBe(1);
  // Every control on the card is off while the answer is in flight.
  for (const button of await card.locator('[data-option-id]').all()) await expect(button).toBeDisabled();
  await expect(card.locator(ANSWER)).toBeDisabled();
  // Second presses are refused: a disabled button takes no click, so force-clicking one must not send a second answer.
  await card.locator('[data-option-id]').nth(1).click({ force: true });
  await card.locator(ANSWER).click({ force: true });
  await card.locator(ANSWER).click({ force: true });
  await page.waitForTimeout(500);
  expect(answers, 'one answer for the whole sequence of presses').toBe(1);
  release();
  // Settled, the controls stay off.
  await expect(card).toHaveAttribute('data-settled', 'true');
  await expect(card.locator(ANSWER)).toBeDisabled();
});

// ---- witnesses 12, 15: a run's question answered in place, count line and badge fall ------------------------------

test('W12: answering with the recommended button settles the card in place; the count line and the badge drop, and a reload agrees', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-D', THREE_OPTIONS);
  await seedWaiting(page, 'LOCAL-S', ONE_OPTION);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 questions');
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('2 questions', { timeout: 15000 });

  const deep = page.locator(WAIT_CARD, { has: page.locator('[data-testid="question-record-card-task"]', { hasText: 'LOCAL-D' }) }).locator('[data-testid="question-record-card"]');
  // LIN-4551: the recommended option is the labelled one (Answer is the card's .btn--primary now).
  const recommended = deep.locator('[data-testid="question-record-card-option"][data-recommended="true"]');
  await expect(recommended, 'the recommended option is marked').toHaveCount(1, { timeout: 5000 });
  await recommended.click();
  await deep.locator(ANSWER).click();
  await expect(deep).toHaveAttribute('data-settled', 'true');
  await expect(deep.locator(FEEDBACK)).toHaveText('Answered. The run resumes with your answer.');
  await expect(page.locator(OPEN_CARD)).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('1 question');
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('1 question', { timeout: 15000 });

  await page.reload();
  await expect(page.locator(CARD)).toHaveCount(1);
  await expect(page.locator(COUNT)).toContainText('1 question');
});

test('W12b: answering a non-recommended option the same way; with the last card answered the count line part goes, and a reload hides the section', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  const card = page.locator(CARD).first();
  await answerWith(card, 'Ship it now');
  await expect(card).toHaveAttribute('data-settled', 'true');
  await expect(page.locator(OPEN_CARD)).toHaveCount(0);
  await expect(page.locator(`${COUNT} [data-tone="needs-you"]`)).toHaveCount(0);
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('0 questions', { timeout: 15000 });
  // LIN-4242: the owner's section and count line are hidden, not removed, so a question asked later can land in them.
  await page.reload();
  await expect(page.locator(SECTION)).toBeHidden();
  await expect(page.locator(WAIT_CARD)).toHaveCount(0);
});

// ---- witness 13: a failed answer keeps the card open; a retry settles it ------------------------------------------

test('W13: an answer the server could not record leaves the card open and counted, saying so; a retry settles it and the count drops', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-S', ONE_OPTION);
  await seedWaiting(page, 'LOCAL-D', ONE_OPTION);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 questions');

  let fail = true;
  await page.route(/\/questions\/[^/]+\/answer$/, route => {
    if (fail && route.request().method() === 'POST') return route.fulfill({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' });
    return route.continue();
  });
  const card = page.locator(WAIT_CARD, { has: page.locator('[data-testid="question-record-card-task"]', { hasText: 'LOCAL-S' }) }).locator('[data-testid="question-record-card"]');
  await answerWith(card, 'Yes');
  await expect(card.locator(FEEDBACK)).toHaveText('boom', { timeout: 15000 });
  await expect(card).not.toHaveAttribute('data-settled', 'true');
  await expect(card.locator(ANSWER)).toBeEnabled();
  await expect(page.locator(COUNT)).toContainText('2 questions');

  fail = false;
  await card.locator(ANSWER).click();
  await expect(card).toHaveAttribute('data-settled', 'true', { timeout: 15000 });
  await expect(page.locator(COUNT)).toContainText('1 question');
  await page.unroute(/\/questions\/[^/]+\/answer$/);
});

// ---- witness 14 retired (LIN-4563) ------------------------------------------------------------------------------------
// W14 answered a waiting task's card inside Home's in-page search and checked the Waiting copy settled with it. The search
// is retired, and nothing else on Home draws a second copy of a waiting task's card (the named context row's opened task
// draws none: W9b), so the case it guarded cannot arise on Home any more.

// ---- witnesses 9 (rendered Home: each task once), and the named context exception -----------------------------------

test('W9: no task is drawn twice on Home across its sections, a waiting task included', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-D', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(SECTION)).toBeVisible();

  const repeats = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('main [data-identifier]')) {
      const id = el.getAttribute('data-identifier');
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(repeats, 'a task is drawn in two places on Home').toEqual([]);
});

test('W9b: a started waiting task with a running child is the named context row: its card is in Waiting, the row is drawn once with no state words, and the count and badge match the cards', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-M', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('1 question');
  // One question, one card: the card for LOCAL-M is in Waiting.
  await expect(page.locator(WAIT_CARD, { has: page.locator('[data-testid="question-record-card-task"]', { hasText: 'LOCAL-M' }) })).toHaveCount(1);
  await expect(page.locator(WAIT_CARD)).toHaveCount(1);
  // The context row in Running is the only place the task is drawn outside Waiting, and it has no state words.
  const drawn = await page.locator('main [data-identifier="LOCAL-M"]').count();
  expect(drawn).toBe(1);
  await expect(page.locator('main [data-identifier="LOCAL-M"] [data-testid="issue-row-state"]'), 'the context row has no state words').toHaveCount(0);
  // Count line, badge and cards agree.
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('1 question', { timeout: 15000 });
  await expect(page.locator(COUNT)).toContainText('1 question');
});

// ---- witness 16 (browser): a viewer without run controls gets no Waiting section, no card and no ruling text -------------

test('W16: a viewer without run controls (a keyless owner) gets no Waiting section and no question card in the page', async ({ page, seedLocal }) => {
  // No runner key and no queue token, so the viewer has no run controls. The question has no run (runId null), so no dispatch
  // token is minted, because a live queue token would itself turn run controls on. The rulings feed is the control that the
  // question is there; the section must be off by the owner gate alone.
  await seedLocal({
    projects: [],
    issues: [{
      id: localSeedId(URL_KEY, 'm1'), identifier: 'LOCAL-M1', title: 'Task for the owner gate',
      state: { name: 'In Progress', type: 'started' }, createdAt: OLD,
    }],
  }, { runnerKey: false });
  const asks = 'Which for LOCAL-M1?';
  await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-M1', runId: null, asks });
  // The control: the question is open in the workspace and this viewer can read it (the rulings API lists it).
  const rulings = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
  expect(rulings.status()).toBe(200);
  expect(await rulings.text(), 'the open question exists for this viewer').toContain(asks);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(SECTION)).toHaveCount(0);
  await expect(page.locator('[data-testid="session-question-card"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="question-record-card-task"]')).toHaveCount(0);
  const html = await page.content();
  expect(html, 'no Waiting section in the page').not.toContain('data-testid="waiting-on-you"');
  // LIN-4242: the live fragment is owner-only by the same predicate: a 403, and no card text.
  const fragment = await page.request.get(`/workspace/${URL_KEY}/api/home-waiting`);
  expect(fragment.status(), 'the live fragment refuses a viewer without run controls').toBe(403);
  expect(await fragment.text()).not.toContain(asks);
});

// ---- witness 17: collapse persists across a reload; reset opens it ----------------------------------------------------
// LIN-4563: the in-page search that hid the section is retired, and "reset" moved to the Backlog page's control line. The
// folds it resets are the one stored state Home reads too, so a reset on Backlog opens Home's Waiting section.

test('W17: collapsing Waiting persists across reload, and Backlog\'s "reset folds" opens it', async ({ page }) => {
  await seedTree(page, { runnerKey: true });
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(SECTION)).toBeVisible();

  await page.locator(`${SECTION} [data-testid="waiting-header"]`).click();
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeHidden();
  await page.reload();
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeHidden();
  await expect(page.locator('.reset-view'), 'Home draws no reset').toHaveCount(0);
  await page.goto(`/workspace/${URL_KEY}/backlog`);
  await page.locator('[data-testid="backlog-reset"]').click();
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(`${SECTION} [data-testid="waiting-body"]`)).toBeVisible();
});
