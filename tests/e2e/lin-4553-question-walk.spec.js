/**
 * LIN-4553 (LIN-4546 piece 5): this piece's surfaces with questions as long as real ones (several hundred words with lists, three
 * or four options that are each a long sentence; lib/sample-data/question-workload.js), at 1280px and 390px:
 *
 *   - the Questions tab: no sideways scroll, and the card's lead and its first (recommended) option on the first screen;
 *   - the Runs tab: one waiting line, "3 questions waiting →";
 *   - the run page: no sideways scroll, the card names its task, and its steps' moments read in words; LIN-4555: the card leads the
 *     page, its lead and first option on the first screen;
 *   - Flight Companion's fold (its tool result mocked with the tool's own row shape, as tests/e2e/lin-4549-card-task-line.spec.js
 *     does; nothing calls a model): no sideways scroll, one frame (the card's), and the chosen option's highlight moves with
 *     the choice (late addition 1 of LIN-4546; tests/e2e/lin-4551-card-face.spec.js covers the other four hosts);
 *   - on all four, no raw task or person id and no ISO time in what a person reads.
 *
 * Seeded through tests/fixtures/local-harness.js; selectors through SELECTORS.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedLongQuestion } from '../fixtures/question-records.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';
import { longQuestion } from '../../lib/sample-data/question-workload.js';
import { SELECTORS } from '../helpers.js';

const Q = SELECTORS.questionCard;
const OBS = SELECTORS.observation;
const FC = SELECTORS.flightCompanion;
const OLD = '2020-01-01T00:00:00Z';
const TASKS = {
  'LOCAL-31': 'Questions tab: the card names its task',
  'LOCAL-32': 'Run page: the shared card, styled',
  'LOCAL-33': 'Flight Companion: the same card',
};
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

test.setTimeout(180000);

async function clear(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const seam of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache', 'clear-ticket-records']) {
    await page.request.get(`/test/${seam}?urlKey=${urlKey}`);
  }
}

/** Three Todo tasks, each with a long question asked by a run that carries the task's title. */
async function seed(page, seedLocal, urlKey) {
  await clear(page, urlKey);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4553', sortOrder: 0 }],
    issues: Object.entries(TASKS).map(([identifier, title], i) => ({
      id: id(identifier), identifier, title, projectId: id('proj'), sortOrder: i, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' },
    })),
  }, { runnerKey: true, features: { flightCompanion: true } });
  const runs = {};
  const questions = {};
  let variant = 0;
  for (const [ticket, title] of Object.entries(TASKS)) {
    runs[ticket] = await askingRun(page, urlKey, ticket, { title });
    questions[ticket] = await seedLongQuestion(page, urlKey, { ticket, title, runId: runs[ticket], variant: variant++ });
  }
  return { runs, questions };
}

/** Nothing raw in what a person reads: no task record id, no person id, no ISO time. */
async function expectNothingRaw(locator, where) {
  const text = await locator.innerText();
  expect(text, `${where}: no task record id`).not.toMatch(/\btask-[0-9a-f]{6,}\b/);
  expect(text, `${where}: no person id`).not.toMatch(/\bperson:/);
  expect(text, `${where}: no ISO time`).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
}

async function expectNoSidewaysScroll(page, where) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, `${where}: no sideways scroll`).toBe(false);
}

test('the Questions tab, the Runs line and the run page, with long questions, at 1280px and 390px', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { runs, questions } = await seed(page, seedLocal, urlKey);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const at = `${viewport.width}px`;

    await page.goto(`/workspace/${urlKey}/observation?view=questions`);
    const rows = page.locator(OBS.ruling.row);
    await expect(rows).toHaveCount(3);
    const first = rows.first().locator(Q.card);
    await expect(first.locator(Q.taskTitle)).toHaveText(TASKS['LOCAL-31']);
    await expectNoSidewaysScroll(page, `Questions tab at ${at}`);
    // The main action on the first screen: the card's one-line question and its first option, the recommended one.
    for (const [name, part] of [['lead', first.locator(Q.lead)], ['first option', first.locator(Q.option).first()]]) {
      const box = await part.boundingBox();
      expect(box, `Questions tab at ${at}: the ${name} has a box`).not.toBeNull();
      expect(box.y + box.height, `Questions tab at ${at}: the ${name} ends on the first screen`).toBeLessThanOrEqual(viewport.height);
    }
    await expect(first.locator(Q.option).first().locator(Q.recommended)).toBeVisible();
    await expectNothingRaw(page.locator(OBS.rulingsSection), `Questions tab at ${at}`);

    await page.goto(`/workspace/${urlKey}/observation`);
    await expect(page.locator(OBS.waitingQuestions)).toHaveText('3 questions waiting →');
    await expectNothingRaw(page.locator(OBS.waiting), `Runs line at ${at}`);
    await expectNoSidewaysScroll(page, `Runs at ${at}`);

    await page.goto(`/workspace/${urlKey}/observation/session/${runs['LOCAL-32']}`);
    const runCard = page.locator(SELECTORS.runPage.questions).locator(Q.byId(questions['LOCAL-32']));
    await expect(runCard.locator(Q.taskTitle)).toHaveText(TASKS['LOCAL-32']);
    await expectNoSidewaysScroll(page, `run page at ${at}`);
    // LIN-4555 (finding-9eafd4d6): the question leads the run page, so its lead and first (recommended) option are on the first
    // screen at 390px too; under the header strip the first option ended at about 1080px of an 844px screen.
    for (const [name, part] of [['lead', runCard.locator(Q.lead)], ['first option', runCard.locator(Q.option).first()]]) {
      const box = await part.boundingBox();
      expect(box, `run page at ${at}: the ${name} has a box`).not.toBeNull();
      expect(box.y + box.height, `run page at ${at}: the ${name} ends on the first screen`).toBeLessThanOrEqual(viewport.height);
    }
    await expectNothingRaw(runCard, `run page card at ${at}`);
    // The whole run page, not just the card: its steps print their moments in words (LIN-4553; they printed ISO times).
    await expectNothingRaw(page.locator(SELECTORS.runPage.page), `run page at ${at}`);
  }
});

test('Flight Companion\'s fold: one frame, a highlight that moves with the choice, nothing raw, at 1280px and 390px', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { questions } = await seed(page, seedLocal, urlKey);
  const long = longQuestion(2);
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const result = JSON.stringify({ count: 1, truncated: false, questions: [{
      questionId: questions['LOCAL-33'], question: long.asks, short: null, options: long.options, recommended: long.recommended,
      issueIdentifier: 'LOCAL-33', issueTitle: TASKS['LOCAL-33'], state: 'resumable', interactive: true,
    }] });
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: renderSSEFrames([['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result }], ['done', {}]]) });
  });
  await page.clock.install();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const at = `${viewport.width}px`;
    await page.goto(`/workspace/${urlKey}/flight-companion`);
    await page.clock.fastForward(30000);
    await page.locator(FC.decisionsSummary).click();
    // The fold names the thing a question, as the Questions tab and the Runs line do (LIN-4553).
    await expect(page.locator(FC.decisionsSummary)).toHaveText('1 question waiting');
    const row = page.locator(FC.question);
    const card = row.locator(Q.card);
    await expect(card.locator(Q.taskTitle)).toHaveText(TASKS['LOCAL-33']);
    await expectNoSidewaysScroll(page, `Flight Companion at ${at}`);
    await expectNothingRaw(card, `Flight Companion card at ${at}`);

    // One frame: the row around the card draws no border or fill of its own.
    const frame = await row.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, background: s.backgroundColor }; });
    expect(frame.border, `Flight Companion at ${at}: the row has no border`).toBe('0px');
    expect(frame.background, `Flight Companion at ${at}: the row has no fill`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    // The highlight moves: press the second option, then the third.
    const options = card.locator(Q.option);
    const look = (i) => options.nth(i).evaluate((el) => { const s = getComputedStyle(el); return `${s.backgroundColor}|${s.borderColor}`; });
    await page.mouse.move(0, 0);
    const resting = await look(1);
    await options.nth(1).click();
    await page.mouse.move(0, 0);
    await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'false');
    const pressed = await look(1);
    expect(pressed, `Flight Companion at ${at}: the pressed option looks pressed`).not.toBe(resting);
    await options.nth(2).click();
    await page.mouse.move(0, 0);
    await expect(options.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'false');
    expect(await look(2), `Flight Companion at ${at}: the highlight moves to the new choice`).toBe(pressed);
    expect(await look(1), `Flight Companion at ${at}: the old choice is back at rest`).toBe(resting);

    // LIN-4555 (the walk): the fold's link is styled as the site's links are, not the browser's default blue, and its summary
    // ("1 question waiting", words, not a machine fact) is in the page face, as the Runs line says it.
    const linkColor = await page.locator(FC.decisionsLink).evaluate((el) => getComputedStyle(el).color);
    expect(linkColor, `Flight Companion at ${at}: the fold's link is not the browser's default blue`).not.toBe('rgb(0, 0, 238)');
    const summaryFont = await page.locator(FC.decisionsSummary).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(summaryFont, `Flight Companion at ${at}: the fold's summary is not mono`).not.toMatch(/JetBrains|mono/i);
  }
});
