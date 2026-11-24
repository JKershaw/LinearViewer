/**
 * LIN-4549 (LIN-4546 piece 1, finding-7a603e81): on Home, a question card the person is answering survives the live Waiting
 * refresh, by the one keep-a-card rule (public/question-records.js holdsCard), in a workspace shaped like a real one (a long
 * question, a handful of findings addressed to the owner: tests/fixtures/question-records.js).
 *
 * 1. Typing, an option chosen and focus held, then a refresh that brings a new question: the card is the same node, with its
 *    words, its chosen option and focus, and the new question appears exactly once.
 * 2. The same card answered elsewhere (dismissed through the route, as another tab would) while the person is typing in it: the
 *    refresh no longer lists it, and it stays under the reader's hands. Before the rule was one, Home's merge took out an
 *    unlisted card unless it was settled or had a control off, so the typed card went.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedLongQuestion, seedOwnerFindings } from '../fixtures/question-records.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
const TASKS = [
  { key: 'a', identifier: 'LOCAL-11', title: 'Foundation: one card that carries its own look, task line and hold rule' },
  { key: 'b', identifier: 'LOCAL-12', title: 'One keep-a-card-across-a-repaint rule for Home, Observation and the opened task' },
];
const Q = SELECTORS.questionCard;
const W = SELECTORS.waitingOnYou;

test.setTimeout(120000);

async function seed(page, seedLocal, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4549', sortOrder: 0 }],
    issues: TASKS.map((t, i) => ({
      id: id(t.key), identifier: t.identifier, title: t.title, projectId: id('proj'), sortOrder: i, createdAt: OLD,
      state: { name: 'Todo', type: 'unstarted' },
    })),
  }, { runnerKey: true });
  await seedOwnerFindings(page, urlKey, { findings: 6, tasks: TASKS.map((t) => ({ ticket: t.identifier, title: t.title })) });
  return seedLongQuestion(page, urlKey, { ticket: 'LOCAL-11', title: TASKS[0].title, variant: 0 });
}

/** Types in the card, chooses its second option, and leaves focus in its box. Marks the node so the test can tell it is kept. */
async function answerHalfway(page, card) {
  await card.locator(Q.option).nth(1).click();
  await card.locator(Q.input).click();
  await card.locator(Q.input).pressSequentially('I would rather');
  await card.evaluate((el) => { el.dataset.e2eKept = 'yes'; });
}

/** Runs one live refresh of Waiting on you (the function the rulings tick runs) and waits for it to finish. */
const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());

async function expectHeld(page, card) {
  await expect(card).toHaveAttribute('data-e2e-kept', 'yes');
  await expect(card.locator(Q.input)).toHaveValue('I would rather');
  await expect(card.locator(Q.pressedOption)).toHaveCount(1);
  await expect(card.locator(Q.option).nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await card.locator(Q.input).evaluate((el) => el === document.activeElement), 'focus is still in the card\'s box').toBe(true);
}

test('a card being answered survives a refresh that brings a new question, which appears once', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const first = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/`);
  const card = page.locator(`${W.section} ${Q.byId(first)}`);
  await expect(card).toBeVisible();
  await answerHalfway(page, card);

  const second = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-12', title: TASKS[1].title, variant: 1 });
  await refresh(page);

  await expectHeld(page, card);
  await expect(page.locator(`${W.section} ${Q.byId(second)}`)).toHaveCount(1);
  await expect(page.locator(`${W.section} ${W.question}`)).toHaveCount(2);
  // A second refresh draws nothing twice.
  await refresh(page);
  await expect(page.locator(`${W.section} ${Q.byId(second)}`)).toHaveCount(1);
  await expectHeld(page, card);
});

test('a card answered elsewhere while the person is typing in it stays under their hands', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const first = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/`);
  const card = page.locator(`${W.section} ${Q.byId(first)}`);
  await expect(card).toBeVisible();
  await answerHalfway(page, card);

  // Another tab dismisses it: the server no longer lists it as open.
  const dismissed = await page.request.post(`/workspace/${urlKey}/questions/${first}/dismiss`, { data: {} });
  expect(dismissed.ok(), `dismiss failed: ${await dismissed.text()}`).toBeTruthy();
  await refresh(page);

  await expectHeld(page, card);
});
