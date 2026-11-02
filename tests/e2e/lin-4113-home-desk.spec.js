// LIN-4113 (S3b): Home's desk, in a real browser. Witnesses from the approved plan, seeded through
// tests/fixtures/local-harness.js and selected through tests/helpers.js SELECTORS:
//   (a) the merged section is bounded: more than 40 tasks created today give exactly 10 recent lines and one fold, the
//       response stays under the Home ceiling, the page's embedded rowData does not grow with the recent rows, and the
//       fold returns the rest.
//   (b) one task, one place: a Todo task with its own running run and a failed task are in Running, not in Up next.
//   (c) the three audiences that open an Up next row: an owner with a runner gets the three LIN-4104 run buttons, an
//       owner without one gets the set-up link, and a member without a runner gets the copy-first view.
//   (d) /backlog keeps its complete list: an Up next task is still on /backlog, a running Todo task is not.
//   (e) search matches an Up next row and a recent row; the Running collapse key persists, and the retired keys are ignored.
// Shots are not taken here. The formal screenshots are the beat 4 evidence.

import { test, expect } from '../fixtures/test-base.js';
import { localSeedId, seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS } from '../helpers.js';

const OLD = '2020-01-01T00:00:00Z';
/** The Home ceiling the heavy-shape spec holds Home to (tests/perf/lin-4024-home-shape.spec.js): 100 KB. */
const HOME_CEILING_BYTES = 100 * 1024;

let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

const TODO = { name: 'Todo', type: 'unstarted' };
/** The run buttons an opened row offers: the filled rung (data-filled-rung) and the two quiet rung test ids (prompt-section.js). */
const RUN_BUTTONS = '[data-filled-rung], [data-testid="opened-task-run-next-step"], [data-testid="opened-task-run-to-pr"], [data-testid="opened-task-run-to-done"]';
const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };
const now = () => new Date().toISOString();

/** A small desk: one running task, Todo tasks in two projects, one task finished today, one old Backlog task. */
function deskSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [
      { id: id('d-alpha'), name: 'Desk alpha', content: 'Alpha', sortOrder: 1 },
      { id: id('d-beta'), name: 'Desk beta', content: 'Beta', sortOrder: 2 },
    ],
    issues: [
      { id: id('d-run'), identifier: 'LOCAL-D1', title: 'Desk running task', projectId: id('d-alpha'), sortOrder: 1, createdAt: OLD, state: STARTED },
      { id: id('d-next-a'), identifier: 'LOCAL-N1', title: 'Desk next alpha', projectId: id('d-alpha'), sortOrder: 2, createdAt: OLD, state: TODO },
      { id: id('d-busy'), identifier: 'LOCAL-R1', title: 'Desk running todo', projectId: id('d-alpha'), sortOrder: 3, createdAt: OLD, state: TODO },
      { id: id('d-fail'), identifier: 'LOCAL-F1', title: 'Desk failed todo', projectId: id('d-beta'), sortOrder: 1, createdAt: OLD, state: TODO },
      { id: id('d-next-b'), identifier: 'LOCAL-N2', title: 'Desk next beta', projectId: id('d-beta'), sortOrder: 2, createdAt: OLD, state: TODO },
      { id: id('d-finished'), identifier: 'LOCAL-X1', title: 'Desk finished today', projectId: id('d-beta'), sortOrder: 3, createdAt: OLD, completedAt: now(), updatedAt: now(), state: DONE },
      { id: id('d-old'), identifier: 'LOCAL-O1', title: 'Desk old backlog', projectId: id('d-beta'), sortOrder: 4, createdAt: OLD, state: { name: 'Backlog', type: 'backlog' } },
    ],
  };
}

/** Tasks created today, all Todo, in one project: Up next takes five, and the rest are recent rows. */
function createdTodayTasks(urlKey, count) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [{ id: id('bound-proj'), name: 'Bound project', content: 'Bound', sortOrder: 1 }],
    issues: Array.from({ length: count }, (_, i) => ({
      id: id(`bound-${i}`), identifier: `LOCAL-B${i + 1}`, title: `Bound task ${i + 1}`, projectId: id('bound-proj'),
      sortOrder: i + 1, createdAt: now(), updatedAt: now(), state: TODO,
    })),
  };
}

/** The runner token for this workspace, minted through the production path. */
async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session on `identifier`; take it with the runner token (so it is running); post `[failed]` feedback if asked. */
async function seedSession(page, token, identifier, { failed = false } = {}) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'build prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  if (failed) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: '[failed] the build broke' },
    });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

/** Home's HTML as the server renders it for this session. */
async function homeHtml(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/`);
  expect(resp.ok()).toBeTruthy();
  return resp.text();
}

/** The identifiers of the Up next rows a page draws, from the HTML (the row lines, not their details wrappers). */
function upNextIdsOf(html) {
  const section = html.slice(html.indexOf('data-testid="home-up-next-section"'), html.indexOf('data-testid="home-backlog-link"'));
  return [...section.matchAll(/data-testid="issue-line"[^>]*data-identifier="([^"]+)"/g)].map((m) => m[1]);
}

// -----------------------------------------------------------------------------------------------------------------------

test.describe('LIN-4113 (a) — the merged section is bounded', () => {
  test('more than 40 tasks created today: ten recent lines and one fold, bounded bytes, a fixed rowData, and the fold pages the rest', async ({ page, seedLocal }) => {
    await seedLocal(createdTodayTasks(URL_KEY, 46));
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Forty-six Todo tasks created today. The front task is the top task, which Running always shows, so five are Up
    // next and forty are recent-only rows: ten drawn, thirty behind the fold.
    await expect(page.locator(SELECTORS.homeDesk.upNextRows)).toHaveCount(5);
    await expect(page.locator(`${SELECTORS.homeDesk.recentItems} [data-testid="issue-line"]`)).toHaveCount(10);
    await expect(page.locator(SELECTORS.homeDesk.recentFold)).toHaveCount(1);
    await expect(page.locator(SELECTORS.homeDesk.recentFold)).toHaveText('show 30 more ▶');

    const small = await homeHtml(page);
    expect(Buffer.byteLength(small, 'utf8'), 'Home with 46 tasks created today is under the ceiling').toBeLessThan(HOME_CEILING_BYTES);
    const rowDataSmall = await page.evaluate(() => Object.keys(window.__HOME_PROMPT_OPTS__?.rowData || {}).length);
    expect(rowDataSmall, 'the embedded rowData holds the one Running task, the five Up next rows and the ten drawn recent rows').toBe(16);

    // The fold returns the rest: one page of 30, so the fold goes and all 40 recent rows are on the page.
    await page.locator(SELECTORS.homeDesk.recentFold).click();
    await expect(page.locator(SELECTORS.homeDesk.recentLines)).toHaveCount(40);
    await expect(page.locator(SELECTORS.homeDesk.recentFold)).toHaveCount(0);

    // Eighty-six tasks created today: the same ten lines and one fold (eighty recent rows, seventy behind it), the same
    // bounded rowData, and nearly the same bytes.
    await seedLocal(createdTodayTasks(URL_KEY, 86));
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.homeDesk.recentFold)).toHaveText('show 70 more ▶');
    const large = await homeHtml(page);
    expect(Buffer.byteLength(large, 'utf8'), 'Home with 86 tasks created today is under the ceiling').toBeLessThan(HOME_CEILING_BYTES);
    const rowDataLarge = await page.evaluate(() => Object.keys(window.__HOME_PROMPT_OPTS__?.rowData || {}).length);
    expect(rowDataLarge, 'embedded rowData does not grow with the recent rows').toBe(rowDataSmall);
    const growth = Buffer.byteLength(large, 'utf8') - Buffer.byteLength(small, 'utf8');
    expect(Math.abs(growth), `forty more recent tasks add ${growth} B to Home`).toBeLessThan(2048);
  });
});

test.describe('LIN-4139 — each Up next row says why it is there', () => {
  test('every Up next row carries exactly one up-next-why line in the absolute-date format, and Running rows carry none', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY));
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    const rows = page.locator(SELECTORS.homeDesk.upNextRows);
    const count = await rows.count();
    expect(count, 'the desk seed has Up next tasks').toBeGreaterThan(0);
    const why = page.locator(`${SELECTORS.homeDesk.upNext} [data-testid="up-next-why"]`);
    await expect(why).toHaveCount(count);
    for (const text of await why.allTextContents()) {
      expect(text).toMatch(/^(Urgent|High|Medium|Low|No priority) · (added|due) \d{1,2} [A-Z][a-z]{2} \d{4}( · unblocks \d+)?$/);
    }
    for (const row of await rows.all()) await expect(row.locator('[data-testid="up-next-why"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="up-next-why"]'), 'no why line outside Up next').toHaveCount(count);
  });
});

test.describe('LIN-4113 (b) — one task, one place', () => {
  test('a Todo task with its own running run and a failed task are in Running, and neither is Up next', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: true });
    const token = await runnerToken(page);
    await seedSession(page, token, 'LOCAL-R1');
    await seedSession(page, token, 'LOCAL-F1', { failed: true });

    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.homeDesk.runningRow('LOCAL-R1'))).toHaveCount(1);
    await expect(page.locator(SELECTORS.homeDesk.runningRow('LOCAL-F1'))).toHaveCount(1);
    const upNext = upNextIdsOf(await homeHtml(page));
    expect(upNext, 'the running Todo task and the failed task are not Up next').not.toContain('LOCAL-R1');
    expect(upNext).not.toContain('LOCAL-F1');
    expect(upNext, 'the Up next list is the Todo tasks that are not on Home').toEqual(expect.arrayContaining(['LOCAL-N1', 'LOCAL-N2']));
    // Each task once across the page: Running (R1, F1), Up next (N1, N2) and the recent block (X1, which is finished today).
    const html = await homeHtml(page);
    for (const identifier of ['LOCAL-R1', 'LOCAL-F1', 'LOCAL-N1', 'LOCAL-N2', 'LOCAL-X1']) {
      const count = (html.match(new RegExp(`data-testid="issue-line"[^>]*data-identifier="${identifier}"`, 'g')) || []).length;
      expect(count, `${identifier} appears once on Home`).toBe(1);
    }
  });
});

test.describe('LIN-4113 (c) — the three audiences that open an Up next row', () => {
  test('an owner with a runner sees the three LIN-4104 run buttons', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: true });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.homeDesk.upNextRow('LOCAL-N1')).click();
    const details = page.locator('[data-testid="home-up-next-section"] .node', { has: page.locator('[data-identifier="LOCAL-N1"]') }).locator('.details');
    // The three LIN-4104 run buttons: the filled rung carries data-filled-rung, the two quiet rungs their own test ids.
    await expect(details.locator(RUN_BUTTONS)).toHaveCount(3);
    for (const button of await details.locator(RUN_BUTTONS).all()) await expect(button).toBeVisible();
  });

  test('an owner without a runner sees the set-up link, not the run buttons', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: false });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.homeDesk.upNextRow('LOCAL-N1')).click();
    const details = page.locator('[data-testid="home-up-next-section"] .node', { has: page.locator('[data-identifier="LOCAL-N1"]') }).locator('.details');
    await expect(details).toBeVisible();
    await expect(details.getByText(/set up/i).first()).toBeVisible();
    await expect(details.locator(RUN_BUTTONS)).toHaveCount(0);
  });

  test('a member without a runner sees the copy-first view, not the run buttons', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: false });
    await seedWorkspaceOwnership(page, URL_KEY, 'foreign');
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.homeDesk.upNextRow('LOCAL-N1')).click();
    const details = page.locator('[data-testid="home-up-next-section"] .node', { has: page.locator('[data-identifier="LOCAL-N1"]') }).locator('.details');
    await expect(details).toBeVisible();
    await expect(details.getByText(/no prompt copied from here yet/i)).toBeVisible();
    await expect(details.getByTestId('opened-task-write')).toBeVisible();
    // The copy-first view is the Plan step: a Todo task's first step, which the row's own record supplies (rowData).
    await expect(details.getByTestId('opened-task-write')).toHaveAttribute('data-prompt', 'plan');
    await expect(details.locator(RUN_BUTTONS)).toHaveCount(0);
  });
});

test.describe('LIN-4113 (d) — /backlog keeps its complete list', () => {
  test('an Up next task is still on /backlog, and a running Todo task is not', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: true });
    const token = await runnerToken(page);
    await seedSession(page, token, 'LOCAL-R1');

    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.homeDesk.upNextRow('LOCAL-N1'))).toHaveCount(1);

    await page.goto(`/workspace/${URL_KEY}/backlog`);
    await page.waitForLoadState('networkidle');
    const projects = page.locator(SELECTORS.backlogPage.projects);
    await expect(projects.locator('.line[data-identifier="LOCAL-N1"]')).toHaveCount(1);
    await expect(projects.locator('.line[data-identifier="LOCAL-R1"]')).toHaveCount(0);
    await expect(page.locator(SELECTORS.backlogPage.running)).toHaveCount(0);
  });
});

test.describe('LIN-4113 (e) — search, collapse keys, and the retired keys', () => {
  test('search matches an Up next row and a recent row; the Running collapse persists; the retired keys are ignored', async ({ page, seedLocal }) => {
    await seedLocal(deskSeed(URL_KEY), { runnerKey: true });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Search: an Up next row shows Up next and hides the Running section, and a recent row shows its own section.
    await page.locator('.search-toggle').click();
    const input = page.locator('#search-input');
    await input.fill('desk next alpha');
    await expect(page.locator(SELECTORS.homeDesk.upNextRow('LOCAL-N1'))).toBeVisible();
    await expect(page.locator(SELECTORS.homeDesk.upNext)).not.toHaveClass(/hidden/);
    await expect(page.locator(SELECTORS.homeDesk.running)).toHaveClass(/hidden/);
    await input.fill('desk finished today');
    await expect(page.locator(SELECTORS.homeDesk.recentRow('LOCAL-X1'))).toBeVisible();
    await expect(page.locator(SELECTORS.homeDesk.upNext)).toHaveClass(/hidden/);
    await input.fill('');

    // Collapse: the Running header hides its body, the state is saved under runningCollapsed, and it survives a reload.
    await page.locator(SELECTORS.homeDesk.runningHeader).click();
    await expect(page.locator('.running-body')).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('linear-projects-state') || '{}'));
    expect(saved.runningCollapsed).toBe(true);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.running-body')).toBeHidden();
    await expect(page.locator(SELECTORS.homeDesk.upNextHeader)).toContainText('▼');
    await page.locator(SELECTORS.homeDesk.runningHeader).click();
    await expect(page.locator('.running-body')).toBeVisible();

    // The retired keys are ignored, never read: a stored state with the old keys opens both sections.
    await page.evaluate(() => localStorage.setItem('linear-projects-state', JSON.stringify({
      expanded: [], hideCompleted: [], collapsedProjects: [], inProgressCollapsed: true, recentActivityCollapsed: false,
    })));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.running-body')).toBeVisible();
    await expect(page.locator(SELECTORS.homeDesk.upNextRows).first()).toBeVisible();
  });
});
