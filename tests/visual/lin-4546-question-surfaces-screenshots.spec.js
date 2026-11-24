/**
 * LIN-4549 (LIN-4546 piece 1) evidence maker: every surface a person meets a question or a note on, in a workspace shaped like
 * the real one, at 1280px and 390px, light and dark, as the owner and (where the surface differs) as a member.
 *
 * The workspace (routes/test.js, the realistic seeds): three open questions of real length (several hundred words with lists,
 * three or four long options, the recommended one not first: POST /test/seed-question-record with `long: true`), one of them
 * asked by a run parked on `[blocked]`, so the run page pins it; 36 open findings addressed to the owner across six tasks and
 * three running runs (POST /test/seed-owner-findings; the runs through the dispatch API, tests/fixtures/question-records.js
 * runningRun).
 *
 * Surfaces: Home, the rulings page (Observation › rulings), Runs (Observation › runs), a task page with a question, the run page
 * of the asking run, and Flight Companion with its "decisions waiting" fold opened. Flight Companion's fold is drawn from a
 * model's `list_pending_decisions` tool result; the turn is mocked (as tests/e2e/flight-companion.spec.js does) with the
 * seeded questions as the real tool projects them, so no model is called.
 *
 * Run (not part of `npm test`):
 *   LIN4546_SHOTS=before npx playwright test --config=playwright.visual.config.js tests/visual/lin-4546-question-surfaces-screenshots.spec.js
 * Output: docs/reviews/_evidence-2026-11-24-lin4546/<LIN4546_SHOTS>/<surface>-<role>-<theme>-<width>.png. The "before" set was
 * taken on main at d11effb18 with only the seeds added; piece 7 (LIN-4555) takes the "after" set with the same spec.
 * LIN-4551: each 390px load also records the page's scroll width beside its shot (scroll-390.json), so "no sideways scroll" is
 * a measure, not a look. The card-face sets are `lin4551-before` (main at 82ff17aff) and `lin4551-after`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, recordsOf, runningRun, seedOwnerFindings, seedLongQuestion } from '../fixtures/question-records.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';
import { questionShortOf } from '../../lib/records/question-short.js';

const SET = process.env.LIN4546_SHOTS || 'before';
const DIR = `docs/reviews/_evidence-2026-11-24-lin4546/${SET}`;
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const OLD = '2020-01-01T00:00:00Z';

// Task titles as a real tracker carries them.
const TASKS = [
  { key: 'charter', identifier: 'LOCAL-10', title: 'Questions and notes: quiet on Home, clear wherever you answer them', state: 'started' },
  { key: 'card', identifier: 'LOCAL-11', title: 'Foundation: one card that carries its own look, task line and hold rule', parent: 'charter', state: 'started' },
  { key: 'hold', identifier: 'LOCAL-12', title: 'One keep-a-card-across-a-repaint rule for Home, Observation and the opened task', parent: 'charter', state: 'unstarted' },
  { key: 'home', identifier: 'LOCAL-13', title: 'A quiet Home: said once, badge agrees, notes for you below the questions', parent: 'charter', state: 'unstarted' },
  { key: 'face', identifier: 'LOCAL-14', title: 'The card\'s face: one-line lead, the ask behind a fold, readable options', parent: 'charter', state: 'started' },
  { key: 'obs', identifier: 'LOCAL-15', title: 'Observation, the run page and Flight Companion: the Questions tab and the shared card', parent: 'charter', state: 'started' },
  { key: 'task', identifier: 'LOCAL-16', title: 'The task page: the question once, records that read as a person would', parent: 'charter', state: 'unstarted' },
];
const titleOf = (identifier) => TASKS.find((t) => t.identifier === identifier).title;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

/** The realistic workspace. Answers the asking run's id (its question is pinned on the run page) and the questions' rows. */
async function seed(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  const issues = TASKS.map((t, i) => ({
    id: id(t.key), identifier: t.identifier, title: t.title, projectId: id('proj'), sortOrder: i, createdAt: OLD,
    ...(t.parent ? { parentId: id(t.parent) } : {}),
    state: t.state === 'started' ? { name: 'In Progress', type: 'started' } : { name: 'Todo', type: 'unstarted' },
  }));
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey, runnerKey: true, features: { flightCompanion: true }, projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4546', sortOrder: 0 }], issues },
  });
  expect(resp.ok(), `seed failed: ${await resp.text()}`).toBeTruthy();

  // The asking run on LOCAL-12 (parked on `[blocked]`), so the run page pins its question.
  const runId = await askingRun(page, urlKey, 'LOCAL-12', { title: titleOf('LOCAL-12') });
  const asked = [
    { ticket: 'LOCAL-11', variant: 0, runId: null },
    { ticket: 'LOCAL-12', variant: 1, runId },
    { ticket: 'LOCAL-13', variant: 2, runId: null },
  ];
  for (const q of asked) await seedLongQuestion(page, urlKey, { ticket: q.ticket, title: titleOf(q.ticket), runId: q.runId, variant: q.variant });
  await seedOwnerFindings(page, urlKey, { findings: 36, tasks: TASKS.filter((t) => t.key !== 'charter').map((t) => ({ ticket: t.identifier, title: t.title })) });
  for (const [n, ticket] of ['LOCAL-11', 'LOCAL-14', 'LOCAL-15'].entries()) await runningRun(page, urlKey, ticket, { title: titleOf(ticket), n });
  const questions = (await recordsOf(page, urlKey, 'question')).filter((r) => r.state === 'open');
  return { runId, questions };
}

/** Flight Companion's `list_pending_decisions` result for the seeded questions, as lib/chat-tools.js projects them. */
function pendingResult(questions) {
  return JSON.stringify({
    count: questions.length, truncated: false,
    questions: questions.map((q, i) => {
      const issueIdentifier = ['LOCAL-11', 'LOCAL-12', 'LOCAL-13'][i] ?? null;
      return {
        // LIN-4551: `short` as the reader gives it (written, else derived), which the tool row carries since LIN-4550.
        questionId: q.id, question: q.fields.asks, short: questionShortOf(q.fields), options: q.fields.options, recommended: q.fields.recommended ?? null,
        issueIdentifier, issueTitle: issueIdentifier ? titleOf(issueIdentifier) : null, state: 'resumable', interactive: true,
      };
    }),
  });
}

async function setTheme(page, theme) {
  await page.context().addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3001' }]);
}

/**
 * One full-page shot of `path` per theme and width. `prepare` runs after each load (open a fold, wait for a poll). `fresh`
 * clears the page's storage before each load, so a page that restores its thread (Flight Companion) starts empty each time.
 */
const scroll390 = [];
async function shootAll(page, name, path, prepare = async () => {}, { fresh = false } = {}) {
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize(WIDTHS[width]);
      if (fresh) await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* none */ } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await prepare();
      if (width === 390) scroll390.push({ shot: `${name}-${theme}-${width}`, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) });
      await page.screenshot({ path: `${DIR}/${name}-${theme}-${width}.png`, fullPage: true });
    }
  }
}

test.beforeAll(() => { mkdirSync(DIR, { recursive: true }); });
test.afterAll(() => { writeFileSync(`${DIR}/scroll-390.json`, `${JSON.stringify(scroll390, null, 2)}\n`); });

test('owner: Home, rulings, Runs, task page, run page and Flight Companion', async ({ page, localWorkerUrlKey: urlKey }) => {
  const { runId, questions } = await seed(page, urlKey);
  expect(questions).toHaveLength(3);
  const base = `/workspace/${urlKey}`;

  await shootAll(page, 'home-owner', `${base}/`, async () => {
    await expect(page.locator('[data-testid="waiting-on-you"]')).toBeVisible();
  });
  await shootAll(page, 'rulings-owner', `${base}/observation?view=rulings`, async () => {
    await expect(page.locator('[data-testid="ruling-question-row"]').first()).toBeVisible();
  });
  // Runs as it opens (the Autopilot filter), and with every run showing, so the running runs (the three seeded and the asking run) are in the shot.
  await shootAll(page, 'runs-owner', `${base}/observation`, async () => {
    await page.waitForTimeout(500);
  });
  await shootAll(page, 'runs-all-owner', `${base}/observation?filter=all`, async () => {
    await expect(page.getByRole('heading', { name: /Active · [1-9][0-9]* running/ })).toBeVisible();
  });
  await shootAll(page, 'task-owner', `${base}/task/LOCAL-11`, async () => {
    await expect(page.locator('[data-testid="question-record-card"]').first()).toBeVisible();
  });
  await shootAll(page, 'run-owner', `${base}/observation/session/${runId}`, async () => {
    await expect(page.locator('[data-testid="question-record-card"]').first()).toBeVisible();
  });

  // Flight Companion: the turn is mocked with the seeded questions as the tool's result, and the fold is opened.
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const frames = renderSSEFrames([
      ['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: pendingResult(questions) }],
      ['token', { token: 'Three questions are waiting on you, and three runs are going.' }],
      ['done', {}],
    ]);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
  await page.clock.install();
  await shootAll(page, 'flight-companion-owner', `${base}/flight-companion`, async () => {
    await page.clock.fastForward(30000);
    const fold = page.locator('.fc-decisions-fold');
    await expect(fold).toHaveCount(1);
    if (!(await fold.evaluate((el) => el.open))) await fold.locator('> summary').click();
    await expect(fold.locator('[data-testid="question-record-card"]').first()).toBeVisible();
  }, { fresh: true });
});

test('member: Home, rulings, task page and run page (the surfaces that differ for a member)', async ({ page, localWorkerUrlKey: urlKey }) => {
  const { runId } = await seed(page, urlKey);
  // The workspace's owner is someone else: the session is a member.
  const own = await page.request.get(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
  expect(own.ok(), `ownership seam failed: ${await own.text()}`).toBeTruthy();
  const base = `/workspace/${urlKey}`;
  await shootAll(page, 'home-member', `${base}/`);
  await shootAll(page, 'rulings-member', `${base}/observation?view=rulings`, async () => { await page.waitForTimeout(500); });
  await shootAll(page, 'task-member', `${base}/task/LOCAL-11`);
  await shootAll(page, 'run-member', `${base}/observation/session/${runId}`);
});
