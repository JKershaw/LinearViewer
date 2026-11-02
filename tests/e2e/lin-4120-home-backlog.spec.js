// LIN-4120 (S3a-3): Home lets go of the project sections. Witnesses from the approved plan (LIN-4112, Rev 3):
//   W1  — on Home the top task sits inside the In Progress section (P1).
//   W5  — Home stays bounded as the backlog grows: Home's HTML barely changes between two fixture sizes, while /backlog
//         grows. It fails on the pre-S3a-3 tree, which grew Home by about 8.5 KB per 11 projects.
//   W7  — Home has no project sections and one Backlog link, which carries the assignee filter; the onboarding hint
//         and Add task's back, Cancel and after-create all land on /backlog.
// Seeded through tests/fixtures/local-harness.js; selectors through tests/helpers.js SELECTORS.

import { test, expect } from '../fixtures/test-base.js';
import { localSeedId, assigneeFilterLocalSeed } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
const EXTRA_PROJECTS = 11;

// Fixture A: a few projects with an In Progress front card, Up next, Backlog and a done task.
function seedA(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [
      { id: id('proj-a'), name: 'W5 Alpha', content: 'A', sortOrder: 1 },
      { id: id('proj-b'), name: 'W5 Beta', content: 'B', sortOrder: 2 },
    ],
    issues: [
      { id: id('a-front'), identifier: 'W5-FRONT', title: 'W5 front card', projectId: id('proj-a'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
      { id: id('a-todo'), identifier: 'W5-TODO', title: 'W5 next up', projectId: id('proj-a'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
      { id: id('a-backlog'), identifier: 'W5-BL', title: 'W5 backlog', projectId: id('proj-a'), sortOrder: 3, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } },
      { id: id('a-done'), identifier: 'W5-DONE', title: 'W5 finished', projectId: id('proj-b'), sortOrder: 1, createdAt: OLD, state: { name: 'Done', type: 'completed' } },
      { id: id('b-todo'), identifier: 'W5-BTODO', title: 'W5 beta next', projectId: id('proj-b'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    ],
  };
}

// Fixture B: A, plus eleven extra projects each with Up next and Backlog tasks, plus more of both in project A. The extra
// tasks rank below A's front card, so the top task is the same on both fixtures (W5 asserts it before comparing bytes).
function seedB(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  const base = seedA(urlKey);
  for (let p = 0; p < EXTRA_PROJECTS; p += 1) {
    base.projects.push({ id: id(`x-proj-${p}`), name: `W5 Extra ${p}`, content: 'x', sortOrder: 10 + p });
    base.issues.push(
      { id: id(`x-todo-${p}`), identifier: `W5-X${p}T`, title: `W5 extra next ${p}`, projectId: id(`x-proj-${p}`), sortOrder: 1, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
      { id: id(`x-bl-${p}`), identifier: `W5-X${p}B`, title: `W5 extra backlog ${p}`, projectId: id(`x-proj-${p}`), sortOrder: 2, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } },
    );
  }
  for (let i = 0; i < 4; i += 1) {
    base.issues.push(
      { id: id(`a-more-todo-${i}`), identifier: `W5-AT${i}`, title: `W5 more next ${i}`, projectId: id('proj-a'), sortOrder: 20 + i, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
      { id: id(`a-more-bl-${i}`), identifier: `W5-AB${i}`, title: `W5 more backlog ${i}`, projectId: id('proj-a'), sortOrder: 30 + i, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } },
    );
  }
  return base;
}

// A genuine fresh local workspace: POST /workspace/new seeds the starter tasks (LOCAL-1, LOCAL-2) and redirects to Home.
async function freshLocalWorkspace(page) {
  const resp = await page.request.post('/workspace/new', { form: { name: 'LIN-4120 Fresh' } });
  const m = new URL(resp.url()).pathname.match(/^\/workspace\/([^/]+)\//);
  expect(m, `new workspace redirect carries a urlKey: ${resp.url()}`).not.toBeNull();
  return decodeURIComponent(m[1]);
}

/** Home's HTML as the server renders it for this session (the same request a reload makes). */
async function pageHtml(page, path) {
  const resp = await page.request.get(path);
  expect(resp.ok(), `GET ${path} is ok`).toBeTruthy();
  return resp.text();
}

/** The data-id of the one row carrying the top-task mark, or null. */
function markedId(html) {
  const tag = (html.match(/<div class="line[^"]*"[^>]*data-top-task="1"[^>]*>/) || [])[0] || '';
  return (tag.match(/data-id="([^"]+)"/) || [])[1] || null;
}

test.describe('LIN-4120 W1 — the top task stays in In Progress on Home', () => {
  test('the marked row sits inside the In Progress section', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(seedA(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.in-progress-section [data-top-task="1"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="project"]')).toHaveCount(0);
  });
});

test.describe('LIN-4120 W5 — Home stays bounded as the backlog grows (CI)', () => {
  test('Home barely changes between two fixture sizes, while /backlog grows', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(seedA(localWorkerUrlKey));
    const homeA = await pageHtml(page, `/workspace/${localWorkerUrlKey}/`);
    const backlogA = await pageHtml(page, `/workspace/${localWorkerUrlKey}/backlog`);

    await seedLocal(seedB(localWorkerUrlKey));
    const homeB = await pageHtml(page, `/workspace/${localWorkerUrlKey}/`);
    const backlogB = await pageHtml(page, `/workspace/${localWorkerUrlKey}/backlog`);

    // The same front card on both fixtures, so the byte comparison is not comparing two different Homes.
    expect(markedId(homeB), 'the top task is the same row on both fixtures').toBe(markedId(homeA));
    expect(markedId(homeA), 'the fixture has a marked top task').not.toBeNull();

    // Home: no project section on either fixture, and the byte length stays within 256 B across the eleven extra projects.
    expect(homeA.includes('data-testid="project"')).toBe(false);
    expect(homeB.includes('data-testid="project"')).toBe(false);
    const delta = Math.abs(Buffer.byteLength(homeB, 'utf8') - Buffer.byteLength(homeA, 'utf8'));
    expect(delta, `Home grew by ${delta} B across ${EXTRA_PROJECTS} extra projects`).toBeLessThanOrEqual(256);

    // /backlog: the same pair must differ, which shows the extra projects were really seeded and rendered.
    expect(Buffer.byteLength(backlogB, 'utf8')).toBeGreaterThan(Buffer.byteLength(backlogA, 'utf8'));
    expect(backlogB.includes('W5 Extra 0')).toBe(true);
  });
});

test.describe('LIN-4120 W7 — Home has one Backlog link, and Add task returns to /backlog', () => {
  test('Home has no project sections and exactly one Backlog link that opens the backlog page', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(seedA(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="project"]')).toHaveCount(0);
    const link = page.locator(SELECTORS.homeBacklogLink);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Backlog ›');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/backlog$`));
    await expect(page.locator(SELECTORS.project('W5 Alpha'))).toBeVisible();
  });

  test('the Backlog link carries Home\'s assignee filter', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(assigneeFilterLocalSeed(localWorkerUrlKey));
    await page.goto(`/workspace/${localWorkerUrlKey}/?assignee=${encodeURIComponent('Other User')}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.homeBacklogLink)).toHaveAttribute('href', `/workspace/${localWorkerUrlKey}/backlog?assignee=Other%20User`);
  });

  test('on a seed-only workspace the onboarding hint links to /backlog, and /backlog shows Add task', async ({ page }) => {
    const urlKey = await freshLocalWorkspace(page);
    await page.goto(`/workspace/${urlKey}/`);
    await page.waitForLoadState('networkidle');
    const hintLink = page.locator('[data-testid="home-onboarding-backlog-link"]');
    await expect(hintLink).toHaveText('Add your own task');
    await expect(hintLink).toHaveAttribute('href', `/workspace/${urlKey}/backlog`);
    await hintLink.click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/backlog$`));
    await expect(page.locator('[data-testid="create-task-trigger"]').first()).toHaveText('+ Add task');
  });

  test('Add task\'s back link, Cancel and after-create each land on /backlog', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(seedA(localWorkerUrlKey));
    const backlogUrl = new RegExp(`/workspace/${localWorkerUrlKey}/backlog$`);
    const openAddTask = async () => {
      await page.goto(`/workspace/${localWorkerUrlKey}/backlog`);
      await page.waitForLoadState('networkidle');
      await page.locator(SELECTORS.projectAddTask('W5 Alpha')).locator('[data-testid="create-task-trigger"]').click();
      await expect(page.locator('[data-testid="task-create-form"]')).toBeVisible();
    };

    await openAddTask();
    await page.locator('[data-testid="task-create-back"]').click();
    await expect(page).toHaveURL(backlogUrl);

    await openAddTask();
    await page.locator('[data-testid="task-create-cancel"]').click();
    await expect(page).toHaveURL(backlogUrl);

    await openAddTask();
    await page.locator('[data-testid="task-create-title"]').fill('W5 created from backlog');
    await page.locator('[data-testid="task-create-submit"]').click();
    await expect(page).toHaveURL(backlogUrl);
  });
});
