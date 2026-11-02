// LIN-4119 (S3a-2): the /workspace/:urlKey/backlog page, its one control line per project, and Add task in the project
// header (witnesses W3 and W4 of the approved plan). Driven through tests/fixtures/local-harness.js for seeding and
// tests/helpers.js SELECTORS for every selector the spec does not already hold as a literal.

import { test, expect } from '../fixtures/test-base.js';
import { localSeedId, assigneeFilterLocalSeed } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

const OLD = '2020-01-01T00:00:00Z';
const STATE_KEY = 'linear-projects-state';
const DESIGN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Project A: a Backlog of 55 (more than one page of 50, so its fold pages), plus one done task.
// Project B: a Backlog of 3 and two done tasks. Both have folds and a done count, so both get a control line.
function backlogSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  const issues = [];
  for (let i = 0; i < 55; i += 1) {
    issues.push({ id: id(`a-b${i}`), identifier: `W3A-B${i}`, title: `Backlog A ${i}`, projectId: id('proj-a'), sortOrder: 10 + i, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } });
  }
  issues.push({ id: id('a-done'), identifier: 'W3A-D1', title: 'Finished A', projectId: id('proj-a'), sortOrder: 1, createdAt: OLD, state: { name: 'Done', type: 'completed' } });
  for (let i = 0; i < 3; i += 1) {
    issues.push({ id: id(`b-b${i}`), identifier: `W3B-B${i}`, title: `Backlog B ${i}`, projectId: id('proj-b'), sortOrder: 10 + i, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } });
  }
  issues.push({ id: id('b-done1'), identifier: 'W3B-D1', title: 'Finished B 1', projectId: id('proj-b'), sortOrder: 1, createdAt: OLD, state: { name: 'Done', type: 'completed' } });
  issues.push({ id: id('b-done2'), identifier: 'W3B-D2', title: 'Finished B 2', projectId: id('proj-b'), sortOrder: 2, createdAt: OLD, state: { name: 'Done', type: 'completed' } });
  return {
    projects: [
      { id: id('proj-a'), name: 'Folds A', content: 'A', sortOrder: 1 },
      { id: id('proj-b'), name: 'Folds B', content: 'B', sortOrder: 2 },
    ],
    issues,
  };
}

// W4: one project with an In Progress task (shown In Progress on Home) and a Todo task (shown in the project).
function inProgressSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [{ id: id('proj-ip'), name: 'IP project', content: 'IP', sortOrder: 1 }],
    issues: [
      { id: id('ip-1'), identifier: 'W4-IP', title: 'Working task', projectId: id('proj-ip'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
      { id: id('ip-2'), identifier: 'W4-TODO', title: 'Waiting task', projectId: id('proj-ip'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    ],
  };
}

// W4: Todo tasks to open from their project rows, for the run control or the copy-first view. The front card is the
// top task, which Home shows In Progress and /backlog leaves out by design, so the spec opens the first row the
// project section does show.
function openableSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  const todo = (n) => ({ id: id(`run-${n}`), identifier: `W4-RUN${n}`, title: `Runnable task ${n}`, description: 'Seeded for a run', projectId: id('proj-run'), sortOrder: n, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } });
  return {
    projects: [{ id: id('proj-run'), name: 'Run project', content: 'R', sortOrder: 1 }],
    issues: [todo(1), todo(2), todo(3)],
  };
}

const projectOf = (page, name) => page.locator(SELECTORS.project(name));
const controlsOf = (page, name) => page.locator(SELECTORS.projectControls(name));

test.describe('LIN-4119 W3 — the /backlog control line and header Add task (local provider)', () => {
  test.beforeEach(async ({ seedLocal, localWorkerUrlKey, page }) => {
    await seedLocal(backlogSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await page.waitForLoadState('networkidle');
  });

  test('each project has exactly one control line, holding its folds and its done count', async ({ page }) => {
    for (const name of ['Folds A', 'Folds B']) {
      await expect(controlsOf(page, name)).toHaveCount(1);
    }
    const a = controlsOf(page, 'Folds A');
    await expect(a.locator('[data-testid="home-fold-backlog"]')).toHaveCount(1);
    await expect(a.locator('[data-testid="home-done-count"]')).toHaveText('1 done');
    const b = controlsOf(page, 'Folds B');
    await expect(b.locator('[data-testid="home-fold-backlog"]')).toHaveCount(1);
    await expect(b.locator('[data-testid="home-done-count"]')).toHaveText('2 done');
  });

  test('exactly one Add task per project, in its header (not in the control line)', async ({ page }) => {
    for (const name of ['Folds A', 'Folds B']) {
      await expect(page.locator(SELECTORS.projectAddTask(name))).toHaveCount(1);
      await expect(controlsOf(page, name).locator('[data-testid="create-task"]')).toHaveCount(0);
    }
  });

  test('clicking Add task opens Add task, leaves the project expanded and saves no collapsed state', async ({ page }) => {
    // The create page is held back so the spec can see the page it left: the click must not collapse the project first.
    // A capture-phase preventDefault cancels the navigation only; the app's own click handler still runs.
    await page.evaluate(() => document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('a[href*="/task/new"]')) e.preventDefault();
    }, true));
    const addTask = page.locator(SELECTORS.projectAddTask('Folds A')).locator('a');
    await addTask.click();
    await expect(controlsOf(page, 'Folds A')).toBeVisible();
    await expect(page.locator(SELECTORS.project('Folds A')).locator('[data-testid="project-header"] .project-name')).toHaveText(/^▼/);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STATE_KEY);
    const collapsed = (saved?.collapsedProjects ?? []);
    expect(collapsed.length).toBe(0);
  });

  test('opening the Backlog fold inserts its rows before the control line, not before the fold', async ({ page }) => {
    const a = controlsOf(page, 'Folds A');
    await a.locator('[data-testid="home-fold-backlog"]').click();
    await expect(projectOf(page, 'Folds A').locator('.home-fetched .node').first()).toBeAttached();
    const before = await a.evaluate((el) => el.previousElementSibling?.classList.contains('home-fetched') ?? false);
    expect(before).toBe(true);
  });

  test('collapse hides the whole control line, including "N done"; expand brings it back', async ({ page }) => {
    const a = controlsOf(page, 'Folds A');
    const done = a.locator('[data-testid="home-done-count"]');
    await expect(done).toBeVisible();
    await projectOf(page, 'Folds A').locator('.project-name').click();
    await expect(a).toBeHidden();
    await expect(done).toBeHidden();
    await projectOf(page, 'Folds A').locator('.project-name').click();
    await expect(a).toBeVisible();
    await expect(done).toBeVisible();
  });

  test('collapse, expand, then reload while collapsed: one Add task stays visible, and the arrow and name still toggle', async ({ page }) => {
    const project = projectOf(page, 'Folds A');
    const name = project.locator('[data-testid="project-header"] .project-name');
    await name.click();
    await name.click();
    await name.click();
    await expect(name).toHaveText(/^▶/);
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Review finding 2: the control line (folds and "N done") is hidden by applyState on reload, not just on click.
    await expect(controlsOf(page, 'Folds A')).toBeHidden();
    await expect(project.locator('[data-testid="project-header"] [data-testid="create-task"]')).toHaveCount(1);
    await expect(project.locator('[data-testid="project-header"] [data-testid="create-task"]')).toBeVisible();
    await expect(name).toHaveText(/^▶/);
    await name.click();
    await expect(name).toHaveText(/^▼/);
    await expect(controlsOf(page, 'Folds A')).toBeVisible();
    await name.click();
    await expect(name).toHaveText(/^▶/);
  });

  test('a fold with one page of several keeps its separator; the last page removes the fold with no stray "·"', async ({ page }) => {
    const a = controlsOf(page, 'Folds A');
    const fold = a.locator('[data-testid="home-fold-backlog"]');
    const done = a.locator('[data-testid="home-done-count"]');
    await fold.click();
    await expect(fold).toHaveText('4 backlog ▶');
    expect(await done.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('·');
    await fold.click();
    await expect(a.locator('[data-testid="home-fold-backlog"]')).toHaveCount(0);
    expect(await done.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  });
});

test.describe('LIN-4119 W4 — the /backlog page, its access and its guards', () => {
  test('a task in Home\'s In Progress is absent from its /backlog project, and Home shows it In Progress', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(inProgressSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await expect(page.locator('.in-progress-section .line[data-identifier="W4-IP"]')).toHaveCount(1);
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    const section = page.locator(SELECTORS.backlogPage.projects);
    await expect(section.locator('.line[data-identifier="W4-IP"]')).toHaveCount(0);
    await expect(section.locator('.line[data-identifier="W4-TODO"]')).toHaveCount(1);
    await expect(page.locator(SELECTORS.backlogPage.inProgress)).toHaveCount(0);
  });

  test('signed out, /backlog answers as Home does', async ({ browser, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(inProgressSeed(localWorkerUrlKey));
    const anon = await browser.newContext();
    try {
      const home = await anon.request.get(`/workspace/${localWorkerUrlKey}/`, { maxRedirects: 0 });
      const backlog = await anon.request.get(`/workspace/${localWorkerUrlKey}/backlog`, { maxRedirects: 0 });
      expect(backlog.status()).toBe(home.status());
      expect(backlog.headers()['location']).toBe(home.headers()['location']);
    } finally {
      await anon.close();
    }
  });

  test('a workspace not in the session answers /backlog as Home does', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(inProgressSeed(localWorkerUrlKey));
    const home = await page.request.get('/workspace/not-in-session-w4/', { maxRedirects: 0 });
    const backlog = await page.request.get('/workspace/not-in-session-w4/backlog', { maxRedirects: 0 });
    expect(home.status()).toBe(404);
    expect(backlog.status()).toBe(home.status());
  });

  test('an owner with a runner sees the run control on an opened /backlog row', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(openableSeed(localWorkerUrlKey), { openRouterConnected: true, runnerKey: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await page.locator(`${SELECTORS.project('Run project')} .line[data-section="project"]`).first().click();
    await expect(page.locator(`${SELECTORS.project('Run project')} [data-testid="opened-task-go"]`).first()).toBeVisible();
  });

  test('a non-owner member without a runner sees the copy-first view on /backlog', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(openableSeed(localWorkerUrlKey), { openRouterConnected: true, runnerKey: false });
    // Review finding 3: a real non-owner session ('foreign' is the fixture's non-owner state), not the seeded owner.
    await seedWorkspaceOwnership(page, localWorkerUrlKey, 'foreign');
    try {
      await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
      await page.locator(`${SELECTORS.project('Run project')} .line[data-section="project"]`).first().click();
      await expect(page.locator(`${SELECTORS.project('Run project')} [data-testid="opened-task-runner-link"]`).first()).toBeVisible();
      await expect(page.locator(`${SELECTORS.project('Run project')} [data-testid="opened-task-go"]`)).toHaveCount(0);
    } finally {
      await seedWorkspaceOwnership(page, localWorkerUrlKey, 'owner');
    }
  });

  test('the assignee selector and the search toggle render on /backlog, and choosing an assignee stays on /backlog', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(assigneeFilterLocalSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await expect(page.locator('#assignee-toggle')).toBeVisible();
    await expect(page.locator('.search-toggle')).toBeVisible();
    await page.locator('#assignee-toggle').click();
    await page.locator('#assignee-options .nav-option[data-assignee="me"]').click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/backlog\\?assignee=me$`));
    await expect(page.locator('#assignee-toggle')).toHaveText('me');
  });

  test('the search toggle opens the search panel on /backlog', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(inProgressSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    await page.locator('.search-toggle').click();
    await expect(page.locator('#search-panel')).not.toHaveClass(/hidden/);
    await expect(page.locator('#search-input')).toBeFocused();
  });

  test('the team filter renders on /backlog, and choosing a team stays on /backlog', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/backlog`);
    await expect(page.locator('#team-toggle')).toBeVisible();
    await page.locator('#team-toggle').click();
    await page.locator(`#team-options .nav-option[data-team="${DESIGN}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${workerUrlKey}/backlog\\?team=${DESIGN}$`));
  });

  test('the view bar is the same set and hrefs on Home and /backlog (Home\'s own tab is current there, a link here)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(inProgressSeed(localWorkerUrlKey));
    const tabs = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="nav-view-"]')].map((el) => ({
      testid: el.getAttribute('data-testid'),
      link: el.tagName === 'A',
      href: el.getAttribute('href'),
    })));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    const home = await tabs();
    await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
    const backlog = await tabs();
    expect(backlog.map((t) => t.testid)).toEqual(home.map((t) => t.testid));
    for (let i = 0; i < home.length; i += 1) {
      if (home[i].link) {
        expect(backlog[i].href, home[i].testid).toBe(home[i].href);
      } else {
        // Home's own tab: a non-link there, and a link to the same href on /backlog (no tab is current on /backlog).
        expect(backlog[i].link, home[i].testid).toBe(true);
        expect(backlog[i].href, home[i].testid).toBe(`/workspace/${localWorkerUrlKey}/`);
      }
    }
    expect(backlog.filter((t) => !t.link)).toEqual([]);
  });
});
