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
 * of the asking run, and Flight Companion with its "questions waiting" fold opened. Flight Companion's fold is drawn from a
 * model's `list_pending_decisions` tool result; the turn is mocked (as tests/e2e/flight-companion.spec.js does) with the
 * seeded questions as the real tool projects them, so no model is called.
 *
 * Run (not part of `npm test`):
 *   LIN4546_SHOTS=before npx playwright test --config=playwright.visual.config.js tests/visual/lin-4546-question-surfaces-screenshots.spec.js
 * Output: docs/reviews/_evidence-2026-11-24-lin4546/<LIN4546_SHOTS>/<surface>-<role>-<theme>-<width>.png. The "before" set was
 * taken on main at d11effb18 with only the seeds added; piece 7 (LIN-4555) takes the "after" set with the same spec.
 * LIN-4551: each 390px load also records the page's scroll width beside its shot (scroll-390.json), so "no sideways scroll" is
 * a measure, not a look. The card-face sets are `lin4551-before` (main at 82ff17aff) and `lin4551-after`.
 *
 * LIN-4555 (piece 7, the walk): this is the walk's one command, the same for its before and after passes.
 *   - The member walk covers all six surfaces, as the owner's does (piece 1 shot only the four it thought differ): Runs and
 *     Flight Companion are open to a member too (Flight Companion is gated on its feature flag alone, routes/flight-companion.js),
 *     and the questions the seed asks are addressed to the signed-in person, so a member's tool lists the same rows.
 *   - The workspace is seeded through tests/fixtures/local-harness.js (the `seedLocal` fixture), and every element is read
 *     through SELECTORS (tests/helpers.js), so the after pass reads what the specs read.
 *   - `LIN4546_SHOTS_DIR` writes the set somewhere else (a scratch pass that is not evidence), and `--grep owner` or
 *     `--grep member` walks one role.
 * The "before" set is piece 1's (main d11effb18 plus the seeds, ca6b7c1f0), filled with this walk's member Runs and Flight
 * Companion shots and scroll-390.json: this spec run at ca6b7c1f0 in a scratch worktree, adapted only for what that tree
 * lacked (SELECTORS' questionCard, waitingOnYou, runPage and flightCompanion entries for test ids its DOM already drew; no
 * `short` or title on the tool row, which arrived with LIN-4550 and LIN-4549). That pass reproduced all 44 of piece 1's shots
 * at their dimensions. The 12 added PNGs are palette-quantized like piece 1's.
 * The Questions page is opened as `?view=rulings`, the link piece 1's set used: it still opens the Questions tab
 * (public/observation.js viewFromParams), so one URL walks the page before and after LIN-4553 renamed it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';
import { askingRun, recordsOf, runningRun, seedOwnerFindings, seedLongQuestion } from '../fixtures/question-records.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';

const SET = process.env.LIN4546_SHOTS || 'before';
const DIR = process.env.LIN4546_SHOTS_DIR || `docs/reviews/_evidence-2026-11-24-lin4546/${SET}`;
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
const Q = SELECTORS.questionCard;
const OBS = SELECTORS.observation;
const FC = SELECTORS.flightCompanion;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

/** The realistic workspace. Answers the asking run's id (its question is pinned on the run page) and the questions' rows. */
async function seed(page, seedLocal, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const seam of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache', 'clear-ticket-records']) {
    await page.request.get(`/test/${seam}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const issues = TASKS.map((t, i) => ({
    id: id(t.key), identifier: t.identifier, title: t.title, projectId: id('proj'), sortOrder: i, createdAt: OLD,
    ...(t.parent ? { parentId: id(t.parent) } : {}),
    state: t.state === 'started' ? { name: 'In Progress', type: 'started' } : { name: 'Todo', type: 'unstarted' },
  }));
  await seedLocal({ projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4546', sortOrder: 0 }], issues }, { runnerKey: true, features: { flightCompanion: true } });

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
  // LIN-4555: the reader's own rows for these questions (lib/open-questions.js, through the Questions feed): each carries its own
  // ticket and title, its words as the reader reads them, and `optionWords`, the fields list_pending_decisions projects.
  const feed = await page.request.get(`/workspace/${urlKey}/api/dashboard/rulings`);
  expect(feed.ok(), `rulings feed failed: ${await feed.text()}`).toBeTruthy();
  const rows = (await feed.json()).rulings || [];
  return { runId, questions, rows };
}

/**
 * Flight Companion's `list_pending_decisions` result, as lib/chat-tools.js projectPendingQuestion shapes the reader's rows. LIN-4555:
 * built from the reader's rows (each names its own ticket), not from the records in list order with tickets assigned by position.
 */
function pendingResult(rows) {
  return JSON.stringify({
    count: rows.length, truncated: false,
    questions: rows.map((r) => ({
      questionId: r.questionId, question: r.asks, short: r.short, options: r.options, optionWords: r.optionWords ?? r.options,
      recommended: r.recommended ?? null, issueIdentifier: r.ticket ?? null, issueTitle: r.title ?? null, state: r.state ?? 'resumable', interactive: true,
    })),
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
      // LIN-4553: a full-page shot taken while a poll repaints can catch the sticky header part-way down the page (seen on
      // both sets, a different shot each run). Start each shot at the top, after two frames, so the header is where a person sees it.
      await page.evaluate(() => new Promise((resolve) => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
      await page.screenshot({ path: `${DIR}/${name}-${theme}-${width}.png`, fullPage: true });
    }
  }
}

/**
 * Flight Companion with its "questions waiting" fold opened. The turn is mocked with the seeded questions as the tool's result
 * (pendingResult; tests/e2e/flight-companion.spec.js mocks the same way), the page's auto-wake turn is brought on by the clock,
 * and the fold is opened if it drew closed. No model is called.
 */
async function shootFlightCompanion(page, name, base, rows) {
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const frames = renderSSEFrames([
      ['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: pendingResult(rows) }],
      ['token', { token: 'Three questions are waiting on you, and three runs are going.' }],
      ['done', {}],
    ]);
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
  await page.clock.install();
  await shootAll(page, name, `${base}/flight-companion`, async () => {
    await page.clock.fastForward(30000);
    const fold = page.locator(FC.decisionsFold);
    await expect(fold).toHaveCount(1);
    if (!(await fold.evaluate((el) => el.open))) await page.locator(FC.decisionsSummary).click();
    await expect(fold.locator(Q.card).first()).toBeVisible();
  }, { fresh: true });
}

/** Runs as it opens (the Autopilot filter), and with every run showing, so the running runs (the three seeded and the asking run) are in the shot. */
async function shootRuns(page, role, base) {
  await shootAll(page, `runs-${role}`, `${base}/observation`, async () => {
    await page.waitForTimeout(500);
  });
  await shootAll(page, `runs-all-${role}`, `${base}/observation?filter=all`, async () => {
    await expect(page.getByRole('heading', { name: /Active · [1-9][0-9]* running/ })).toBeVisible();
  });
}

test.beforeAll(() => { mkdirSync(DIR, { recursive: true }); });
test.afterAll(() => { writeFileSync(`${DIR}/scroll-390.json`, `${JSON.stringify(scroll390, null, 2)}\n`); });

test('owner: Home, rulings, Runs, task page, run page and Flight Companion', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { runId, questions, rows } = await seed(page, seedLocal, urlKey);
  expect(questions).toHaveLength(3);
  expect(rows).toHaveLength(3);
  const base = `/workspace/${urlKey}`;

  await shootAll(page, 'home-owner', `${base}/`, async () => {
    await expect(page.locator(SELECTORS.waitingOnYou.section)).toBeVisible();
  });
  await shootAll(page, 'rulings-owner', `${base}/observation?view=rulings`, async () => {
    await expect(page.locator(OBS.ruling.row).first()).toBeVisible();
  });
  await shootRuns(page, 'owner', base);
  await shootAll(page, 'task-owner', `${base}/task/LOCAL-11`, async () => {
    await expect(page.locator(Q.card).first()).toBeVisible();
  });
  await shootAll(page, 'run-owner', `${base}/observation/session/${runId}`, async () => {
    await expect(page.locator(`${SELECTORS.runPage.questions} ${Q.card}`).first()).toBeVisible();
  });

  await shootFlightCompanion(page, 'flight-companion-owner', base, rows);
});

test('member: Home, rulings, Runs, task page, run page and Flight Companion', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  const { runId, rows } = await seed(page, seedLocal, urlKey);
  // The workspace's owner is someone else: the session is a member.
  const own = await page.request.get(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
  expect(own.ok(), `ownership seam failed: ${await own.text()}`).toBeTruthy();
  const base = `/workspace/${urlKey}`;
  await shootAll(page, 'home-member', `${base}/`);
  await shootAll(page, 'rulings-member', `${base}/observation?view=rulings`, async () => { await page.waitForTimeout(500); });
  await shootRuns(page, 'member', base);
  await shootAll(page, 'task-member', `${base}/task/LOCAL-11`);
  await shootAll(page, 'run-member', `${base}/observation/session/${runId}`);
  await shootFlightCompanion(page, 'flight-companion-member', base, rows);
});
