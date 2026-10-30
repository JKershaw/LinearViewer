import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, subtreeLocalSeed, homeSubtreeLocalSeed, seedSessionOnTask, seedTaskRuling } from '../fixtures/local-harness.js';

// LIN-4049 (LIN-4040 S1): the opened box and the task page decide over the task's whole subtree. A parent whose subtask
// runs, is queued, or waits on you offers no run, on Home and on the task page, and its pill reads the same state as its
// Home row. Witnesses (the review's list): (c) Home for a parent whose Todo child runs; (e) the task page of a three-level
// parent whose leaf runs; (d) a parent whose subtasks wait on you; (f) an over-cap parent says why it offers no run;
// (g1) a Backlog parent with a started child and a running Todo child reads running, with no run; (g2) a subtask in
// another project that runs makes its parent read running; (g3) the (g1) parent under `?assignee=me` still reads running.

const DESKTOP = { width: 1280, height: 900 };
const RESETS = ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-task-decisions', 'clear-shelved-rulings'];
let URL_KEY;

test.use({ viewport: DESKTOP });

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  for (const reset of RESETS) await page.request.get(`/test/${reset}?urlKey=${URL_KEY}`);
});

// Leave the shared workspace as found: these tests leave running sessions and rulings behind.
test.afterEach(async ({ page, localWorkerUrlKey }) => {
  for (const reset of RESETS) await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
});

/** A task page, loaded; its status pill, and the run control's Go button (absent when no run is offered). */
async function taskPage(page, identifier, query = '') {
  await page.goto(`/workspace/${URL_KEY}/task/${identifier}${query}`);
  await page.waitForLoadState('networkidle');
  return {
    pill: page.locator('[data-testid="task-page-status-pill"]'),
    run: page.locator('[data-testid="opened-task-go"]'),
  };
}

test.describe('LIN-4049 — Home for a parent whose Todo child runs (c)', () => {
  test('the parent\'s Home row reads running; Home\'s top card is its running subtask, which offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, homeSubtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-71', state: 'running' });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    // The parent's In Progress row carries the state its subtask runs.
    await expect(page.locator('[data-identifier="LOCAL-70"]').first()).toContainText('running');
    // Home's opened box is its top card, and in this shape the top card is the subtask: the ranking puts the Todo subtask
    // above its started parent with or without the subtask's session (probe, LIN-4049 review 2). So Home never opens the
    // parent's own box here; the parent's box is witnessed on its task page in (e). The subtask's box offers no run.
    await expect(page.locator('[data-top-task="1"]')).toHaveAttribute('data-identifier', 'LOCAL-71');
    await expect(page.locator('.opened-task [data-testid="opened-task-go"]'), 'no run while the subtask runs').toHaveCount(0);
  });
});

test.describe('LIN-4049 — the task page of a three-level parent whose leaf runs (e)', () => {
  test('the leaf runs; the parent\'s page reads running and offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-33', state: 'running' });

    const parent = await taskPage(page, 'LOCAL-30');
    await expect(parent.pill, 'the parent reads what its leaf is doing').toHaveText('running');
    await expect(parent.run, 'the parent offers no run while its leaf runs').toHaveCount(0);

    const leaf = await taskPage(page, 'LOCAL-33');
    await expect(leaf.pill).toHaveText('running');
  });
});

test.describe('LIN-4049 — a parent whose subtasks wait on you (d)', () => {
  test('the parent reads waiting, and offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedTaskRuling(page, localWorkerUrlKey, { identifier: 'LOCAL-81', rawId: 'local-issue-wait-child' });

    const parent = await taskPage(page, 'LOCAL-80');
    await expect(parent.pill).toHaveText('waiting');
    await expect(parent.run, 'a subtask waits on you, so the parent offers no run').toHaveCount(0);
  });
});

test.describe('LIN-4049 — an over-cap parent says why it offers no run (f)', () => {
  test('the page names the cap in a plain sentence and offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    const parent = await taskPage(page, 'LOCAL-40');
    await expect(parent.run, 'over the cap, no run').toHaveCount(0);
    await expect(page.locator('[data-testid="opened-task-note"]')).toContainText('more subtasks than the run box checks');
    // Another step on a closed box lists nothing pickable: the steps are left out, and the count says so (review 5).
    await page.locator('[data-testid="run-another"]').click();
    await expect(page.locator('[data-testid="run-another-item"]'), 'no step is pickable on a closed box').toHaveCount(0);
    await expect(page.locator('[data-testid="run-another-left-out"]')).toBeVisible();
  });
});

test.describe('LIN-4049 — a Backlog parent with a started child and a running Todo child (g1, g3)', () => {
  test('the parent reads running and offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-92', state: 'running' });
    const parent = await taskPage(page, 'LOCAL-90');
    await expect(parent.pill).toHaveText('running');
    await expect(parent.run).toHaveCount(0);
  });

  test('under ?assignee=me the parent still reads running on Home: the index is built before the filter', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-92', state: 'running' });
    // The viewer is assigned to the started child (LOCAL-91), not to the running Todo child (LOCAL-92), which the filter drops.
    await page.goto(`/workspace/${URL_KEY}/?assignee=me`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-identifier="LOCAL-92"]'), 'the running child is filtered out of the view').toHaveCount(0);
    // The witness is Home's own row for the parent, the surface the filter applies to. The task page never applies it.
    await expect(page.locator('[data-identifier="LOCAL-90"]').first(), 'the parent row reads running under the filter').toContainText('running');
    // The task page's own check, under the same filter, is secondary: it shows the page reads the same subtree.
    const parent = await taskPage(page, 'LOCAL-90', '?assignee=me');
    await expect(parent.pill).toHaveText('running');
    await expect(parent.run).toHaveCount(0);
  });
});

test.describe('LIN-4049 — a subtask in another project that runs (g2)', () => {
  test('its parent reads running and offers no run', async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, subtreeLocalSeed(localWorkerUrlKey), { urlKey: localWorkerUrlKey, runnerKey: true });
    await seedSessionOnTask(page, localWorkerUrlKey, { identifier: 'LOCAL-51', state: 'running' });
    const parent = await taskPage(page, 'LOCAL-50');
    await expect(parent.pill).toHaveText('running');
    await expect(parent.run).toHaveCount(0);
  });
});
