import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4024 (witness D, the shape measure): Home on a workspace of this workspace's shape, seeded locally: ~3,700 tasks in
// 11 projects, ~60% with a parent, ~63% done, and a started charter root over one project's tree. The page must hold the
// work that needs a person and the next tasks, fold the Backlog, and never send a done task.
//
// Run on its own, not in the E2E pool: rendering this Home is synchronous work on the one server every spec shares, and
// beside the timing-sensitive specs it made them flake (LIN-4024, the PR). `npm run test:home-shape` runs it on one worker.

const TASKS = 3704;
const PROJECTS = 11;
const OLD = '2020-01-01T00:00:00Z';
// The page's HTML ceiling for this shape (witness D): about 2.4x the measured 124 KB. The pre-LIN-4024 page was several
// megabytes on this shape (see the PR's measurement), so a regression to it fails by a wide margin.
const HTML_BYTES_CEILING = 300_000;
// Inline style attributes on the page. The rows carry none now (LIN-4024 deleted the --depth attribute).
const INLINE_STYLE_CEILING = 50;

let URL_KEY;

test.setTimeout(180000);

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
});

/**
 * The seeded shape. Task i belongs to project i % 11. Within a project, the k-th task (k = floor(i / 11)) is a root
 * when k % 5 is 0 or 1; the others are children of the root five slots back, so ~60% are parented, two levels deep.
 * Done is ~63% (r < 635 of every 1000). Task 0 is a started charter root: its block is the started tree.
 */
function seededIssues(id) {
  const issues = [];
  for (let i = 0; i < TASKS; i += 1) {
    const project = i % PROJECTS;
    const k = Math.floor(i / PROJECTS);
    const slot = k % 5;
    let parentIdx = null;
    if (slot === 1) parentIdx = i - PROJECTS;
    else if (slot >= 2) parentIdx = i - PROJECTS * slot;
    const r = i % 1000;
    let state;
    if (i === 0 || (i % 50 === 7 && slot < 2 && r >= 635)) state = { name: 'In Progress', type: 'started' };
    else if (r < 635) state = { name: 'Done', type: 'completed' };
    else if (i % 4 === 0) state = { name: 'Todo', type: 'unstarted' };
    else state = { name: 'Backlog', type: 'backlog' };
    // The Backlog and Done titles carry their numbers, so search and the fold can find a named task.
    const title = state.type === 'completed' ? `Finished item ${i}` : (state.type === 'backlog' ? `Backlog task ${i}` : `Open task ${i}`);
    const issue = {
      id: id(`t${i}`),
      identifier: `LOCAL-${i}`,
      title,
      projectId: id(`proj-${project}`),
      sortOrder: i,
      createdAt: OLD,
      state,
    };
    if (parentIdx !== null && i !== 0) issue.parentId = id(`t${parentIdx}`);
    if (i === 0) Object.assign(issue, { title: 'Charter root, started', description: 'The charter, with work under it.', url: 'https://example.com/charter' });
    issues.push(issue);
  }
  return issues;
}

async function seedWorkspace(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const projects = Array.from({ length: PROJECTS }, (_, p) => ({ id: id(`proj-${p}`), name: `Project ${p}`, content: `Seeded project ${p}`, sortOrder: p }));
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey: URL_KEY, runnerKey: false, projects, issues: seededIssues(id) },
  });
  expect(resp.ok()).toBeTruthy();
}

test('Home on a few thousand tasks: the page is small, done tasks never reach it, and the Backlog waits for its fold', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator('.in-progress-section')).toBeVisible();

  const html = await page.content();
  const bytes = Buffer.byteLength(html, 'utf8');
  const rows = await page.locator('[data-testid="issue-line"]').count();
  const inlineStyles = (html.match(/ style="/g) || []).length;
  console.log(`LIN-4024 measure: html=${bytes} bytes rows=${rows} inlineStyle=${inlineStyles}`);
  expect(bytes).toBeLessThan(HTML_BYTES_CEILING);
  expect(inlineStyles).toBeLessThan(INLINE_STYLE_CEILING);

  // No done task is sent except in Recent activity, which is a separate, one-day set.
  await expect(page.locator('[data-section="project"] .title.done')).toHaveCount(0);
  await expect(page.locator('.in-progress-section .title.done')).toHaveCount(0);
  await expect(page.locator('[data-testid="home-done-count"]').first()).toContainText('done');

  // The Backlog is folded: its tasks come in when the fold opens, one page of 50 at a time. (Backlog rows that are the
  // ancestor of an In Progress or Up next task stay on the page as context, so the check is the page's growth.)
  const backlogRows = page.locator('.project .line', { hasText: 'Backlog task' });
  const before = await backlogRows.count();
  await page.locator('[data-testid="home-fold-backlog"]').first().click();
  await expect.poll(() => backlogRows.count()).toBeGreaterThan(before);
  console.log(`LIN-4024 measure: the first Backlog fold added ${(await backlogRows.count()) - before} rows`);
});

// Witness F (timing): the server's cost for Home's state build (the page render, which builds each row's state and the
// trimmed view) and for the open-ruling reduction (the badge's read, the same reduction Home's count line uses). The
// seeded shape has no open rulings yet, so the reduction here runs over an empty set; a ruling-bearing shape is not
// timed by this spec.
test('the state build and the open-ruling reduction are timed on this shape', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator('.in-progress-section')).toBeVisible();

  const renderStart = Date.now();
  const render = await page.request.get(`/workspace/${URL_KEY}/`);
  const renderMs = Date.now() - renderStart;
  const reductionStart = Date.now();
  const rulings = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
  const reductionMs = Date.now() - reductionStart;
  console.log(`LIN-4024 measure: home render ${renderMs} ms (status ${render.status()}), open-ruling reduction ${reductionMs} ms (status ${rulings.status()}, ${TASKS} tasks, no open rulings)`);
  expect(render.ok()).toBeTruthy();
  expect(rulings.ok()).toBeTruthy();
});

