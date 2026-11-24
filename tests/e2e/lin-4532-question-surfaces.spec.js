/**
 * LIN-4532 (LIN-4529 P2b), end to end: every rulings surface shows an open question record and answers or dismisses it through
 * the one answer route and the one dismiss route (routes/question-answers.js), and the store holds what the answer wrote.
 *
 * Surfaces, each witnessed in a browser against the real pages:
 *   - Home, Waiting on you: the card under its task line; the count line and the nav badge include it; a question asked after
 *     the page loaded is drawn by the live refresh (finding-dca7ac9d);
 *   - the Rulings page (the observation page): the question row heads with its task identifier (finding-9221fb7a);
 *   - the task page: the question section, and the same question in the /state poll's `questionHtml`;
 *   - the run page: the question the run asked, pinned beside its steps;
 *   - a stopped asking run: the answer says it was not resumed, and the decision stands.
 *
 * Not here: Flight Companion's card and the chat tool answer path. Flight Companion's fold is drawn from a model's tool result,
 * and the spec makes no model call; its drawing is witnessed in the client suite, and the chat answer path is an open ruling
 * (LIN-4532 finding-6234e34d). The seed and the reads are in tests/fixtures/question-records.js.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import {
  askingRun, seedQuestion, stopRun, questionState, decisionFor, runnerTokenFor,
} from '../fixtures/question-records.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const WAITING_Q = `${SECTION} .waiting-question`;
const WAITING_QCARD = `${WAITING_Q} [data-testid="question-record-card"]`;
const COUNT = '[data-testid="in-progress-count"]';
const BADGE = '.rulings-badge .rulings-count';
const RESUMED = 'Answered. The run resumes with your answer.';
const NOT_RESUMED = 'Answered. The run was stopped, so it was not resumed.';
const DISMISSED = 'Dismissed. The run is told and takes its fallback.';

let URL_KEY;

test.setTimeout(180000);

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
});

/** A started charter with two Todo tasks under it, so LOCAL-S and LOCAL-D are real task pages. */
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

/** Runs one live refresh of Home's Waiting section (the function the rulings tick runs), and resolves when it has finished. */
const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());

/** The badge reads the rulings feed through a 5s cache: clear it and read the badge once. */
async function syncBadge(page) {
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  await page.evaluate((urlKey) => window.updateRulingsBadge(urlKey), URL_KEY);
}

/** The card for one question on a page, by its question id. */
const cardFor = (page, questionId, scope = '') => page.locator(`${scope} [data-testid="question-record-card"][data-question-id="${questionId}"]`);

/** Answers a card with its option and the person's own words, as the person does. */
async function answerCard(card, option, words) {
  await card.locator(`[data-option-id="${option}"]`).click();
  await card.locator('[data-testid="question-record-card-input"]').fill(words);
  await card.locator('[data-testid="question-record-card-answer"]').click();
}

test.describe('Home: Waiting on you draws the open question records', () => {
  test('a question is a card under its task line; the count and the badge include it; answering it writes a decision holding both', async ({ page }) => {
    await seedTree(page);
    const runId = await askingRun(page, URL_KEY, 'LOCAL-S');
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId });
    await page.goto(`/workspace/${URL_KEY}/`);

    await expect(page.locator(WAITING_QCARD)).toHaveCount(1);
    await expect(page.locator(`${WAITING_Q} [data-testid="question-record-card-task"]`)).toContainText('LOCAL-S');
    await expect(page.locator(COUNT)).toContainText('1 waiting on you');
    await syncBadge(page);
    await expect(page.locator(BADGE)).toHaveText('1');

    const card = cardFor(page, qid, WAITING_Q);
    await answerCard(card, 'right', 'take the right one, it touches less');
    await expect(card.locator('[data-testid="question-record-card-feedback"]')).toHaveText(RESUMED);
    await expect(card).toHaveAttribute('data-settled', 'true');

    const decision = await decisionFor(page, URL_KEY, qid);
    expect(decision, 'the answer wrote a decision for the question').not.toBeNull();
    expect(decision.fields.answer).toBe('right');
    expect(decision.fields.words).toBe('take the right one, it touches less');
    expect(await questionState(page, URL_KEY, qid)).toBe('answered');
  });

  test('dismissing a question ends it dismissed (LIN-4550), and the card says the run takes its fallback', async ({ page }) => {
    await seedTree(page);
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-D', runId: await askingRun(page, URL_KEY, 'LOCAL-D') });
    await page.goto(`/workspace/${URL_KEY}/`);
    const card = cardFor(page, qid, WAITING_Q);
    await card.locator('[data-testid="question-record-card-dismiss"]').click();
    await expect(card.locator('[data-testid="question-record-card-feedback"]')).toHaveText(DISMISSED);
    expect(await questionState(page, URL_KEY, qid)).toBe('dismissed');
  });

  test('a question asked after the page loaded gets its card on the live refresh, without a reload (finding-dca7ac9d)', async ({ page }) => {
    await seedTree(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await expect(page.locator(WAITING_QCARD)).toHaveCount(0);

    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId: await askingRun(page, URL_KEY, 'LOCAL-S') });
    await refresh(page);
    await expect(cardFor(page, qid, WAITING_Q)).toHaveCount(1);
    await expect(page.locator(`${WAITING_Q} [data-testid="question-record-card-task"]`)).toContainText('LOCAL-S');
    await expect(page.locator(COUNT)).toContainText('1 waiting on you');
    await expect(page.locator(SECTION)).toBeVisible();
  });

  test('a stopped asking run: the answer says it was not resumed, and the decision stands', async ({ page }) => {
    await seedTree(page);
    const runId = await askingRun(page, URL_KEY, 'LOCAL-S');
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId });
    await stopRun(page, URL_KEY, runId, 'LOCAL-S');
    await page.goto(`/workspace/${URL_KEY}/`);
    const card = cardFor(page, qid, WAITING_Q);
    await answerCard(card, 'left', 'left, and do not resume it');
    await expect(card.locator('[data-testid="question-record-card-feedback"]')).toHaveText(NOT_RESUMED);
    expect((await decisionFor(page, URL_KEY, qid))?.fields.answer).toBe('left');
  });

  test('LIN-4541: a stale DECISION: post is refused 422 naming the records route; Home, the badge and the Rulings page agree on the one question', async ({ page }) => {
    // The old ruling path is gone: a runner posting a decision entry is refused out loud, and stores nothing, so the only
    // ruling there is to count is the question record. Home's count, the badge and the Rulings page read the same one.
    await seedTree(page);
    const staleRun = await askingRun(page, URL_KEY, 'LOCAL-S');
    const token = await runnerTokenFor(page, URL_KEY);
    const stale = await page.request.post(`/api/dispatch/feedback/${staleRun}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { kind: 'decision', message: JSON.stringify({ decision_id: 'd-stale', question: 'Which way?', options: [{ id: 'a', label: 'A' }] }) },
    });
    expect(stale.status()).toBe(422);
    expect((await stale.json()).code).toBe('DECISION_FEEDBACK_RETIRED');
    expect((await stale.json()).error).toContain('POST /api/proxy/records');

    await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-D', runId: await askingRun(page, URL_KEY, 'LOCAL-D') });
    await page.goto(`/workspace/${URL_KEY}/`);
    await expect(page.locator(COUNT)).toContainText('1 waiting on you');
    await expect(page.locator(WAITING_QCARD)).toHaveCount(1);
    await syncBadge(page);
    await expect(page.locator(BADGE)).toHaveText('1');

    await page.goto(`/workspace/${URL_KEY}/observation`);
    await page.locator('[data-testid="obs-tab-rulings"]').click();
    await expect(page.locator('[data-testid="ruling-question-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="ruling-question-row"] [data-testid="question-record-card-question"]')).toHaveText('Which way?');
  });
});

test.describe('the Rulings page shows the question row with its task', () => {
  test('a question row heads with its task identifier, and answers with option and words', async ({ page }) => {
    await seedTree(page);
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId: await askingRun(page, URL_KEY, 'LOCAL-S') });
    await page.goto(`/workspace/${URL_KEY}/observation`);
    const row = page.locator('[data-testid="ruling-question-row"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-testid="question-record-card-task-id"]')).toHaveText('LOCAL-S');
    await answerCard(cardFor(page, qid, '[data-testid="ruling-question-row"]'), 'left', 'left it is');
    await expect(row.locator('[data-testid="question-record-card-feedback"]')).toHaveText(RESUMED);
    expect((await decisionFor(page, URL_KEY, qid))?.fields.words).toBe('left it is');
  });
});

test.describe('the task page shows the question on its task', () => {
  test('the question section carries the card, answers it, and the /state poll carries the same question', async ({ page }) => {
    await seedTree(page);
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-D', runId: await askingRun(page, URL_KEY, 'LOCAL-D') });
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-D`);
    const section = '[data-testid="task-page-question-records"]';
    await expect(page.locator(`${section} [data-testid="question-record-card"]`)).toHaveCount(1);
    await expect(cardFor(page, qid, section)).toHaveCount(1);

    // The poll repaints the section from the same reader, so a question on the task rides in `questionHtml`.
    const state = await page.request.get(`/workspace/${URL_KEY}/api/task/LOCAL-D/state`);
    expect(state.ok()).toBeTruthy();
    expect((await state.json()).questionHtml).toContain(`data-question-id="${qid}"`);

    await answerCard(cardFor(page, qid, section), 'right', 'right, for this task');
    await expect(cardFor(page, qid, section).locator('[data-testid="question-record-card-feedback"]')).toHaveText(RESUMED);
    expect((await decisionFor(page, URL_KEY, qid))?.fields.answer).toBe('right');
  });
});

test.describe('the run page pins the questions its run asked', () => {
  test('the run\'s question is pinned beside its steps and answers through the one route', async ({ page }) => {
    await seedTree(page);
    const runId = await askingRun(page, URL_KEY, 'LOCAL-S');
    const qid = await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${runId}`);
    const pinned = '[data-testid="session-question-records"]';
    await expect(cardFor(page, qid, pinned)).toHaveCount(1);
    await answerCard(cardFor(page, qid, pinned), 'left', 'left, from the run page');
    await expect(cardFor(page, qid, pinned).locator('[data-testid="question-record-card-feedback"]')).toHaveText(RESUMED);
    expect((await decisionFor(page, URL_KEY, qid))?.fields.words).toBe('left, from the run page');
  });
});
