/**
 * LIN-4549 (LIN-4546 piece 1, LIN-4162): the shared question card draws its own task line on every host: the task's identifier in
 * mono, then its title in the page face, and the identifier shows once per card (the hosts' own task lines are gone). A task whose
 * title the host's source does not know reads as its identifier alone.
 *
 * Hosts: Home's Waiting on you, the rulings page, the task page, the run page, Home's opened task, and Flight Companion. Flight
 * Companion's fold comes from a model's tool result, so its turn is mocked with the tool's own row shape (as
 * tests/e2e/flight-companion.spec.js does); nothing calls a model.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedLongQuestion, seedQuestion } from '../fixtures/question-records.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
const Q = SELECTORS.questionCard;
const TASKS = {
  'LOCAL-11': 'Foundation: one card that carries its own look, task line and hold rule',
  'LOCAL-12': 'One keep-a-card-across-a-repaint rule for Home, Observation and the opened task',
};

test.setTimeout(120000);

async function clear(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
}

/** Two Todo tasks; LOCAL-12's question asked by a run that carries the task's title, LOCAL-11's asked with no run. */
async function seed(page, seedLocal, urlKey) {
  await clear(page, urlKey);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4549', sortOrder: 0 }],
    issues: Object.entries(TASKS).map(([identifier, title], i) => ({
      id: id(identifier), identifier, title, projectId: id('proj'), sortOrder: i, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' },
    })),
  }, { runnerKey: true, features: { flightCompanion: true } });
  const runId = await askingRun(page, urlKey, 'LOCAL-12', { title: TASKS['LOCAL-12'] });
  const q11 = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-11', title: TASKS['LOCAL-11'], variant: 0 });
  const q12 = await seedLongQuestion(page, urlKey, { ticket: 'LOCAL-12', title: TASKS['LOCAL-12'], runId, variant: 1 });
  return { runId, q11, q12 };
}

/** The card's task line reads `identifier` then `title` (or the identifier alone), and the identifier shows once in `scope`. */
async function expectTaskLine(scope, card, identifier, title) {
  await expect(card.locator(Q.taskId)).toHaveText(identifier);
  if (title) await expect(card.locator(Q.taskTitle)).toHaveText(title);
  else await expect(card.locator(Q.taskTitle)).toHaveCount(0);
  await expect(scope.getByText(identifier, { exact: true })).toHaveCount(1);
  expect(await card.locator(Q.taskId).evaluate((el) => getComputedStyle(el).fontFamily), 'the identifier is mono').toMatch(/JetBrains Mono/);
}

test('Home, the rulings page, the task page and the run page: the card names its task, once', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { runId, q11, q12 } = await seed(page, seedLocal, urlKey);

  // Home: both titles from the page's issues; the identifier links to the task page; Home's "needs you" sits on the card's line.
  await page.goto(`/workspace/${urlKey}/`);
  for (const [qid, ticket] of [[q11, 'LOCAL-11'], [q12, 'LOCAL-12']]) {
    const wrapper = page.locator(SELECTORS.waitingOnYou.question, { has: page.locator(Q.byId(qid)) });
    const card = wrapper.locator(Q.card);
    await expectTaskLine(wrapper, card, ticket, TASKS[ticket]);
    await expect(card.locator(Q.taskId)).toHaveAttribute('href', new RegExp(`/workspace/${urlKey}/task/${ticket}`));
    await expect(card.locator(`${Q.task} [data-testid="issue-row-state"]`)).toHaveText('needs you');
  }

  // The rulings page: titles from the held issue set Home's load just warmed, so LOCAL-11 (no run) is titled too (finding-3788e61b).
  await page.goto(`/workspace/${urlKey}/observation?view=rulings`);
  for (const [qid, ticket, title] of [[q12, 'LOCAL-12', TASKS['LOCAL-12']], [q11, 'LOCAL-11', TASKS['LOCAL-11']]]) {
    const row = page.locator('[data-testid="ruling-question-row"]', { has: page.locator(Q.byId(qid)) });
    await expectTaskLine(row, row.locator(Q.card), ticket, title);
  }

  // The task page: the page's own task names its card.
  await page.goto(`/workspace/${urlKey}/task/LOCAL-11`);
  const taskSection = page.locator('[data-testid="task-page-question-records"]');
  await expectTaskLine(taskSection, taskSection.locator(Q.byId(q11)), 'LOCAL-11', TASKS['LOCAL-11']);

  // The run page: the run's own rows name the task it asked about.
  await page.goto(`/workspace/${urlKey}/observation/session/${runId}`);
  const runSection = page.locator('[data-testid="session-question-records"]');
  await expectTaskLine(runSection, runSection.locator(Q.byId(q12)), 'LOCAL-12', TASKS['LOCAL-12']);
});

test('Home\'s opened task: the card in the state block names its task, once', async ({ page, localWorkerUrlKey: urlKey }) => {
  await clear(page, urlKey);
  const title = 'Solo task, started';
  const started = await page.request.post('/test/set-local-session', {
    data: { urlKey, runnerKey: true, openRouterConnected: false, projects: [{ id: localSeedId(urlKey, 'proj'), name: 'P', content: 'Seeded', sortOrder: 0 }],
      issues: [{ id: localSeedId(urlKey, 'solo'), identifier: 'LOCAL-S', title, description: 'Seeded task', projectId: localSeedId(urlKey, 'proj'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } }] },
  });
  expect(started.ok()).toBeTruthy();
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LOCAL-S', issueTitle: title, target: 'cli' },
  });
  const itemId = (await res.json()).item.id;
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);

  await page.clock.install();
  await page.goto(`/workspace/${urlKey}/`);
  const row = page.locator('[data-top-task="1"]').first();
  await expect(row).toBeVisible();
  if (!(await page.locator('.opened-task').first().isVisible())) await row.click();
  await expect(page.locator('.opened-task').first()).toBeVisible();
  // A task with an open question is not a Home row, so the task is opened first; the worker then asks, and one poll paints it.
  await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: { message: '[blocked] which way?' } });
  await seedQuestion(page, urlKey, { ticket: 'LOCAL-S', runId: itemId, asks: 'Which for LOCAL-S?' });
  const read = page.waitForResponse((r) => /\/api\/task\/LOCAL-S\/state/.test(r.url()));
  await page.clock.runFor(10000);
  await read;
  const slot = page.locator('[data-question-slot]');
  await expectTaskLine(slot, slot.locator(Q.card), 'LOCAL-S', title);
});

test('Flight Companion: the card from the tool\'s row names its task, once', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { q12 } = await seed(page, seedLocal, urlKey);
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const result = JSON.stringify({ count: 1, truncated: false, questions: [{
      questionId: q12, question: 'Which way?', options: ['left', 'right'], recommended: 'left',
      issueIdentifier: 'LOCAL-12', issueTitle: TASKS['LOCAL-12'], state: 'resumable', interactive: true,
    }] });
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: renderSSEFrames([['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result }], ['done', {}]]) });
  });
  await page.clock.install();
  await page.goto(`/workspace/${urlKey}/flight-companion`);
  await page.clock.fastForward(30000);
  const fold = page.locator('.fc-decisions-fold');
  await expect(fold).toHaveCount(1);
  await fold.locator('> summary').click();
  const row = fold.locator('[data-testid="fc-question"]');
  await expectTaskLine(row, row.locator(Q.card), 'LOCAL-12', TASKS['LOCAL-12']);
  await expect(row.locator(Q.taskId)).toHaveAttribute('href', new RegExp(`/workspace/${urlKey}/task/LOCAL-12`));
});
