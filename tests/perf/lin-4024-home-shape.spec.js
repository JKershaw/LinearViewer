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
// LIN-4120: Home draws no project sections, so its HTML is the header, In Progress, Recent activity and one Backlog link.
// Its ceiling is about 100 KB on this shape. The backlog page carries every project, so it keeps the LIN-4024 ceiling:
// about 2.4x the measured 124 KB. The pre-LIN-4024 page was several megabytes on this shape, so a regression fails by a
// wide margin on either page.
const HOME_BYTES_CEILING = 100_000;
const BACKLOG_BYTES_CEILING = 300_000;
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

async function seedWorkspace(page, { runnerKey = false } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const projects = Array.from({ length: PROJECTS }, (_, p) => ({ id: id(`proj-${p}`), name: `Project ${p}`, content: `Seeded project ${p}`, sortOrder: p }));
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey: URL_KEY, runnerKey, projects, issues: seededIssues(id) },
  });
  expect(resp.ok()).toBeTruthy();
}

/**
 * LIN-4114 (settle before merge): a worker waiting on a ruling, written through the dispatch API the way a runner writes it
 * (enqueue, take, `[blocked]` and `[decision]`). The same route the Waiting on you E2E seeds with.
 */
async function seedRuling(page, identifier, token) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data,
  });
  expect((await feedback({ message: '[blocked] which way?' })).status()).toBe(200);
  const decision = { options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }], recommended: 'wait' };
  const res2 = await feedback({ kind: 'decision', message: JSON.stringify({ decision_id: `d-${identifier}`, question: `Which for ${identifier}?`, ...decision }) });
  expect(res2.status(), `decision failed: ${await res2.text()}`).toBe(200);
}

test('Home on a few thousand tasks: the page is small, draws no project section, and the backlog page holds the rest', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator('.running-section')).toBeVisible();

  // LIN-4120: Home's HTML is bounded by what needs a person and what runs, not by the number of projects.
  const html = await page.content();
  const bytes = Buffer.byteLength(html, 'utf8');
  const inlineStyles = (html.match(/ style="/g) || []).length;
  console.log(`LIN-4120 measure: home html=${bytes} bytes inlineStyle=${inlineStyles}`);
  expect(bytes).toBeLessThan(HOME_BYTES_CEILING);
  expect(inlineStyles).toBeLessThan(INLINE_STYLE_CEILING);
  await expect(page.locator('[data-testid="project"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="home-backlog-link"]')).toHaveCount(1);
  await expect(page.locator('.running-section .title.done')).toHaveCount(0);

  // The backlog page draws every project: its HTML keeps the LIN-4024 ceiling, and no done task is sent except in
  // Recent activity, which is a separate, one-day set.
  await page.goto(`/workspace/${URL_KEY}/backlog`);
  await expect(page.locator('[data-testid="project"]').first()).toBeVisible();
  const backlogHtml = await page.content();
  const backlogBytes = Buffer.byteLength(backlogHtml, 'utf8');
  console.log(`LIN-4120 measure: backlog html=${backlogBytes} bytes`);
  expect(backlogBytes).toBeLessThan(BACKLOG_BYTES_CEILING);
  await expect(page.locator('[data-section="project"] .title.done')).toHaveCount(0);
  await expect(page.locator('[data-testid="home-done-count"]').first()).toContainText('done');

  // The Backlog is folded: its tasks come in when the fold opens, one page of 50 at a time. (Backlog rows that are the
  // ancestor of an In Progress or Up next task stay on the page as context, so the check is the page's growth.)
  const backlogRows = page.locator('.project .line', { hasText: 'Backlog task' });
  const before = await backlogRows.count();
  await page.locator('[data-testid="home-fold-backlog"]').first().click();
  await expect.poll(() => backlogRows.count()).toBeGreaterThan(before);
  console.log(`LIN-4024 measure: the first Backlog fold added ${(await backlogRows.count()) - before} rows`);
});

// LIN-4114 (settle before merge): the Waiting on you section's bytes on this shape with twenty open rulings, one card each.
// The owner gets the section; the page stays under the same ceiling as the shape without rulings. Twenty is the bound the
// review asked for: a realistic number of cards, not the empty set above. The open rulings sit on Todo tasks in the
// seeded tree (a Todo task has index ≡ 0 mod 4 and at least 635 mod 1000).
test('Home on this shape with twenty open rulings: the Waiting section is owner-only and the page stays under the ceiling', async ({ page }) => {
  await seedWorkspace(page, { runnerKey: true });
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json()).token;
  const todo = [];
  for (let i = 0; todo.length < 20 && i < TASKS; i += 1) if (i % 4 === 0 && i % 1000 >= 635) todo.push(`LOCAL-${i}`);
  for (const identifier of todo) await seedRuling(page, identifier, token);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator('[data-testid="waiting-on-you"]')).toBeVisible();
  await expect(page.locator('[data-testid="waiting-on-you"] .waiting-card')).toHaveCount(todo.length);
  await expect(page.locator('[data-testid="in-progress-count"]')).toContainText(`${todo.length} waiting on you`);
  await expect(page.locator('.rulings-badge .rulings-count')).toHaveText(String(todo.length), { timeout: 15000 });

  const html = await page.content();
  const bytes = Buffer.byteLength(html, 'utf8');
  const inlineStyles = (html.match(/ style="/g) || []).length;
  console.log(`LIN-4114 measure: home html with ${todo.length} open rulings=${bytes} bytes inlineStyle=${inlineStyles}`);
  expect(bytes).toBeLessThan(HOME_BYTES_CEILING);
  expect(inlineStyles).toBeLessThan(INLINE_STYLE_CEILING);

  // LIN-4242 measure: the live fragment (the shared reduction, then the section's render) on this shape with these rulings.
  // An open owner tab asks for it every rulings tick (5s), with no cache, so this is the cost each such tab adds.
  const samples = [];
  let fragment = null;
  for (let i = 0; i < 10; i += 1) {
    const start = Date.now();
    fragment = await page.request.get(`/workspace/${URL_KEY}/api/home-waiting`);
    samples.push(Date.now() - start);
    expect(fragment.ok()).toBeTruthy();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const body = await fragment.json();
  console.log(`LIN-4242 measure: home-waiting fragment with ${todo.length} open rulings: median ${median} ms, min ${sorted[0]} ms, max ${sorted[sorted.length - 1]} ms over ${samples.length} requests, ${Buffer.byteLength(body.html, 'utf8')} bytes`);
  expect(body.count).toBe(todo.length);
});

// Witness F (timing): the server's cost for Home's state build (the page render, which builds each row's state and the
// trimmed view) and for the open-ruling reduction (the badge's read, the same reduction Home's count line uses). The
// seeded shape has no open rulings yet, so the reduction here runs over an empty set; a ruling-bearing shape is not
// timed by this spec.
test('the state build and the open-ruling reduction are timed on this shape', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${URL_KEY}/`);
  await expect(page.locator('.running-section')).toBeVisible();

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

