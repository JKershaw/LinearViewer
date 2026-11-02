import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4104 D3: Next step is the existing recommend call, then a confirm. Pressing Next step streams the recommendation
// (the one recommend stream the client already calls) and shows the stage, why and the task it is for; nothing is
// dispatched until Run, and Run dispatches on the terminal issue (the subtask, when the recommendation deferred into one).
// The stream is stubbed at the network edge; the rest of the page is real.

const DESKTOP = { width: 1280, height: 900 };
const TOP = 'LOCAL-H1';
const CHILD = 'LOCAL-H2';
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
  // The filled rung is the last dispatch's reach, kept in the task-mode store (D2): a spec starts with none.
  await page.goto(`/test/clear-task-mode-events?urlKey=${URL_KEY}`);
});

/** One In Progress container (LIN-H1) with one Todo subtask (LIN-H2): the case a recommendation defers into. */
async function seedTree(page, { runnerKey = true, openRouterConnected = true } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey,
      openRouterConnected,
      projects: [{ id: id('n-proj'), name: 'Next step project', content: 'A project', sortOrder: 1 }],
      issues: [
        { id: id('n-top'), identifier: TOP, title: 'Next step container', description: 'Seeded container', projectId: id('n-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('n-top')}` },
        { id: id('n-child'), identifier: CHILD, title: 'Write the next step', description: 'Seeded subtask', projectId: id('n-proj'), parentId: id('n-top'), sortOrder: 2, state: { name: 'Todo', type: 'unstarted' }, url: `/workspace/${URL_KEY}/issue/${id('n-child')}` },
      ],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue and take a session on the subtask, with no feedback: the subtask is running. */
async function startSubtaskRun(page) {
  const token = await runnerToken(page);
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: CHILD, issueTitle: 'Write the next step', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
}

async function gotoHome(page) {
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');
}

/** Open the container (TOP) on Home unless it is already open; return the opened-task block. The subtask would be Home's
 * marked top task, so the container is opened by its own line rather than by the top-task mark. */
async function openTopTask(page) {
  const block = page.locator('.opened-task').first();
  if (!(await block.isVisible())) await page.locator(`[data-testid="issue-line"][data-identifier="${TOP}"]`).first().click();
  await expect(block).toBeVisible();
  return block;
}

/** Record every POST to the session dispatch route: the body of each run the page sends. */
function recordDispatches(page) {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/dispatch$/.test(new URL(req.url()).pathname)) posts.push(req.postDataJSON());
  });
  return posts;
}

const sse = (events) => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');

test.describe('Home: Next step recommends, then confirms; nothing runs until Run (LIN-4104 D3)', () => {
  test.use({ viewport: DESKTOP });

  test('Next step shows the stage, why and the subtask it is for, dispatches nothing, and Run dispatches on the subtask', async ({ page }) => {
    await seedTree(page);
    const posts = recordDispatches(page);
    // The recommendation defers from the container into its subtask: the terminal issue is the subtask.
    await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        ['phase', { phase: 'reasoning' }],
        ['delta', { section: 'reasoning', content: 'The subtask is the next concrete step, so the Build stage goes there.' }],
        ['phase', { phase: 'prompt' }],
        ['delta', { section: 'prompt', content: 'Write the next step for LOCAL-H2.' }],
        ['done', { truncated: false, completionTokens: null, issueUrl: null, identifier: CHILD, title: 'Write the next step', deferredVia: [TOP], kind: 'implementation', issueId: localSeedId(URL_KEY, 'n-child') }],
      ]),
    }));
    await gotoHome(page);
    const block = await openTopTask(page);

    await block.locator('[data-testid="opened-task-go"]').click();
    const confirm = block.locator('[data-testid="opened-task-next-confirm"]');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Build');
    await expect(confirm).toContainText('The subtask is the next concrete step');
    await expect(confirm.locator('[data-testid="opened-task-next-target"]')).toContainText(`${CHILD} Write the next step, a subtask of ${TOP}.`);
    await expect(confirm.locator('[data-testid="opened-task-next-run-confirm"]')).toBeVisible();
    await expect(confirm.locator('[data-testid="run-another"]')).toBeVisible();
    expect(posts, 'nothing is dispatched until Run').toEqual([]);

    await confirm.locator('[data-testid="opened-task-next-run-confirm"]').click();
    await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
    expect(posts[0].issueIdentifier, 'the run is on the subtask, not the container').toBe(CHILD);
    expect(posts[0].entryRung, 'a run-step, so the run fills Next step').toBe('run-step');
  });

  test('a recommend that cannot run (503, no AI configured) shows a refusal in plain words and still offers Another step', async ({ page }) => {
    await seedTree(page, { openRouterConnected: false });
    const posts = recordDispatches(page);
    await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'AI recommendation feature is not configured.' }),
    }));
    await gotoHome(page);
    const block = await openTopTask(page);

    await block.locator('[data-testid="opened-task-go"]').click();
    const refusal = block.locator('[data-testid="opened-task-next-refusal"]');
    await expect(refusal).toContainText("Harbour can't pick the next step");
    await expect(refusal).toContainText('AI');
    await expect(block.locator('[data-testid="run-another"]')).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('a run that starts on the subtask between render and press is refused client-side; nothing is dispatched', async ({ page }) => {
    await seedTree(page);
    const posts = recordDispatches(page);
    await gotoHome(page);
    const block = await openTopTask(page);
    // The container's own state reads idle, so Run to PR is offered on the render.
    const runToPr = block.locator('[data-testid="opened-task-run-to-pr"]');
    await expect(runToPr).toBeVisible();

    // A run starts on the subtask after the render: the container is now busy over its subtree.
    await startSubtaskRun(page);
    await runToPr.click();
    await expect(block.locator('[data-testid="opened-task-go-notice"]')).toContainText('started');
    expect(posts, 'a stale press dispatches nothing').toEqual([]);
  });
});

/** A finished autopilot run on the container with no stop (a Run to Done): the workspace's last dispatch reaches done. */
async function seedFinishedRunToDone(page) {
  const token = await runnerToken(page);
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'autopilot prompt', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: TOP, issueTitle: 'Next step container', target: 'cli', entryRung: 'run-task' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[done] ran to the end' },
  });
  expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
}

test.describe('Home: Another step re-reads the offer, and Run to Done is the no-stop kickoff (LIN-4104 D4)', () => {
  test.use({ viewport: DESKTOP });

  test('Another step, pressed after a run started on the subtask, does not open the list; it refuses in plain words', async ({ page }) => {
    await seedTree(page);
    const posts = recordDispatches(page);
    await gotoHome(page);
    const block = await openTopTask(page);
    await expect(block.locator('[data-testid="run-another"]')).toBeVisible();

    await startSubtaskRun(page);
    await block.locator('[data-testid="run-another"]').click();
    await expect(block.locator('[data-testid="opened-task-go-notice"]')).toContainText('started');
    await expect(block.locator('[data-testid="run-another-item"]')).toHaveCount(0);
    expect(posts, 'nothing is dispatched').toEqual([]);
  });

  test('Run to Done starts the autopilot kickoff with no stop, in the query and in the dispatch body', async ({ page }) => {
    await seedTree(page);
    await seedFinishedRunToDone(page);
    const kickoffUrls = [];
    page.on('request', (req) => { if (/\/api\/autopilot-prompt\//.test(new URL(req.url()).pathname)) kickoffUrls.push(req.url()); });
    const posts = recordDispatches(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    const primary = block.locator('[data-testid="opened-task-go"]');
    await expect(primary).toHaveText('Run to Done');
    await expect(primary).toBeEnabled();
    await primary.click();
    await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
    expect(kickoffUrls.length, 'the kickoff is fetched').toBe(1);
    expect(kickoffUrls[0], 'the kickoff query names no stop').not.toMatch(/stopAt/);
    expect(posts[0].stopAt, 'the dispatch body names no stop').toBeUndefined();
    expect(posts[0].entryRung).toBe('run-task');
  });
});

test.describe('Home: Run to PR is the stop-at-PR kickoff, through the same path (LIN-4104 D4)', () => {
  test.use({ viewport: DESKTOP });

  test('Run to PR fetches the kickoff with stopAt pr and dispatches it with stopAt pr', async ({ page }) => {
    await seedTree(page);
    await seedFinishedRunToDone(page);
    // Seeding a finished run leaves the workspace on Run to Done; a Run to PR is the quiet button beside it.
    const kickoffUrls = [];
    page.on('request', (req) => { if (/\/api\/autopilot-prompt\//.test(new URL(req.url()).pathname)) kickoffUrls.push(req.url()); });
    const posts = recordDispatches(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    const runToPr = block.locator('[data-testid="opened-task-run-to-pr"]');
    await expect(runToPr).toBeVisible();
    await runToPr.click();
    await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
    expect(kickoffUrls.length, 'the kickoff is fetched').toBe(1);
    expect(kickoffUrls[0], 'the kickoff query names the PR stop').toMatch(/stopAt=pr/);
    expect(posts[0].stopAt, 'the dispatch body names the PR stop').toBe('pr');
    expect(posts[0].entryRung).toBe('run-task');
  });
});

/** The deferred recommendation the Next step tests stream: the subtask is the terminal issue. */
async function stubDeferredRecommendation(page) {
  await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: sse([
      ['phase', { phase: 'reasoning' }],
      ['delta', { section: 'reasoning', content: 'The subtask is the next concrete step, so the Build stage goes there.' }],
      ['phase', { phase: 'prompt' }],
      ['delta', { section: 'prompt', content: 'Write the next step for LOCAL-H2.' }],
      ['done', { truncated: false, completionTokens: null, issueUrl: null, identifier: CHILD, title: 'Write the next step', deferredVia: [TOP], kind: 'implementation', issueId: localSeedId(URL_KEY, 'n-child') }],
    ]),
  }));
}

test.describe('Home: Next step\'s confirm re-reads the offer before Run (LIN-4104 review finding 2)', () => {
  test.use({ viewport: DESKTOP });

  test('Run on the confirm, after a run starts on the subtask between the render and the press, is refused; nothing is dispatched', async ({ page }) => {
    await seedTree(page);
    const posts = recordDispatches(page);
    await stubDeferredRecommendation(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    await block.locator('[data-testid="opened-task-go"]').click();
    const confirm = block.locator('[data-testid="opened-task-next-confirm"]');
    const run = confirm.locator('[data-testid="opened-task-next-run-confirm"]');
    await expect(run).toBeVisible();

    // A run starts on the subtask after the confirm is drawn: the container is now busy over its subtree.
    await startSubtaskRun(page);
    await run.click();
    await expect(block.locator('[data-testid="opened-task-go-notice"]')).toContainText('started');
    expect(posts, 'a stale Run on the confirm dispatches nothing').toEqual([]);
  });
});

/** A finished autopilot kickoff on the container: `stopAt: 'pr'` makes its reach Run to PR, no stopAt makes it Run to Done. */
async function seedFinishedRun(page, { stopAt } = {}) {
  const token = await runnerToken(page);
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'autopilot prompt', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: TOP, issueTitle: 'Next step container', target: 'cli', entryRung: 'run-task', ...(stopAt ? { stopAt } : {}) },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[done] ran to the end' },
  });
  expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
}

test.describe('Home: the three run rungs are always drawn; only the filled one is primary (LIN-4104 review finding 1)', () => {
  test.use({ viewport: DESKTOP });

  test('after a Run to PR, Run to PR is filled, Next step and Run to Done are still drawn, and pressing Next step (not filled) asks and dispatches nothing', async ({ page }) => {
    await seedTree(page);
    await seedFinishedRun(page, { stopAt: 'pr' });
    const posts = recordDispatches(page);
    await stubDeferredRecommendation(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    const primary = block.locator('[data-testid="opened-task-go"]');
    await expect(primary).toHaveText('Run to PR');
    await expect(primary).toHaveAttribute('data-filled-rung', 'pr');
    await expect(block.locator('[data-testid="opened-task-run-next-step"]')).toHaveText('Next step');
    await expect(block.locator('[data-testid="opened-task-run-to-done"]')).toHaveText('Run to Done');

    await block.locator('[data-testid="opened-task-run-next-step"]').click();
    await expect(block.locator('[data-testid="opened-task-next-confirm"]')).toBeVisible();
    expect(posts, 'Next step asks; it does not dispatch').toEqual([]);
  });

  test('after a Run to Done, Run to Done is filled and Next step is still drawn', async ({ page }) => {
    await seedTree(page);
    await seedFinishedRun(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    await expect(block.locator('[data-testid="opened-task-go"]')).toHaveText('Run to Done');
    await expect(block.locator('[data-testid="opened-task-run-next-step"]')).toHaveText('Next step');
    await expect(block.locator('[data-testid="opened-task-run-to-pr"]')).toHaveText('Run to PR');
  });
});

test.describe('Home: a running Run to Done reads "Running to Done" (LIN-4104 D4)', () => {
  test.use({ viewport: DESKTOP });

  test('an unbounded autopilot run with a running worker reads Running to Done, not Harbour is deciding', async ({ page }) => {
    await seedTree(page);
    const token = await runnerToken(page);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const start = async (body) => {
      const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, { data: { target: 'cli', ...body } });
      expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
      const itemId = (await res.json()).item.id;
      expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
      return itemId;
    };
    // The unbounded autopilot kickoff is the run row (no stopAt); its Build worker names it through sessionId.
    const anchor = await start({ prompt: 'autopilot prompt', promptName: 'Autopilot', kind: 'autopilot', issueIdentifier: TOP, issueTitle: 'Next step container', entryRung: 'run-task' });
    await start({ prompt: 'build prompt', promptName: 'Build', kind: 'implementation', issueIdentifier: TOP, issueTitle: 'Next step container', sessionId: anchor });
    await gotoHome(page);
    const block = await openTopTask(page);

    const title = block.locator('[data-testid="opened-task-running"] .opened-task-running-title');
    await expect(title).toContainText('Running to Done');
    await expect(title).not.toContainText('Harbour is deciding');
  });
});
