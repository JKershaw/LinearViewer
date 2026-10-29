import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4024 (witness D and E): Home on a workspace of this workspace's shape, seeded locally: ~3,700 tasks in 11
// projects, ~60% with a parent, ~63% done, and a started charter root over one project's tree. The page must hold
// the work that needs a person and the next tasks, fold the Backlog, and never send a done task. The lazy route
// (/api/home-rows) must refuse a non-member and never return a done task, whatever the query.

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

test('the charter root opens with its own state, one opened task and no box inside another', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/workspace/${URL_KEY}/`);

  const charter = page.locator('.in-progress-section .line[data-identifier="LOCAL-0"]');
  await expect(charter).toBeVisible();
  await charter.click();
  const opened = page.locator('[data-testid="opened-task"]').first();
  await expect(opened).toBeVisible();

  await expect(page.locator('.opened-task .opened-task')).toHaveCount(0);

  // The copy-first viewer has one primary action in the opened task.
  const primaries = await page.locator('.opened-task .btn--primary').count();
  expect(primaries).toBeLessThanOrEqual(1);

  // Every text run the opened task shows (not the hidden ones) is at least 12px on a 390px phone.
  const smallest = await page.evaluate(() => {
    const root = document.querySelector('.opened-task');
    let min = { size: Infinity };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.getClientRects().length === 0) continue;
      const size = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (size < min.size) min = { size, where: `${n.parentElement.tagName.toLowerCase()}.${n.parentElement.className}`, text: n.textContent.trim().slice(0, 40) };
    }
    return min;
  });
  console.log(`LIN-4024 measure: smallest opened-task text ${smallest.size}px at 390px: ${smallest.where} "${smallest.text}"`);
  expect(smallest.size).toBeGreaterThanOrEqual(12);
});

test('search finds a Backlog task the page does not hold, under its ancestors', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto(`/workspace/${URL_KEY}/`);

  await page.locator('.search-toggle').click();
  await page.locator('#search-input').fill('Backlog task 2901');
  const results = page.locator('[data-testid="home-search-results"]');
  await expect(results.locator('[data-identifier="LOCAL-2901"]')).toHaveCount(1);
});

test.describe('the lazy rows route (witness E)', () => {
  test('refuses a workspace the session is not a member of, the way /api/detail refuses it', async ({ page }) => {
    await seedWorkspace(page);
    const rows = await page.request.get('/workspace/not-a-member-workspace/api/home-rows?kind=search&q=item');
    const detail = await page.request.get('/workspace/not-a-member-workspace/api/detail/LOCAL-1');
    expect(rows.status()).toBe(detail.status());
    expect(rows.status()).not.toBe(200);
    const body = await rows.text();
    expect(body).not.toContain('Finished item');
  });

  test('refuses a request with no session', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const rows = await anonymous.get(`/workspace/${URL_KEY}/api/home-rows?kind=search&q=item`);
    expect(rows.status()).toBe(401);
    await anonymous.dispose();
  });

  test('never returns a done task, whatever the query', async ({ page }) => {
    await seedWorkspace(page);
    const queries = [
      `kind=search&q=${encodeURIComponent('Finished item')}`,
      `kind=search&q=${encodeURIComponent('Finished item 4')}`,
      `kind=backlog&project=${encodeURIComponent(localSeedId(URL_KEY, 'proj-0'))}&offset=0`,
      `kind=up-next&project=${encodeURIComponent(localSeedId(URL_KEY, 'proj-0'))}&offset=0`,
    ];
    for (const query of queries) {
      const resp = await page.request.get(`/workspace/${URL_KEY}/api/home-rows?${query}`);
      expect(resp.ok(), query).toBeTruthy();
      const body = await resp.text();
      expect(body, query).not.toContain('Finished item');
      expect(body, query).not.toMatch(/class="title done"/);
    }
  });
});
