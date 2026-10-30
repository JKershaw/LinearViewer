import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4024 (volume): Home holds what needs you, what runs and what is next, and folds the rest. Witnesses in a real
// browser: a done task never reaches the page; a project's Backlog opens a page of rows at a time; a started
// parent's folded child opens with the parent; and search finds a folded task the page does not hold.

// More Backlog tasks than one page (HOME_ROWS_PAGE = 50), so the fold has a second page to fetch.
const BACKLOG = 55;
// Old enough that Recent activity (a day or so) does not hold the seeded tasks, so only the folds can show them.
const OLD = '2020-01-01T00:00:00Z';
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
});

async function seedFolds(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issues = [
    { id: id('parent'), identifier: 'LOCAL-F1', title: 'Started parent', projectId: id('proj'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('kid-started'), identifier: 'LOCAL-F2', title: 'Started child', projectId: id('proj'), parentId: id('parent'), sortOrder: 2, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('kid-todo'), identifier: 'LOCAL-F3', title: 'Folded todo child', projectId: id('proj'), parentId: id('parent'), sortOrder: 3, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('done'), identifier: 'LOCAL-F4', title: 'Finished in a fold', projectId: id('proj'), sortOrder: 4, createdAt: OLD, state: { name: 'Done', type: 'completed' } },
  ];
  for (let i = 0; i < BACKLOG; i += 1) {
    issues.push({ id: id(`b${i}`), identifier: `LOCAL-B${i}`, title: `Backlog item ${i}`, projectId: id('proj'), sortOrder: 10 + i, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } });
  }
  // Sorts last, so it is on the last page of the Backlog, not the first.
  issues.push({ id: id('needle'), identifier: 'LOCAL-N1', title: 'Zebra quarterly report', projectId: id('proj'), sortOrder: 999, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } });
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: false,
      projects: [{ id: id('proj'), name: 'Folds project', content: 'Seeded for the folds', sortOrder: 1 }],
      issues,
    },
  });
  expect(resp.ok()).toBeTruthy();
}

test('a done task never reaches the page, and the project shows its Backlog as a fold', async ({ page }) => {
  await seedFolds(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  const project = page.locator('[data-testid="project"][data-project-name="Folds project"]');
  await expect(project.locator('[data-testid="home-fold-backlog"]')).toContainText('in Backlog');
  await expect(project.locator('[data-testid="home-done-count"]')).toContainText('1 done');
  await expect(page.locator('[data-section="project"][data-identifier="LOCAL-F4"]')).toHaveCount(0);
  await expect(project.locator('[data-identifier^="LOCAL-B"]')).toHaveCount(0);
});

test('the Backlog fold opens a page of rows at a time, and goes when the last page is in', async ({ page }) => {
  await seedFolds(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  const project = page.locator('[data-testid="project"][data-project-name="Folds project"]');
  const fold = project.locator('[data-testid="home-fold-backlog"]');
  await fold.click();
  await expect(project.locator('[data-identifier^="LOCAL-B"]')).toHaveCount(50);
  await expect(fold).toContainText('show 6 more');

  await fold.click();
  await expect(project.locator('[data-identifier^="LOCAL-B"]')).toHaveCount(BACKLOG);
  await expect(project.locator('[data-identifier="LOCAL-N1"]')).toHaveCount(1);
  await expect(project.locator('[data-testid="home-fold-backlog"]')).toHaveCount(0);
});

test('a started parent\'s folded child opens with the parent', async ({ page }) => {
  await seedFolds(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  const parentLine = page.locator('.in-progress-section .line[data-identifier="LOCAL-F1"]');
  await expect(parentLine).toBeVisible();
  await parentLine.click();
  const more = page.locator('.in-progress-section [data-home-fetch="more-of-parent"]');
  await expect(more).toBeVisible();
  await expect(more).toContainText('show 1 more');
  await more.click();
  await expect(page.locator('.in-progress-section .line[data-identifier="LOCAL-F3"]')).toBeVisible();
  await expect(page.locator('.in-progress-section .line[data-identifier="LOCAL-F4"]')).toHaveCount(0);
});

test('search finds a Backlog task the page does not hold, and shows it once', async ({ page }) => {
  await seedFolds(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  await page.locator('.search-toggle').click();
  await page.locator('#search-input').fill('zebra');
  const results = page.locator('[data-testid="home-search-results"]');
  await expect(results.locator('[data-identifier="LOCAL-N1"]')).toBeVisible();
  await expect(page.locator('[data-identifier="LOCAL-N1"]')).toHaveCount(1);
  await expect(page.locator('#search-no-results')).toBeHidden();
});
