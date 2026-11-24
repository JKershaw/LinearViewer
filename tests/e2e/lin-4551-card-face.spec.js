/**
 * LIN-4551 (LIN-4546 piece 3/7), end to end: the card's face on every host that draws it, against the real pages.
 *
 *   1. Home, the rulings page, the task page and the run page: a question asked with no `short` (as every question before LIN-4550
 *      was) leads with the derived one-line question; the full ask sits in a closed fold that, opened, keeps its paragraphs and
 *      lists. On the same hosts, the options are full-width, left-aligned rows, the recommended one first and labelled
 *      "recommended".
 *   2. Hostile input in the ask (<script>, <img onerror>, a markdown link to javascript:) renders as text in the fold: no element,
 *      no link, no dialog.
 *   3. The chosen option has a visible pressed style: aria-pressed and the computed style both change on a press, and both move
 *      when another option is pressed (late addition 1). On all four hosts: the task page and the run page load their own sheets
 *      (task-page.css, session.css), and either could override the card's rules.
 *   4. A question a person dismissed in another tab: answering it on this card says "Dismissed" (late addition 2).
 *   5. A run still working: the card keeps its read-only words under the same lead and fold, with no control.
 *
 * Flight Companion draws the same leaf from a model's tool result; its face is the leaf's (tests/unit/lin-4551-card-face.test.js).
 * The seeds are tests/fixtures/question-records.js; the seeded long asks are lib/sample-data/question-workload.js.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, runningRun, seedLongQuestion, seedQuestion } from '../fixtures/question-records.js';
import { longQuestion } from '../../lib/sample-data/question-workload.js';
import { deriveQuestionShort } from '../../lib/records/question-short.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
const Q = SELECTORS.questionCard;
const TASKS = {
  'LOCAL-31': 'The card\'s face: one-line lead, the ask behind a fold, readable options',
  'LOCAL-32': 'A second task with a question',
};

test.setTimeout(150000);

async function clear(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
}

async function seedTasks(page, seedLocal, urlKey) {
  await clear(page, urlKey);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4551', sortOrder: 0 }],
    issues: Object.entries(TASKS).map(([identifier, title], i) => ({
      id: id(identifier), identifier, title, projectId: id('proj'), sortOrder: i, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' },
    })),
  }, { runnerKey: true });
}

/** Moves the pointer off every control, so a :hover rule never stands in for the pressed style. */
const pointerAway = (page) => page.mouse.move(0, 0);

/** The look of an option a person reads: its fill, its border and its ink. */
const lookOf = (locator) => locator.evaluate((el) => {
  const s = getComputedStyle(el);
  return { background: s.backgroundColor, border: s.borderColor, ink: s.color, outline: s.boxShadow };
});

/** The lead and the fold every host must draw for the seeded long question `variant`, asked with no `short`. */
async function expectLeadAndFold(card, variant) {
  const sample = longQuestion(variant);
  await expect(card.locator(Q.lead)).toHaveText(deriveQuestionShort(sample.asks));
  const fold = card.locator(Q.ask);
  await expect(fold).toHaveCount(1);
  expect(await fold.evaluate((el) => el.tagName), 'the full ask is a <details> fold').toBe('DETAILS');
  expect(await fold.evaluate((el) => el.open), 'the fold starts closed').toBe(false);
  await expect(card.locator(Q.askBody)).toBeHidden();
  await card.locator(Q.askSummary).click();
  await expect(card.locator(Q.askBody)).toBeVisible();
  expect(await card.locator(`${Q.askBody} > p`).count(), 'paragraphs are kept').toBeGreaterThanOrEqual(3);
  expect(await card.locator(`${Q.askBody} ul > li`).count(), 'the bulleted list is kept').toBeGreaterThanOrEqual(3);
  expect(await card.locator(`${Q.askBody} ol > li`).count(), 'the numbered list is kept').toBeGreaterThanOrEqual(2);
}

/** The option rows every host must draw for the seeded long question `variant`: full-width, left-aligned, recommended first. */
async function expectOptionRows(card, variant) {
  const sample = longQuestion(variant);
  const options = card.locator(Q.option);
  await expect(options).toHaveCount(sample.options.length);
  await expect(options.first()).toHaveAttribute('data-option-id', sample.recommended);
  await expect(options.first().locator(Q.recommended)).toHaveText('recommended');
  await expect(card.locator(Q.recommended)).toHaveCount(1);
  const group = await card.locator(Q.options).boundingBox();
  for (let i = 0; i < sample.options.length; i++) {
    const option = options.nth(i);
    const box = await option.boundingBox();
    expect(box.width, `option ${i} is a full-width row`).toBeGreaterThanOrEqual(group.width - 2);
    expect(await option.evaluate((el) => getComputedStyle(el).textAlign), `option ${i} reads left-aligned`).toMatch(/^(left|start)$/);
  }
}

/** Seeds LOCAL-31's question (no run) and LOCAL-32's (asked by a run), both long and with no `short`. */
async function seedLongPair(page, seedLocal, urlKey) {
  await seedTasks(page, seedLocal, urlKey);
  const runId = await askingRun(page, urlKey, 'LOCAL-32', { title: TASKS['LOCAL-32'] });
  const q31 = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-31', title: TASKS['LOCAL-31'], variant: 0 });
  const q32 = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-32', title: TASKS['LOCAL-32'], runId, variant: 1 });
  return { runId, q31, q32 };
}

/** Each host's card for the pair, with the variant it was seeded from: Home, the rulings page, the task page, the run page. */
const HOSTS = ({ urlKey, runId, q31, q32 }) => [
  { name: 'Home', path: `/workspace/${urlKey}/`, card: `${SELECTORS.waitingOnYou.question} ${Q.byId(q31)}`, variant: 0 },
  { name: 'the rulings page', path: `/workspace/${urlKey}/observation?view=rulings`, card: `[data-testid="ruling-question-row"] ${Q.byId(q32)}`, variant: 1 },
  { name: 'the task page', path: `/workspace/${urlKey}/task/LOCAL-31`, card: `[data-testid="task-page-question-records"] ${Q.byId(q31)}`, variant: 0 },
  { name: 'the run page', path: `/workspace/${urlKey}/observation/session/${runId}`, card: `[data-testid="session-question-records"] ${Q.byId(q32)}`, variant: 1 },
];

test('on Home, the rulings page, the task page and the run page: the derived lead and the closed fold that keeps the ask\'s shape', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const seeded = await seedLongPair(page, seedLocal, urlKey);
  for (const host of HOSTS({ urlKey, ...seeded })) {
    await test.step(host.name, async () => {
      await page.goto(host.path);
      await expectLeadAndFold(page.locator(host.card), host.variant);
    });
  }
});

test('at 390px an opened long ask wraps inside its card, on every host, with no sideways scroll', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedLongPair(page, seedLocal, urlKey);
  for (const host of HOSTS({ urlKey, ...seeded })) {
    await test.step(host.name, async () => {
      await page.goto(host.path);
      const card = page.locator(host.card);
      await expect(card.locator(Q.ask)).toHaveCount(1);
      await card.locator(Q.askSummary).click();
      await expect(card.locator(Q.askBody)).toBeVisible();
      const body = await card.locator(Q.askBody).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(body.scroll, 'the ask wraps inside the fold').toBeLessThanOrEqual(body.client);
      const box = await card.boundingBox();
      expect(box.x + box.width, 'the card fits the screen').toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(390);
    });
  }
});

test('on Home, the rulings page, the task page and the run page: the options are full-width rows, the recommended one first and labelled', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const seeded = await seedLongPair(page, seedLocal, urlKey);
  for (const host of HOSTS({ urlKey, ...seeded })) {
    await test.step(host.name, async () => {
      await page.goto(host.path);
      await expectOptionRows(page.locator(host.card), host.variant);
    });
  }
});

test('hostile input in the ask renders as text in the fold: no script, image or link, and no dialog', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seedTasks(page, seedLocal, urlKey);
  const asks = [
    'Which of these should the card show?',
    '',
    '<script>window.__lin4551 = 1; alert(1)</script>',
    '',
    '<img src=x onerror="window.__lin4551 = 2; alert(2)">',
    '',
    '- [click me](javascript:alert(3))',
  ].join('\n');
  const qid = await seedQuestion(page, urlKey, { ticket: 'LOCAL-31', runId: await askingRun(page, urlKey, 'LOCAL-31'), asks });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  await page.goto(`/workspace/${urlKey}/`);
  const card = page.locator(`${SELECTORS.waitingOnYou.question} ${Q.byId(qid)}`);
  await expect(card.locator(Q.lead)).toHaveText('Which of these should the card show?');
  await card.locator(Q.askSummary).click();
  const body = card.locator(Q.askBody);
  await expect(body).toBeVisible();
  await expect(body).toContainText('<script>window.__lin4551 = 1; alert(1)</script>');
  await expect(body).toContainText('<img src=x onerror="window.__lin4551 = 2; alert(2)">');
  await expect(body).toContainText('[click me](javascript:alert(3))');
  await expect(card.locator('script, img')).toHaveCount(0);
  await expect(body.locator('a')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lin4551 ?? null), 'nothing in the ask ran').toBeNull();
  expect(dialogs, 'no dialog opened').toEqual([]);
});

/** Presses options on `card` and checks aria-pressed and the computed look move with the choice. */
async function expectPressedMoves(page, card) {
  const options = card.locator(Q.option);
  await expect(options).toHaveCount(3);
  const [first, second, third] = [options.nth(0), options.nth(1), options.nth(2)];
  await pointerAway(page);
  const restFirst = await lookOf(first);
  const restSecond = await lookOf(second);

  await second.click();
  await pointerAway(page);
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(third).toHaveAttribute('aria-pressed', 'false');
  const pressed = await lookOf(second);
  expect(pressed, 'the pressed option looks pressed').not.toEqual(restSecond);
  expect(await lookOf(first), 'the others stay at rest').toEqual(restFirst);
  expect(restSecond, 'every option shares one style at rest (the recommended one is not the main button)').toEqual(restFirst);

  await third.click();
  await pointerAway(page);
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  expect(await lookOf(third), 'the highlight moves to the new choice').toEqual(pressed);
  expect(await lookOf(second), 'and leaves the old one').toEqual(restSecond);
}

/** The four hosts one question on LOCAL-31, asked by `runId`, shows on: each loads its own sheets (style.css, task-page.css, session.css). */
const ONE_QUESTION_HOSTS = ({ urlKey, runId, qid }) => [
  { name: 'Home', path: `/workspace/${urlKey}/`, card: `${SELECTORS.waitingOnYou.question} ${Q.byId(qid)}` },
  { name: 'the rulings page', path: `/workspace/${urlKey}/observation?view=rulings`, card: `[data-testid="ruling-question-row"] ${Q.byId(qid)}` },
  { name: 'the task page', path: `/workspace/${urlKey}/task/LOCAL-31`, card: `[data-testid="task-page-question-records"] ${Q.byId(qid)}` },
  { name: 'the run page', path: `/workspace/${urlKey}/observation/session/${runId}`, card: `[data-testid="session-question-records"] ${Q.byId(qid)}` },
];

test('the chosen option has a visible pressed style that moves with the choice, on Home, the rulings page, the task page and the run page', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seedTasks(page, seedLocal, urlKey);
  const options = ['Move the rules into style.css', 'Add a card sheet on each page', 'Load session.css on the other pages'];
  const runId = await askingRun(page, urlKey, 'LOCAL-31');
  const qid = await seedQuestion(page, urlKey, {
    ticket: 'LOCAL-31', runId, asks: 'Where should the card\'s rules live?', options, recommended: options[0], ifUnanswered: 'style.css',
  });
  for (const host of ONE_QUESTION_HOSTS({ urlKey, runId, qid })) {
    await test.step(host.name, async () => {
      await page.goto(host.path);
      await expectPressedMoves(page, page.locator(host.card));
    });
  }
});

test('Answer is the primary button and dismiss a quiet one, on Home, the rulings page, the task page and the run page', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seedTasks(page, seedLocal, urlKey);
  const runId = await askingRun(page, urlKey, 'LOCAL-31');
  const qid = await seedQuestion(page, urlKey, { ticket: 'LOCAL-31', runId });
  for (const host of ONE_QUESTION_HOSTS({ urlKey, runId, qid })) {
    await test.step(host.name, async () => {
      await page.goto(host.path);
      const card = page.locator(host.card);
      await pointerAway(page);
      const answer = await lookOf(card.locator(Q.answer));
      const dismiss = await lookOf(card.locator(Q.dismiss));
      await expect(card.locator(Q.answer)).toHaveClass(/\bbtn--primary\b/);
      expect(answer.background, 'Answer is filled').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(dismiss.background, 'dismiss is quiet: no fill').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    });
  }
});

test('a question dismissed in another tab: answering it on this card says "Dismissed"', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seedTasks(page, seedLocal, urlKey);
  const qid = await seedQuestion(page, urlKey, { ticket: 'LOCAL-31', runId: await askingRun(page, urlKey, 'LOCAL-31') });
  await page.goto(`/workspace/${urlKey}/`);
  const card = page.locator(`${SELECTORS.waitingOnYou.question} ${Q.byId(qid)}`);
  await expect(card).toHaveCount(1);

  const other = await page.request.post(`/workspace/${urlKey}/questions/${qid}/dismiss`, { data: {} });
  expect(other.status(), await other.text()).toBe(200);

  await card.locator(`${Q.option}[data-option-id="left"]`).click();
  await card.locator(Q.answer).click();
  await expect(card.locator(Q.feedback)).toHaveText(/^Dismissed\b/);
});

test('a run still working: the card keeps its read-only words under the same lead and fold, with no control', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seedTasks(page, seedLocal, urlKey);
  const runId = await runningRun(page, urlKey, 'LOCAL-31', { title: TASKS['LOCAL-31'] });
  const qid = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-31', title: TASKS['LOCAL-31'], runId, variant: 2 });
  await page.goto(`/workspace/${urlKey}/observation/session/${runId}`);
  const card = page.locator(`[data-testid="session-question-records"] ${Q.byId(qid)}`);
  await expect(card.locator(Q.readonly)).toHaveText('Harbour is still working; you can answer when it pauses.');
  for (const control of [Q.option, Q.input, Q.answer, Q.dismiss]) await expect(card.locator(control)).toHaveCount(0);
  await expect(card.locator(Q.lead)).toHaveText(deriveQuestionShort(longQuestion(2).asks));
  await expect(card.locator(Q.ask)).toHaveCount(1);
});
