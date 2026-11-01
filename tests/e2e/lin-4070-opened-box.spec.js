import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, localSeedId } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';

// LIN-4070 (B) — the opened box reads the gathered state: a parent whose subtask is running shows running in Home's box,
// with no Run control. The row, the box and `/state` are one reader (the held set through A's holder), so the box cannot
// offer a run the row denies. The witness is the real browser path: Home's top task, opened, with the subtask running.

const DESKTOP = { width: 1280, height: 900 };
const PARENT = 'LOCAL-P70';
const CHILD = 'LOCAL-C70';
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-observation-sessions', 'clear-sessions-feed-cache']) {
    await page.goto(`/test/${reset}?urlKey=${URL_KEY}`);
  }
});

// These tests leave a running session; a running session would move the next step another spec reads from this workspace.
test.afterEach(async ({ page, localWorkerUrlKey }) => {
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status']) {
    await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
  }
});

/** A started parent with one started subtask: the parent is Home's top task, the child is the one that runs. */
function parentWithChildSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [{ id: id('p70-proj'), name: 'Opened box project', content: 'A project', sortOrder: 1 }],
    issues: [
      {
        id: id('p70-parent'), identifier: PARENT, title: 'Parent with a running subtask', description: 'Seeded parent',
        projectId: id('p70-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${urlKey}/issue/${id('p70-parent')}`,
      },
      {
        id: id('p70-child'), identifier: CHILD, title: 'Subtask that runs', description: 'Seeded child',
        projectId: id('p70-proj'), parentId: id('p70-parent'), sortOrder: 2, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${urlKey}/issue/${id('p70-child')}`,
      },
    ],
  };
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a plan-free implementation session on the subtask and take it: it is running, with no feedback. */
async function startChildRun(page, token) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: CHILD, issueTitle: 'Subtask that runs', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
}

test.describe('the opened box of a parent with a running subtask reads running and offers no run (LIN-4070 B)', () => {
  test.use({ viewport: DESKTOP });

  test('Home opens the parent: running is named once, and there is no Run control', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, parentWithChildSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await startChildRun(page, await runnerToken(page));

    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    // Home marks the child as its top task (the child is In Progress too), and the child sits under a collapsed parent. The
    // parent's own In Progress line is the one this test opens.
    const block = page.locator(SELECTORS.openedTask.box).first();
    if (!(await block.isVisible())) await page.locator(SELECTORS.openedTask.parentLine(PARENT)).click();
    await expect(block).toBeVisible();

    // The gathered state: the parent's line reads running from its subtask's run (the row, Home's one reader).
    await expect(page.locator(SELECTORS.openedTask.parentLine(PARENT))).toContainText('running');

    // D7: a running subtask makes the parent busy, so the box offers no step line and no Run control. ("Another step"
    // stays, as it does on a task whose own session runs: it is a choice the person makes, not an offer.)
    await expect(block.locator(SELECTORS.openedTask.step)).toHaveCount(0);
    await expect(block.locator(SELECTORS.openedTask.go)).toHaveCount(0);
    await expect(block).not.toContainText('Run to PR');
  });
});
