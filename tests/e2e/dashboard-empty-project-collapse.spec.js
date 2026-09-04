import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-2514: a zero-issue project on the authenticated tree page should render
// collapsed by default (extending the existing default-collapse mechanism —
// HTML flag -> emitter -> consumer — to the authenticated producer), hide its
// `+ Add task` control while collapsed, and override any previously-stored
// collapse state at load time (the storage key is global/not workspace-scoped,
// so a first-load-only fix would never reach a returning user). A
// completed-only project must stay open since it still exposes a live
// "show N completed" control. Custom local seed, no mock-data.js changes.
function emptyProjectSeed(urlKey) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  return {
    projects: [
      { id: id('proj-active'), name: 'Active Project', content: null, sortOrder: 1 },
      { id: id('proj-empty'), name: 'Empty Project', content: null, sortOrder: 2 },
      { id: id('proj-completed-only'), name: 'Completed Only Project', content: null, sortOrder: 3 },
    ],
    issues: [
      { id: id('issue-active'), identifier: 'E2E-1', title: 'Active task', description: '', projectId: id('proj-active'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('issue-active')}` },
      { id: id('issue-completed'), identifier: 'E2E-2', title: 'Completed task', description: '', projectId: id('proj-completed-only'), sortOrder: 1, state: { name: 'Done', type: 'completed' }, completedAt: '2024-01-10T00:00:00Z', url: `/workspace/${urlKey}/issue/${id('issue-completed')}` },
    ],
  };
}

test.describe('Empty-project default collapse (LIN-2514)', () => {
  test('empty project starts collapsed and hides add-task; completed-only project stays open', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(emptyProjectSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const emptyId = localSeedId(localWorkerUrlKey, 'proj-empty');
    const emptyProject = page.locator(`.project[data-id="${emptyId}"]`);

    // Default-collapse hint present, arrow closed.
    await expect(emptyProject).toHaveAttribute('data-default-collapsed', 'true');
    await expect(emptyProject.locator('.project-header')).toHaveText(/^▶/);

    // Only the header is visible — this is what catches an add-task-link
    // regression that a page-height assertion alone would miss (a collapsed
    // project with a visible add-task-link still occupies two rows).
    await expect(emptyProject.locator('.add-task-link')).toBeHidden();
    await expect(emptyProject.locator('.project-description')).toBeHidden();
    await expect(emptyProject.locator('.project-meta')).toBeHidden();
    const headerBox = await emptyProject.locator('.project-header').boundingBox();
    const projectBox = await emptyProject.boundingBox();
    expect(projectBox.height).toBeLessThanOrEqual(headerBox.height + 1);

    // Completed-only project (zero incomplete, one completed) stays open: no
    // default-collapse hint, arrow open, and its live "show N completed"
    // toggle remains reachable.
    const completedOnlyId = localSeedId(localWorkerUrlKey, 'proj-completed-only');
    const completedOnlyProject = page.locator(`.project[data-id="${completedOnlyId}"]`);
    await expect(completedOnlyProject).not.toHaveAttribute('data-default-collapsed', 'true');
    await expect(completedOnlyProject.locator('.project-header')).toHaveText(/^▼/);
    await expect(completedOnlyProject.locator('.completed-toggle')).toBeVisible();

    // Pre-populate stored collapse state that does NOT include the empty
    // project's id, then reload — proves the union override reaches a
    // returning user with existing (but unrelated) stored state, not just a
    // first-load-only default.
    await page.evaluate(() => {
      localStorage.setItem('linear-projects-state', JSON.stringify({
        expanded: [],
        hideCompleted: [],
        collapsedProjects: [],
        inProgressCollapsed: false,
        recentActivityCollapsed: true,
      }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const emptyProjectAfterReload = page.locator(`.project[data-id="${emptyId}"]`);
    await expect(emptyProjectAfterReload.locator('.project-header')).toHaveText(/^▶/);
    await expect(emptyProjectAfterReload.locator('.add-task-link')).toBeHidden();
  });
});
