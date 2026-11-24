/**
 * LIN-4552 (LIN-4546 piece 4/7): a quiet Home, end to end through the local harness, in a workspace shaped like a real one (a long
 * question, findings addressed to the owner: tests/fixtures/question-records.js).
 *
 * 1. "Waiting on you" is said once; the count line and the badge say "1 question"; the notes sit under "Notes for you", five
 *    before the fold, each naming its task by identifier and title.
 * 2. A refresh that brings a new note while the person types in a question card keeps the card (same node, words, focus) and
 *    adds the note once, without a reload (finding-d4767b81).
 * 3. Clearing a note takes the line out, and a reload shows it ended (the finding is no longer open).
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedLongQuestion, seedOwnerFindings } from '../fixtures/question-records.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
const TASKS = [
  { key: 'a', identifier: 'LOCAL-21', title: 'A quiet Home: said once, badge agrees' },
  { key: 'b', identifier: 'LOCAL-22', title: 'Notes for you below the questions' },
];
const Q = SELECTORS.questionCard;
const W = SELECTORS.waitingOnYou;

test.setTimeout(120000);

async function seed(page, seedLocal, urlKey, findings) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4552', sortOrder: 0 }],
    issues: TASKS.map((t, i) => ({
      id: id(t.key), identifier: t.identifier, title: t.title, projectId: id('proj'), sortOrder: i, createdAt: OLD,
      state: { name: 'Todo', type: 'unstarted' },
    })),
  }, { runnerKey: true });
  const ids = await seedOwnerFindings(page, urlKey, { findings, tasks: TASKS.map((t) => ({ ticket: t.identifier, title: t.title })) });
  const question = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-21', title: TASKS[0].title, variant: 0 });
  return { ids, question };
}

const refresh = (page) => page.evaluate(() => window.refreshWaitingOnYou());

test('said once, one number, and the notes below the questions with a fold after five', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await seed(page, seedLocal, urlKey, 8);
  await page.goto(`/workspace/${urlKey}/`);
  const main = page.locator('main');
  await expect(page.locator(W.header)).toHaveText(/Waiting on you/);
  // Home's own words: what the notes and cards quote is their writers' text (the seeded notes quote "Waiting on you"), not Home's.
  const homeWords = await page.evaluate(() => {
    const copy = document.querySelector('main').cloneNode(true);
    copy.querySelectorAll('[data-testid="waiting-note-says"], [data-testid="waiting-note-full"], [data-testid="question-record-card-question"], [data-testid="question-record-card-ask"]').forEach((el) => el.remove());
    return `${document.querySelector('nav')?.innerText || ''} ${copy.textContent}`;
  });
  expect(homeWords.match(/waiting on you/gi)?.length, '"Waiting on you" is said once on Home').toBe(1);
  await expect(page.locator(SELECTORS.homeCount.questions)).toHaveText('1 question');
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.evaluate((k) => window.updateRulingsBadge(k), urlKey);
  await expect(page.locator(SELECTORS.questionsBadge)).toHaveText('1 question');

  const notes = page.locator(`${W.notes} ${W.note}`);
  await expect(notes).toHaveCount(8);
  await expect(notes.filter({ visible: true })).toHaveCount(5);
  await expect(page.locator(W.notesMore)).toHaveText('show 3 more', { useInnerText: true });
  const first = notes.first();
  await expect(first.locator(W.noteTask)).toHaveAttribute('href', new RegExp(`/workspace/${urlKey}/task/LOCAL-2[12]`));
  await expect(first.locator(W.noteTask)).toContainText(/LOCAL-2[12] (A quiet Home|Notes for you below)/);
  // Nothing raw in what Home itself prints (a note's own prose is its writer's words, quoted as written).
  expect(homeWords).not.toMatch(/task-[0-9a-f]{8}|finding-[0-9a-f]{8}|person:|\d{4}-\d{2}-\d{2}T\d{2}:/);
  await page.locator(W.notesMore).click();
  await expect(notes.filter({ visible: true })).toHaveCount(8);
  await expect(page.locator(W.notesMore)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(W.notesMore)).toHaveText('show fewer', { useInnerText: true });

  // At a phone's width the notes wrap: no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'Home with notes is no wider than 390px').toBeLessThanOrEqual(0);
});

test('a new note arrives while the person types in a card: the card is kept and the note appears once', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { question } = await seed(page, seedLocal, urlKey, 2);
  await page.goto(`/workspace/${urlKey}/`);
  const card = page.locator(`${W.section} ${Q.byId(question)}`);
  await card.locator(Q.input).click();
  await card.locator(Q.input).pressSequentially('I would rather');
  await card.evaluate((el) => { el.dataset.e2eKept = 'yes'; });
  await expect(page.locator(W.note)).toHaveCount(2);

  const [added] = await seedOwnerFindings(page, urlKey, { findings: 1, tasks: [{ ticket: 'LOCAL-22', title: TASKS[1].title }] });
  await refresh(page);
  await refresh(page);

  await expect(page.locator(W.noteByRecord(added))).toHaveCount(1);
  await expect(page.locator(W.note)).toHaveCount(3);
  await expect(card).toHaveAttribute('data-e2e-kept', 'yes');
  await expect(card.locator(Q.input)).toHaveValue('I would rather');
  expect(await card.locator(Q.input).evaluate((el) => el === document.activeElement), 'focus stays in the card').toBe(true);
});

test('clearing a note takes its line out, and it stays gone after a reload', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { ids } = await seed(page, seedLocal, urlKey, 2);
  await page.goto(`/workspace/${urlKey}/`);
  const line = page.locator(W.noteByRecord(ids[0]));
  await expect(line).toHaveCount(1);
  await line.locator(W.noteClear).click();
  await expect(line).toHaveCount(0);
  await expect(page.locator(W.note)).toHaveCount(1);
  await expect(page.locator('[data-testid="home-desk-live"]')).toHaveText('Note cleared');
  await page.reload();
  await expect(page.locator(W.note)).toHaveCount(1);
  await expect(page.locator(W.noteByRecord(ids[0]))).toHaveCount(0);
});
