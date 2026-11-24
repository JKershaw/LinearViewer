/**
 * LIN-4242 — Home's "Waiting on you" refreshes live, end to end through the local harness.
 *
 * A ruling raised after Home loaded gets its card on the next refresh; a card answered elsewhere leaves; a half-typed
 * answer on a card that is still open survives the refresh (the same node, its text intact); the section and count line
 * are hidden, not removed, when the set is empty. The refresh is `window.refreshWaitingOnYou()`, the same function the
 * rulings tick runs, so the tests need no timed waits: each step waits on the page's own state.
 *
 * LIN-4538 (P7a): what waits is an open question record a run asked the person, which is what Home reads now. It is seeded
 * through tests/fixtures/question-records.js (a run parked on `[blocked]`, then the question it asked). A question card is
 * answered by choosing an option and pressing Answer, and a card answered on this page stays, settled, out of the count
 * (LIN-4532, lib/question-record-card.js); a card answered elsewhere leaves on the next refresh.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';

const OLD = '2020-01-01T00:00:00Z';
const SECTION = '[data-testid="waiting-on-you"]';
const CARD = `${SECTION} [data-testid="question-record-card"]`;
const OPEN_CARD = `${CARD}:not([data-settled="true"])`;
const WAIT_CARD = `${SECTION} .waiting-question`;
const COUNT = '[data-testid="in-progress-count"]';
const LIVE = '[data-testid="home-desk-live"]';
const BADGE = '.rulings-badge .rulings-count';
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

/** A run on `identifier` parked on `[blocked]`, and the open question it asked the person. Returns the question id. */
async function seedWaiting(page, identifier, { options, recommended }) {
  if (!RUNNER_TOKEN) RUNNER_TOKEN = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
  const runId = await askingRun(page, URL_KEY, identifier, { token: RUNNER_TOKEN });
  return seedQuestion(page, URL_KEY, { ticket: identifier, runId, asks: `Which for ${identifier}?`, options, recommended });
}

/** Answer one question card as the person does: choose the option, then press Answer (lib/question-record-card.js). */
async function answerWith(card, option) {
  await card.locator(`[data-option-id="${option}"]`).click();
  await card.locator('[data-testid="question-record-card-answer"]').click();
}

/** Runs one refresh on the page and resolves when it has finished (the function returns its promise). */
const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());

/**
 * The badge reads the rulings feed through the 5s cache, so it only moves on the interval. Clear the cache and read the
 * badge once, so the assertion waits on this read and on no interval.
 */
async function syncBadge(page) {
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  await page.evaluate((urlKey) => window.updateRulingsBadge(urlKey), URL_KEY);
}

const waitingCard = (page, identifier) => page.locator(WAIT_CARD, {
  has: page.locator('[data-testid="question-record-card-task"]', { hasText: identifier }),
});
const cardOf = (page, identifier) => waitingCard(page, identifier).locator('[data-testid="question-record-card"]');

/** Another tab answers `identifier`'s question; this page's copy stays until it refreshes. */
async function answerElsewhere(context, identifier, option) {
  const elsewhere = await context.newPage();
  await elsewhere.goto(`/workspace/${URL_KEY}/`);
  await answerWith(cardOf(elsewhere, identifier), option);
  await expect(cardOf(elsewhere, identifier)).toHaveAttribute('data-settled', 'true', { timeout: 15000 });
  await elsewhere.close();
}

test('a question asked after load gets its card on refresh; the count line and badge agree; answering it takes it out of both', async ({ page }) => {
  await seedTree(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  // Nothing waiting: the owner's section is on the page, hidden, and the count line has no waiting part.
  await expect(page.locator(SECTION)).toBeHidden();
  await expect(page.locator(CARD)).toHaveCount(0);

  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await refresh(page);
  // The fragment's task line takes its title from the held task facts (lib/open-questions.js `titlesFromIssues` over `taskFacts.read`), not the dispatch's issueTitle.
  // Witness: force the route's titles off → the line reads the seeded issueTitle `LOCAL-S`.
  await expect(waitingCard(page, 'LOCAL-S').locator('[data-testid="question-record-card-task-title"]')).toHaveText('Solo task, Todo');
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);
  await expect(page.locator(SECTION)).toBeVisible();
  await expect(page.locator(COUNT)).toContainText('1 question');
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('1 question');

  // Answered here: the card stays, settled with its outcome, and leaves the count line and the badge.
  await answerWith(cardOf(page, 'LOCAL-S'), 'Wait for review');
  await expect(cardOf(page, 'LOCAL-S')).toHaveAttribute('data-settled', 'true');
  await expect(page.locator(OPEN_CARD)).toHaveCount(0);
  await expect(page.locator(`${COUNT} [data-tone="needs-you"]`)).toHaveCount(0);
  await syncBadge(page);
  await expect(page.locator(BADGE)).toHaveText('0 questions');

  // One to zero to one: a new question lands in the section and the count line.
  await seedWaiting(page, 'LOCAL-D', THREE_OPTIONS);
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-D')).toHaveCount(1);
  await expect(page.locator(SECTION)).toBeVisible();
  await expect(page.locator(COUNT)).toContainText('1 question');
});

test('a card answered elsewhere leaves on refresh and says so; a half-typed answer on a card still open survives as the same node', async ({ page, context }) => {
  await seedTree(page);
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await seedWaiting(page, 'LOCAL-D', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator(COUNT)).toContainText('2 questions');

  const typed = cardOf(page, 'LOCAL-S').locator('[data-testid="question-record-card-input"]');
  await typed.fill('half a sentence about the solo task');
  await typed.focus();
  // Mark the kept card's node: a refresh that re-renders it would drop the mark.
  await cardOf(page, 'LOCAL-S').evaluate(el => { el.dataset.keepMark = 'yes'; });

  // The other tab answers LOCAL-D. This page's copy is still there until it refreshes.
  await answerElsewhere(context, 'LOCAL-D', 'Split the change');

  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-D')).toHaveCount(0);
  await expect(page.locator(LIVE)).toHaveText('Answered elsewhere');
  await expect(page.locator(COUNT)).toContainText('1 question');
  await expect(typed).toHaveValue('half a sentence about the solo task');
  await expect(typed).toBeFocused();
  await expect(page.locator(`${SECTION} [data-keep-mark="yes"]`)).toHaveCount(1);
});

test('a stale card that answers a settled question is refused, says so, and leaves with "Answered elsewhere" on the next refresh', async ({ page, context }) => {
  await seedTree(page);
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);

  await answerElsewhere(context, 'LOCAL-S', 'Ship it now');

  // This page still shows the card (no refresh yet). Its answer is refused as settled (the route's 409): the card says so and
  // is not settled by this page, so it claims no answer of its own.
  await answerWith(cardOf(page, 'LOCAL-S'), 'Wait for review');
  // LIN-4551: the refusal names how the question ended (`ended: answered`), so the card says it was answered elsewhere rather than
  // the old "answered or dismissed".
  await expect(cardOf(page, 'LOCAL-S').locator('[data-testid="question-record-card-feedback"]')).toHaveText('Answered elsewhere; there is nothing left to send.');
  await expect(cardOf(page, 'LOCAL-S')).not.toHaveAttribute('data-settled', 'true');
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(0);
  await expect(page.locator(LIVE)).toHaveText('Answered elsewhere');
  await expect(page.locator('body')).not.toContainText('reply failed');
});

test('a refresh requested before a question was answered here does not replace its settled card', async ({ page }) => {
  // Witness: let mergeWaitingCards replace a card the server still lists → the held response swaps in an open, unsettled copy.
  await seedTree(page);
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);

  // The first refresh's response is read now, while LOCAL-S is still open, and handed to the page only after the answer.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/home-waiting', async route => {
    requests += 1;
    if (requests !== 1) return route.continue();
    const real = await route.fetch();
    await held;
    return route.fulfill({ response: real });
  });
  const pending = refresh(page);
  await answerWith(cardOf(page, 'LOCAL-S'), 'Wait for review');
  await expect(cardOf(page, 'LOCAL-S')).toHaveAttribute('data-settled', 'true');
  release();
  await pending;
  // Read once, straight after the merge: a retrying expect would give the next 5s tick time to change the section.
  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="waiting-on-you"] .waiting-question').length,
    open: document.querySelectorAll('[data-testid="waiting-on-you"] .waiting-question [data-testid="question-record-card"]:not([data-settled="true"])').length,
    waitingPart: !!document.querySelector('[data-testid="in-progress-count"] [data-tone="needs-you"]'),
  }));
  expect(after).toEqual({ cards: 1, open: 0, waitingPart: false });
  await page.unroute('**/api/home-waiting');
});

test('a card whose answer is in flight survives a refresh that no longer lists it, as the same node', async ({ page }) => {
  // Witness: drop the hold exception in mergeWaitingCards' removal (`holds`, public/question-records.js holdsCard) → the card is removed while its answer is out.
  await seedTree(page);
  await seedWaiting(page, 'LOCAL-S', THREE_OPTIONS);
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);
  await cardOf(page, 'LOCAL-S').evaluate(el => { el.dataset.keepMark = 'yes'; });

  // Hold this card's answer until the refresh below has run.
  let releaseAnswer;
  const answerHeld = new Promise(resolve => { releaseAnswer = resolve; });
  await page.route('**/questions/*/answer', async route => {
    await answerHeld;
    return route.continue();
  });
  // The server's section no longer lists LOCAL-S (its answer is recorded elsewhere, say).
  await page.route('**/api/home-waiting', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ html: '<div class="waiting-body" data-testid="waiting-body"></div>', count: 0 }),
  }));

  await answerWith(cardOf(page, 'LOCAL-S'), 'Wait for review');
  await expect(cardOf(page, 'LOCAL-S').locator('[data-testid="question-record-card-answer"]')).toBeDisabled();
  await refresh(page);
  await expect(waitingCard(page, 'LOCAL-S')).toHaveCount(1);
  await expect(page.locator(`${SECTION} [data-keep-mark="yes"]`)).toHaveCount(1);
  await expect(page.locator(LIVE)).not.toHaveText('Answered elsewhere');

  releaseAnswer();
  await expect(cardOf(page, 'LOCAL-S')).toHaveAttribute('data-settled', 'true', { timeout: 15000 });
  await expect(page.locator(`${SECTION} [data-keep-mark="yes"]`)).toHaveCount(1);
  await page.unroute('**/questions/*/answer');
  await page.unroute('**/api/home-waiting');
});

test('one refresh is in flight at a time: calls made while it is out share one queued follow-up', async ({ page }) => {
  // Witness: drop the single-flight guard in refreshWaitingOnYou → three requests reach the server, not two.
  await seedTree(page);
  await page.goto(`/workspace/${URL_KEY}/`);
  let requests = 0;
  let firstArrived;
  const arrived = new Promise(resolve => { firstArrived = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/home-waiting', async route => {
    requests += 1;
    if (requests !== 1) return route.continue();
    firstArrived();
    const real = await route.fetch();
    await held;
    return route.fulfill({ response: real });
  });
  const all = page.evaluate(() => Promise.all([window.refreshWaitingOnYou(), window.refreshWaitingOnYou(), window.refreshWaitingOnYou()]));
  await arrived;
  release();
  await all;
  expect(requests).toBe(2);
  await page.unroute('**/api/home-waiting');
});

test.describe('the opened task keeps its typed question across a state repaint (keepTypedQuestion)', () => {
  const OPENED_CARD = '[data-question-slot] [data-testid="question-record-card"]';
  const OPENED_INPUT = `${OPENED_CARD} [data-testid="question-record-card-input"]`;
  const STATE_URL = '**/api/task/LOCAL-S/state**';

  /**
   * Home with LOCAL-S started and running (a session taken, no question yet), opened, and the page clock held, so the
   * opened task's 10s state poll runs only when the test says. Then the worker asks a question and one poll paints it.
   * A task with an open question is not a Home row (it is Waiting on you), so the task is opened before the question exists.
   */
  async function openRunningThenRaise(page) {
    const started = await page.request.post('/test/set-local-session', {
      data: { urlKey: URL_KEY, runnerKey: true, openRouterConnected: false, projects: [{ id: localSeedId(URL_KEY, 'proj-0'), name: 'Project 0', content: 'Seeded', sortOrder: 0 }],
        issues: [{ id: localSeedId(URL_KEY, 'solo'), identifier: 'LOCAL-S', title: 'Solo task, started', description: 'Seeded task', projectId: localSeedId(URL_KEY, 'proj-0'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } }] },
    });
    expect(started.ok()).toBeTruthy();
    // After the seed: a seed resets the key's tokens.
    const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
    const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-S', issueTitle: 'LOCAL-S', target: 'cli' },
    });
    expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
    const itemId = (await res.json()).item.id;
    expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
    const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data });

    await page.clock.install();
    await page.goto(`/workspace/${URL_KEY}/`);
    const row = page.locator('[data-top-task="1"]').first();
    await expect(row).toBeVisible();
    if (!(await page.locator('.opened-task').first().isVisible())) await row.click();
    await expect(page.locator('.opened-task').first()).toBeVisible();

    expect((await feedback({ message: '[blocked] which way?' })).status()).toBe(200);
    await seedQuestion(page, URL_KEY, { ticket: 'LOCAL-S', runId: itemId, asks: 'Which for LOCAL-S?', ...THREE_OPTIONS });
    await pollOnce(page);
    await expect(page.locator(OPENED_INPUT)).toHaveCount(1);
  }

  /** One state poll of the opened task: advance the held clock past the 10s beat and wait for the read to be painted. */
  async function pollOnce(page) {
    const read = page.waitForResponse(r => /\/api\/task\/LOCAL-S\/state/.test(r.url()));
    await page.clock.runFor(10000);
    await read;
    // The paint follows the response in a later task: let it run, with the clock still held.
    await page.evaluate(() => new Promise(resolve => { const c = new MessageChannel(); c.port1.onmessage = resolve; c.port2.postMessage(0); }));
  }

  /** The next state read carries the card with `edit` applied to its markup. */
  async function editNextStateCard(page, edit) {
    await page.route(STATE_URL, async route => {
      const real = await route.fetch();
      const body = await real.json();
      if (body.questionHtml) body.questionHtml = edit(body.questionHtml);
      return route.fulfill({ response: real, json: body });
    });
  }

  test('a card whose markup changed is kept for the same question while it holds typed text', async ({ page }) => {
    // Witness: drop `|| keepsPlace` from keepTypedQuestion → the repaint writes the new card and the typed text is gone.
    await openRunningThenRaise(page);
    await page.locator(OPENED_INPUT).fill('half a sentence in the opened task');
    // fill() leaves the textarea focused, and focus alone keeps a card (holdsCard). Blur first, so this test
    // witnesses the typed text and not the focus: the card must hold no focus when the poll paints.
    await page.locator(OPENED_INPUT).blur();
    expect(await page.evaluate(() => !document.querySelector('[data-question-slot] [data-testid="question-record-card"]').contains(document.activeElement))).toBe(true);
    await page.locator(OPENED_CARD).evaluate(el => { el.dataset.keepMark = 'yes'; });

    await editNextStateCard(page, html => html.replace('data-testid="question-record-card"', 'data-testid="question-record-card" data-repainted="yes"'));
    await pollOnce(page);

    await expect(page.locator(OPENED_INPUT)).toHaveValue('half a sentence in the opened task');
    await expect(page.locator(`${OPENED_CARD}[data-keep-mark="yes"]`)).toHaveCount(1);
    await expect(page.locator(`${OPENED_CARD}[data-repainted="yes"]`)).toHaveCount(0);
  });

  test('a focused card with nothing typed keeps its focus through a state repaint (LIN-4246)', async ({ page }) => {
    // Witness: drop the focus capture in paintState, or the restore after the card is moved back → the card is replaced
    // (its mark is gone) or the textarea is left blurred. Nothing is typed here, so focus is the only thing that can keep it.
    await openRunningThenRaise(page);
    await page.locator(OPENED_INPUT).focus();
    await expect(page.locator(OPENED_INPUT)).toBeFocused();
    await page.locator(OPENED_CARD).evaluate(el => { el.dataset.keepMark = 'yes'; });

    await editNextStateCard(page, html => html.replace('data-testid="question-record-card"', 'data-testid="question-record-card" data-repainted="yes"'));
    await pollOnce(page);

    await expect(page.locator(OPENED_INPUT)).toBeFocused();
    await expect(page.locator(`${OPENED_CARD}[data-keep-mark="yes"]`)).toHaveCount(1);
    await expect(page.locator(`${OPENED_CARD}[data-repainted="yes"]`)).toHaveCount(0);
  });

  test('a different question\'s card replaces the typed one: the question key gates the keep', async ({ page }) => {
    // Witness: drop the key comparison in keepTypedQuestion (prompt-section.js) → the typed card of the old question is kept over the new one.
    await openRunningThenRaise(page);
    await page.locator(OPENED_INPUT).fill('an answer to the first question');
    await page.locator(OPENED_CARD).evaluate(el => { el.dataset.keepMark = 'yes'; });

    await editNextStateCard(page, html => html.replace(/data-question-id="[^"]*"/, 'data-question-id="question-another"'));
    await pollOnce(page);

    await expect(page.locator(`${OPENED_CARD}[data-question-id="question-another"]`)).toHaveCount(1);
    await expect(page.locator(`${OPENED_CARD}[data-keep-mark="yes"]`)).toHaveCount(0);
    await expect(page.locator(OPENED_INPUT)).toHaveValue('');
  });
});
