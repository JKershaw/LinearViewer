/**
 * LIN-4555 (finding-136c26f0): the server.js wiring that names a quoted person is exercised end to end.
 *
 * The PR claims that a person id an agent quotes reads as the person's name on Home (page and live fragment), the Questions feed,
 * the run page and the task page. Unit tests inject `listPeople` directly, and the walk's seeded account carries no name, so every
 * surface read "someone" with or without the wiring. Here the owner and a member both carry a name on their tracker identity (the
 * /test/seed-task-page-records seam), and a question quotes both ids. Each surface must show the names, never "someone".
 *
 * Mutations run against this spec (each turns it red, then reverted): deleting `listPeople` from the createWaitingStanding call
 * in server.js (Home page and live fragment), `listPeople` from the createDashboardRoutes call (the Questions page and the run
 * page), and `listPeople` from the createTaskPageRoutes call (the task page).
 *
 * Titles: the cards also assert the identifier and title, and the run page's title does depend on the dashboard routes'
 * `questionTaskTitles` (deleting it turns the run page red). Home's and the task page's lookups are NOT pinned here: Home reads the
 * held issue set first (warm once the workspace is seeded) and the task page its own task's title, so the lookup is never the
 * source in this harness. The lookup's own bounds are unit-tested (tests/unit/lin-4553-question-titles.test.js).
 *
 * Seeded through tests/fixtures/local-harness.js; selectors through SELECTORS.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';
import { SELECTORS } from '../helpers.js';

const Q = SELECTORS.questionCard;
const OLD = '2020-01-01T00:00:00Z';
const TITLE = 'Wiring: a quoted person reads as a name';
const OWNER = 'Sam Owner';
const MEMBER = 'Mia Member';

async function clear(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const seam of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache', 'clear-ticket-records']) {
    await page.request.get(`/test/${seam}?urlKey=${urlKey}`);
  }
}

/** Seeds the named people, the task and a question quoting both; answers what the surfaces need. */
async function seed(page, seedLocal, urlKey) {
  await clear(page, urlKey);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4555', sortOrder: 0 }],
    issues: [{ id: id('LOCAL-21'), identifier: 'LOCAL-21', title: TITLE, projectId: id('proj'), sortOrder: 0, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } }],
  }, { runnerKey: true, features: { flightCompanion: true } });
  const named = await page.request.post('/test/seed-task-page-records', { data: { urlKey, ticket: 'LOCAL-22', ownerName: OWNER, memberName: MEMBER } });
  expect(named.ok(), `named people seed failed: ${await named.text()}`).toBeTruthy();
  const { memberId } = await named.json();
  const { accountId } = await (await page.request.get('/test/session-account')).json();
  // The run carries its identifier as its title (askingRun's default), which a card reads as no title.
  const runId = await askingRun(page, urlKey, 'LOCAL-21');
  const questionId = await seedQuestion(page, urlKey, {
    ticket: 'LOCAL-21', runId,
    asks: `Should person:${memberId} review this, or should person:${accountId} keep it?`,
    options: ['Mia reviews', 'Sam keeps it'], recommended: 'Mia reviews',
  });
  return { runId, questionId };
}

/** The question's card, with its full-question fold opened when it has one (a one-sentence ask is the lead itself). */
async function openedCard(page, questionId) {
  const card = page.locator(Q.byId(questionId));
  await expect(card).toBeVisible();
  const fold = card.locator(Q.askSummary);
  if (await fold.count() && await fold.isVisible()) await fold.click();
  return card;
}

async function expectNamed(card) {
  const text = await card.innerText();
  expect(text, 'the quoted person ids read as the names').toContain(MEMBER);
  expect(text).toContain(OWNER);
  expect(text, 'a named person is never "someone"').not.toMatch(/someone/i);
  expect(text).not.toMatch(/\bperson:/);
}

async function expectTitled(card) {
  await expect(card.locator(Q.taskId)).toHaveText('LOCAL-21');
  await expect(card.locator(Q.taskTitle)).toHaveText(TITLE);
}

test('Home names the quoted people in its question', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { questionId } = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/`);
  await expect(page.locator(SELECTORS.waitingOnYou.section)).toBeVisible();
  const card = await openedCard(page, questionId);
  await expectNamed(card);
  await expectTitled(card);
});

test('the Questions page names the quoted people and titles the task', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { questionId } = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/observation?view=questions`);
  const card = await openedCard(page, questionId);
  await expectNamed(card);
  await expectTitled(card);
});

test('the run page names the quoted people and titles the task', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { runId, questionId } = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/observation/session/${runId}`);
  const card = await openedCard(page, questionId);
  await expectNamed(card);
  await expectTitled(card);
});

test('the task page names the quoted people in its question', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { questionId } = await seed(page, seedLocal, urlKey);
  await page.goto(`/workspace/${urlKey}/task/LOCAL-21`);
  const card = await openedCard(page, questionId);
  await expectNamed(card);
  await expectTitled(card);
});

test('Home\'s live fragment names the quoted people', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { questionId } = await seed(page, seedLocal, urlKey);
  const res = await page.request.get(`/workspace/${urlKey}/api/home-waiting`);
  expect(res.ok(), `fragment failed: ${await res.text()}`).toBeTruthy();
  const { html } = await res.json();
  await page.setContent(`<body>${html}</body>`);
  const card = page.locator(Q.byId(questionId));
  await expect(card).toHaveCount(1);
  await expectNamed(card);
  await expectTitled(card);
});
