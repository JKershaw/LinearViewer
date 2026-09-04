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

  // Review F1: init() used to spread state.collapsedProjects straight off
  // loadState() before the shape-normalising block in applyState ran, so a
  // legacy/partial stored value (missing collapsedProjects entirely) threw
  // "state.collapsedProjects is not iterable" at the top of init() and left
  // every delegated handler (collapse/expand, search, reset) unwired.
  test('legacy/partial stored state does not break page JavaScript', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(emptyProjectSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Pre-existing shape from before `collapsedProjects` existed.
    await page.evaluate(() => {
      localStorage.setItem('linear-projects-state', JSON.stringify({
        expanded: [],
        hideCompleted: [],
      }));
    });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.reload();
    await page.waitForLoadState('networkidle');

    expect(pageErrors).toEqual([]);

    // Page JS must still be wired: an active project's header remains
    // clickable and toggles collapse (not just "didn't throw").
    const activeId = localSeedId(localWorkerUrlKey, 'proj-active');
    const activeProject = page.locator(`.project[data-id="${activeId}"]`);
    await expect(activeProject.locator('.project-header')).toHaveText(/^▼/);
    await activeProject.locator('.project-header').click();
    await expect(activeProject.locator('.project-header')).toHaveText(/^▶/);
  });

  // Review F2: the union of stored + default-collapsed ids was written into
  // state.collapsedProjects itself, so ANY subsequent persistState() call (an
  // unrelated toggle elsewhere on the page) wrote the empty project's
  // default-derived id into localStorage as if the user had chosen to
  // collapse it. Once that project later gained its first issue, the server
  // correctly stopped emitting data-default-collapsed, but the stale stored
  // id still forced it collapsed — a bad first impression with no user intent
  // behind it, and a direct contradiction of the plan's written guarantee.
  test('a default-collapsed empty project is not left collapsed after it gains work, despite an unrelated interaction', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const seed = emptyProjectSeed(localWorkerUrlKey);
    await seedLocal(seed);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const emptyId = localSeedId(localWorkerUrlKey, 'proj-empty');
    const activeId = localSeedId(localWorkerUrlKey, 'proj-active');

    // Unrelated interaction: collapse a DIFFERENT (non-empty) project. This is
    // exactly the kind of ordinary toggle that must not leak the empty
    // project's default into persisted state.
    await page.locator(`.project[data-id="${activeId}"] .project-header`).click();

    const storedAfterUnrelatedToggle = await page.evaluate(
      () => JSON.parse(localStorage.getItem('linear-projects-state')).collapsedProjects
    );
    expect(storedAfterUnrelatedToggle).not.toContain(emptyId);
    expect(storedAfterUnrelatedToggle).toContain(activeId);

    // The empty project now gains its first issue (re-seed the same
    // workspace/project id with an added issue) — the server will stop
    // emitting data-default-collapsed for it.
    const seedWithWork = {
      projects: seed.projects,
      issues: [
        ...seed.issues,
        {
          id: localSeedId(localWorkerUrlKey, 'issue-new-in-empty'),
          identifier: 'E2E-3',
          title: 'Newly added task',
          description: '',
          projectId: emptyId,
          sortOrder: 1,
          state: { name: 'Todo', type: 'unstarted' },
          url: `/workspace/${localWorkerUrlKey}/issue/${localSeedId(localWorkerUrlKey, 'issue-new-in-empty')}`,
        },
      ],
    };
    await seedLocal(seedWithWork);
    await page.reload();
    await page.waitForLoadState('networkidle');

    const formerlyEmptyProject = page.locator(`.project[data-id="${emptyId}"]`);
    await expect(formerlyEmptyProject).not.toHaveAttribute('data-default-collapsed', 'true');
    await expect(formerlyEmptyProject.locator('.project-header')).toHaveText(/^▼/);
    await expect(formerlyEmptyProject.locator('.node').first()).toBeVisible();
  });

  // Review F3: resetDOM() re-shows .project-description/.project-meta/
  // .completed-toggle on every project but never learned about
  // .add-task-link when it was added to the collapse hide-lists, so "Reset
  // view" on an already-expanded project silently dropped its + Add task
  // control until a full page reload.
  test('Reset view restores + Add task on an expanded project', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(emptyProjectSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const activeId = localSeedId(localWorkerUrlKey, 'proj-active');
    const activeProject = page.locator(`.project[data-id="${activeId}"]`);
    const header = activeProject.locator('.project-header');
    const addTaskLink = activeProject.locator('.add-task-link');

    // Manually collapse the project so it is actually EXPANDED-BUT-was-
    // collapsed state that "Reset view" must restore — resetDOM()'s
    // unconditional re-show pass is what the regression hits, and it only
    // shows up when the control was genuinely hidden beforehand.
    await header.click();
    await expect(header).toHaveText(/^▶/);
    await expect(addTaskLink).toBeHidden();

    await page.locator('.reset-view').click();

    await expect(header).toHaveText(/^▼/);
    await expect(addTaskLink).toBeVisible();
  });

  // Review F5: clearSearchState() called applyState(loadState()) directly,
  // bypassing the default-collapse union init() applies — so closing search
  // reverted a default-collapsed empty project's header to ▼ while its
  // (nonexistent) children stayed hidden, an expanded-looking project with
  // nothing under it.
  test('closing search restores the empty project\'s collapsed state', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(emptyProjectSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const emptyId = localSeedId(localWorkerUrlKey, 'proj-empty');
    const emptyProject = page.locator(`.project[data-id="${emptyId}"]`);
    await expect(emptyProject.locator('.project-header')).toHaveText(/^▶/);

    const searchToggle = page.locator('.search-toggle');
    const searchInput = page.locator('#search-input');
    await searchToggle.click();
    await searchInput.fill('active');
    await expect(searchInput).toHaveValue('active');

    // Escape closes search and restores the underlying view.
    await searchInput.press('Escape');

    await expect(emptyProject.locator('.project-header')).toHaveText(/^▶/);
    await expect(emptyProject.locator('.add-task-link')).toBeHidden();
  });

  // Review F4: the manual-toggle half of the .add-task-link wiring
  // (handleProjectHeaderClick's hide/show branches) shipped with zero
  // coverage — mutation-checked in review (removing it left 43 specs green).
  test('manual collapse hides + Add task, manual re-expand restores it', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(emptyProjectSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const activeId = localSeedId(localWorkerUrlKey, 'proj-active');
    const activeProject = page.locator(`.project[data-id="${activeId}"]`);
    const header = activeProject.locator('.project-header');
    const addTaskLink = activeProject.locator('.add-task-link');

    await expect(header).toHaveText(/^▼/);
    await expect(addTaskLink).toBeVisible();

    await header.click();
    await expect(header).toHaveText(/^▶/);
    await expect(addTaskLink).toBeHidden();

    await header.click();
    await expect(header).toHaveText(/^▼/);
    await expect(addTaskLink).toBeVisible();
  });
});
