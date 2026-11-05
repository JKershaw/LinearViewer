import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4048: a Done task on the task page. Its run slot follows the server's no-run decision (`none`) and the
// held run, not the tracker word: nothing is offered for a finished task, and a held run keeps its box and Stop
// until the run ends (the page's run poll then drops them, without a reload). The vm-sandbox witnesses pin the
// render; this spec proves the mount and the live repaint in a real browser.

const PHONE = { width: 360, height: 780 };
let URL_KEY;

test.use({ viewport: PHONE });

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

async function seedDoneTask(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issue = (raw, identifier, title, state) => ({
    id: id(raw), identifier, title, description: `Seeded ${title}`, projectId: id('tp-proj'), sortOrder: 1, state,
    url: `/workspace/${URL_KEY}/issue/${id(raw)}`,
  });
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      projects: [{ id: id('tp-proj'), name: 'Finished task project', content: 'A project', sortOrder: 1 }],
      issues: [
        issue('tp-done', 'LOCAL-FT1', 'A finished task', { name: 'Done', type: 'completed' }),
        issue('tp-open', 'LOCAL-FT2', 'A task still in progress', { name: 'In Progress', type: 'started' }),
      ],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session and take it (so it is held as a running run); post the feedback that ends it when `done` is given. */
async function seedHeldRun(page, token, { identifier, title, kind }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: title, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  return itemId;
}

async function finishRun(page, token, itemId) {
  const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[done] closed out' },
  });
  expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
}

// LIN-4247: Home's opened task. A run that starts and ends between two 10 s polls is never seen running, so the poll must
// end it from the reply alone: the started line and Home's run box (state.run.item) both clear, and Go returns.
test.describe('Home, a run that ends before the first poll (LIN-4247)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('press Go, finish the queued run at once: the started line and run box go, Go returns', async ({ page }) => {
    await seedDoneTask(page);
    const token = await runnerToken(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await page.locator('.line[data-section="in-progress"][data-identifier="LOCAL-FT2"]').click();
    const block = page.locator('.opened-task').first();
    await expect(block).toBeVisible();

    // Run to PR is the press that queues one run (Home's filled Go is the next-step rung, which asks for a confirm first). Take and finish it before the first poll (10 s), so no read ever sees it running.
    const [dispatched] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/api/dispatch') && r.status() === 201),
      block.locator('[data-testid="opened-task-run-to-pr"]').click(),
    ]);
    const itemId = (await dispatched.json()).item.id;
    const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
    await finishRun(page, token, itemId);

    await expect(block.locator('[data-testid="opened-task-started"]')).toHaveCount(0, { timeout: 25000 });
    await expect(block.locator('[data-testid="opened-task-running"]')).toHaveCount(0);
    await expect(block.locator('[data-testid="opened-task-go"]')).toBeVisible();
  });
});

test.describe('Task page, a finished task (LIN-4048)', () => {
  test('Done with nothing held: no runs-on, no Change, no quota and no Go on the page', async ({ page }) => {
    await seedDoneTask(page);
    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-FT1`);
    await expect(page.locator('[data-testid="task-page-title"]')).toHaveText('A finished task');
    await expect(page.locator('[data-testid="opened-task-go"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="opened-task-runs-on"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="run-change"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="opened-task-run-quota"]')).toHaveCount(0);
  });

  test('Done with a run held: the running box and Stop mount, then drop when the run ends (no reload)', async ({ page }) => {
    await seedDoneTask(page);
    const token = await runnerToken(page);
    const itemId = await seedHeldRun(page, token, { identifier: 'LOCAL-FT1', title: 'A finished task', kind: 'implementation' });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-FT1`);
    // The tracker says Done, but the close-out run is live: its box and Stop are the page's, as on Home.
    await expect(page.locator('[data-testid="run-stop"]')).toBeVisible();
    await expect(page.locator('[data-testid="opened-task-running"]')).toBeVisible();
    await expect(page.locator('[data-testid="opened-task-runs-on"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="opened-task-go"]')).toHaveCount(0);

    // The run ends. The page's run poll (10s) repaints the run slot: the Stop and the running box go without a reload.
    await finishRun(page, token, itemId);
    await expect(page.locator('[data-testid="run-stop"]')).toHaveCount(0, { timeout: 25000 });
    await expect(page.locator('[data-testid="opened-task-running"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="opened-task-go"]')).toHaveCount(0);
  });

  // LIN-4247: the same held run on an UNFINISHED task. Its Go and started line are Go's own state (state.go), not the run box,
  // so the started line must go and Go must come back when the run ends, with no reload.
  test('LIN-4247: an unfinished task whose run ends: the started line goes and Go returns, no reload', async ({ page }) => {
    await seedDoneTask(page);
    const token = await runnerToken(page);
    const itemId = await seedHeldRun(page, token, { identifier: 'LOCAL-FT2', title: 'A task still in progress', kind: 'implementation' });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-FT2`);
    await expect(page.locator('[data-testid="run-stop"]')).toBeVisible();
    await expect(page.locator('[data-testid="opened-task-go"]')).toHaveCount(0);

    await finishRun(page, token, itemId);
    await expect(page.locator('[data-testid="opened-task-started"]')).toHaveCount(0, { timeout: 25000 });
    await expect(page.locator('[data-testid="opened-task-go"]')).toBeVisible();
    await expect(page.locator('[data-testid="run-stop"]')).toHaveCount(0);
  });

  test('control: an unfinished task with a run held keeps its running box and Stop', async ({ page }) => {
    await seedDoneTask(page);
    const token = await runnerToken(page);
    await seedHeldRun(page, token, { identifier: 'LOCAL-FT2', title: 'A task still in progress', kind: 'implementation' });

    await page.goto(`/workspace/${URL_KEY}/task/LOCAL-FT2`);
    await expect(page.locator('[data-testid="run-stop"]')).toBeVisible();
    await expect(page.locator('[data-testid="opened-task-running"]')).toBeVisible();
  });
});
