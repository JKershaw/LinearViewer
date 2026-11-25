/**
 * LIN-4555 (LIN-4546 piece 7): the walk's workspace, shared by the screenshot tool (tests/visual/lin-4546-question-surfaces-screenshots.spec.js)
 * and the cross-surface specs that assert on it (tests/e2e/lin-4555-no-raw-text.spec.js, tests/e2e/lin-4555-no-sideways-scroll.spec.js),
 * so what is shot and what is checked is one workspace.
 *
 * Shaped like the real one: three open questions of real length (several hundred words with lists, three or four long options, the
 * recommended one not first; lib/sample-data/question-workload.js), asked as before LIN-4550 (no written `short`), one of them by a
 * run parked on `[blocked]` so the run page pins it, and one (variant 2) quoting a task record id as real asks do; 36 open findings
 * addressed to the owner over six tasks, many quoting ids, person ids and ISO stamps; three running runs. Seeded through
 * tests/fixtures/local-harness.js (the `seedLocal` fixture); the runs through the dispatch API as a runner makes them.
 */
import { expect } from '@playwright/test';
import { localSeedId } from './local-harness.js';
import { askingRun, runningRun, seedOwnerFindings, seedLongQuestion } from './question-records.js';
import { renderSSEFrames } from './flight-companion-sse-frames.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';

/** Task titles as a real tracker carries them. */
export const WALK_TASKS = [
  { key: 'charter', identifier: 'LOCAL-10', title: 'Questions and notes: quiet on Home, clear wherever you answer them', state: 'started' },
  { key: 'card', identifier: 'LOCAL-11', title: 'Foundation: one card that carries its own look, task line and hold rule', parent: 'charter', state: 'started' },
  { key: 'hold', identifier: 'LOCAL-12', title: 'One keep-a-card-across-a-repaint rule for Home, Observation and the opened task', parent: 'charter', state: 'unstarted' },
  { key: 'home', identifier: 'LOCAL-13', title: 'A quiet Home: said once, badge agrees, notes for you below the questions', parent: 'charter', state: 'unstarted' },
  { key: 'face', identifier: 'LOCAL-14', title: 'The card\'s face: one-line lead, the ask behind a fold, readable options', parent: 'charter', state: 'started' },
  { key: 'obs', identifier: 'LOCAL-15', title: 'Observation, the run page and Flight Companion: the Questions tab and the shared card', parent: 'charter', state: 'started' },
  { key: 'task', identifier: 'LOCAL-16', title: 'The task page: the question once, records that read as a person would', parent: 'charter', state: 'unstarted' },
];
export const walkTitleOf = (identifier) => WALK_TASKS.find((t) => t.identifier === identifier).title;

/**
 * Seeds the walk's workspace for `urlKey` as its owner. Answers the asking run's id (the run page of the run whose question it pins),
 * the open question records, and the reader's rows for them (lib/open-questions.js, through the Questions feed: each names its own
 * ticket and title and carries its words as the reader reads them, the fields list_pending_decisions projects).
 */
export async function seedQuestionWalk(page, seedLocal, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const seam of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache', 'clear-ticket-records']) {
    await page.request.get(`/test/${seam}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const issues = WALK_TASKS.map((t, i) => ({
    id: id(t.key), identifier: t.identifier, title: t.title, projectId: id('proj'), sortOrder: i, createdAt: OLD,
    ...(t.parent ? { parentId: id(t.parent) } : {}),
    state: t.state === 'started' ? { name: 'In Progress', type: 'started' } : { name: 'Todo', type: 'unstarted' },
  }));
  await seedLocal({ projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4546', sortOrder: 0 }], issues }, { runnerKey: true, features: { flightCompanion: true } });

  // The asking run on LOCAL-12 (parked on `[blocked]`), so the run page pins its question.
  const runId = await askingRun(page, urlKey, 'LOCAL-12', { title: walkTitleOf('LOCAL-12') });
  const asked = [
    { ticket: 'LOCAL-11', variant: 0, runId: null },
    { ticket: 'LOCAL-12', variant: 1, runId },
    { ticket: 'LOCAL-13', variant: 2, runId: null },
  ];
  const questionIds = {};
  for (const q of asked) questionIds[q.ticket] = await seedLongQuestion(page, urlKey, { ticket: q.ticket, title: walkTitleOf(q.ticket), runId: q.runId, variant: q.variant });
  await seedOwnerFindings(page, urlKey, { findings: 36, tasks: WALK_TASKS.filter((t) => t.key !== 'charter').map((t) => ({ ticket: t.identifier, title: t.title })) });
  for (const [n, ticket] of ['LOCAL-11', 'LOCAL-14', 'LOCAL-15'].entries()) await runningRun(page, urlKey, ticket, { title: walkTitleOf(ticket), n });
  const feed = await page.request.get(`/workspace/${urlKey}/api/dashboard/rulings`);
  expect(feed.ok(), `rulings feed failed: ${await feed.text()}`).toBeTruthy();
  const rows = (await feed.json()).rulings || [];
  expect(rows, 'the three seeded questions are open').toHaveLength(3);
  return { runId, questionIds, rows };
}

/** The workspace's owner becomes someone else, so the session is a member (routes/test.js set-workspace-ownership). */
export async function becomeMember(page, urlKey) {
  const own = await page.request.get(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
  expect(own.ok(), `ownership seam failed: ${await own.text()}`).toBeTruthy();
}

/** The theme a page loads in (the shared shell reads the `theme` cookie pre-paint, lib/components/page.js). */
export async function setTheme(page, theme) {
  await page.context().addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3001' }]);
}

/**
 * Flight Companion's `list_pending_decisions` result, as lib/chat-tools.js projectPendingQuestion shapes the reader's rows: built from
 * the rows themselves (each names its own ticket), not from records in list order with tickets assigned by position.
 */
export function pendingResult(rows) {
  return JSON.stringify({
    count: rows.length, truncated: false,
    questions: rows.map((r) => ({
      questionId: r.questionId, question: r.asks, short: r.short, options: r.options, optionWords: r.optionWords ?? r.options,
      recommended: r.recommended ?? null, issueIdentifier: r.ticket ?? null, issueTitle: r.title ?? null, state: r.state ?? 'resumable', interactive: true,
    })),
  });
}

/**
 * Mocks Flight Companion's turn with the rows as the tool's result (tests/e2e/flight-companion.spec.js mocks the same way), so its
 * "questions waiting" fold draws the shared card and no model is called. Call before the page loads; then `page.clock.install()`
 * and fast-forward to bring on the page's auto-wake turn.
 */
export async function mockPendingDecisions(page, rows) {
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const frames = renderSSEFrames([
      ['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: pendingResult(rows) }],
      ['token', { token: 'Three questions are waiting on you, and three runs are going.' }],
      ['done', {}],
    ]);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
}

/** Clicks every match of `selector` that a person can see, in order (each opens one fold or one detail). */
async function clickEach(page, selector) {
  for (const el of await page.locator(selector).all()) {
    if (await el.isVisible()) await el.click();
  }
}

/** Opens every question card's "the full question" fold on the page. */
const openQuestionFolds = (page) => clickEach(page, SELECTORS.questionCard.askSummary);

/**
 * The six surfaces a person meets a question or a note on, as `role` ('owner' or 'member') sees them, each with what to wait for
 * and what to open: everything a person can open that holds an agent's words or a time (the full question, the notes past the
 * fold and each note's whole text, a run's detail on Runs, a step's transcript on the run page, Flight Companion's fold). A spec
 * reads the page after `open` has run, and runs a surface's `before` (when it has one) before loading it. Flight Companion needs
 * mockPendingDecisions and `page.clock.install()` before it loads.
 * @returns {Array<{name: string, path: string, before?: (page) => Promise<void>, open: (page) => Promise<void>}>}
 */
export function walkSurfaces({ urlKey, runId, role }) {
  const base = `/workspace/${urlKey}`;
  const W = SELECTORS.waitingOnYou;
  const owner = role === 'owner';
  return [
    {
      name: 'Home', path: `${base}/`,
      open: async (page) => {
        if (!owner) return; // a member gets no Waiting section (LIN-4114)
        await expect(page.locator(W.section)).toBeVisible();
        await openQuestionFolds(page);
        await page.locator(W.notesMore).click();
        await clickEach(page, W.noteFoldSummary);
      },
    },
    {
      name: 'the Questions page', path: `${base}/observation?view=questions`,
      open: async (page) => {
        await expect(page.locator(SELECTORS.observation.ruling.row).first()).toBeVisible();
        await openQuestionFolds(page);
      },
    },
    {
      name: 'Runs', path: `${base}/observation?filter=all`,
      open: async (page) => {
        await expect(page.getByRole('heading', { name: /Active · [1-9][0-9]* running/ })).toBeVisible();
        await clickEach(page, SELECTORS.observation.runDetail);
        await page.waitForLoadState('networkidle');
      },
    },
    {
      // LOCAL-13: its question quotes a task record id, and its notes quote ids and stamps, as real ones do.
      name: 'a task page', path: `${base}/task/LOCAL-13`,
      open: async (page) => {
        await expect(page.locator(SELECTORS.taskPage.details)).toHaveCount(1);
        await openQuestionFolds(page);
      },
    },
    {
      name: 'a run page', path: `${base}/observation/session/${runId}`,
      open: async (page) => {
        await expect(page.locator(`${SELECTORS.runPage.questions} ${SELECTORS.questionCard.card}`).first()).toBeVisible();
        await openQuestionFolds(page);
        await clickEach(page, SELECTORS.runPage.runToggle);
      },
    },
    {
      name: 'Flight Companion', path: `${base}/flight-companion`,
      // The page restores its thread from storage, so a second load would draw no new fold: start it empty each time.
      before: async (page) => { await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* none */ } }); },
      open: async (page) => {
        await page.clock.fastForward(30000);
        const fold = page.locator(SELECTORS.flightCompanion.decisionsFold);
        await expect(fold).toHaveCount(1);
        if (!(await fold.evaluate((el) => el.open))) await page.locator(SELECTORS.flightCompanion.decisionsSummary).click();
        await expect(fold.locator(SELECTORS.questionCard.card).first()).toBeVisible();
        await openQuestionFolds(page);
      },
    },
  ];
}
