/**
 * LIN-4103 evidence maker (beat 4): the facts-not-estimates surfaces, for the owner, at 1280px and 390px, light and dark.
 * Like the other makers in this directory it writes PNGs and asserts only what it needs to frame the picture:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4103-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-01-lin4103/
 *   home-owner-{light,dark}-{1280,390}.png   Home: the rows (a parent of three with one running, a parent whose two
 *                                            subtasks need you, a never-run row, a failed row) and the navbar badge
 *   opened-box-owner-{light,dark}-{1280,390}.png  the opened parent: its box names BOTH subtasks that need you
 *   track-owner-{light,dark}-1280.png        the task page's stage track: Plan done, Build failed, no usual stage drawn
 *   sessions-owner-light-1280.png            the Sessions fold: runs only, no Prompt or autopilot records
 *
 * Data seam: the local provider (`/test/set-local-session`), since the states need real dispatch rows. The runs and the
 * rulings are written through the public dispatch API the way a runner writes them, as lin-4010 and lin-4024 do.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-11-01-lin4103';
const OLD = '2020-01-01T00:00:00Z';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };

test.describe.configure({ mode: 'serial' });

async function seedTasks(page, urlKey) {
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const task = (raw, identifier, title, type, more = {}) => ({
    id: id(raw), identifier, title, createdAt: OLD, url: `https://example.com/${raw}`,
    description: `## Why\n\n${title}, seeded for the LIN-4103 evidence.`,
    state: { name: { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done' }[type], type },
    ...more,
  });
  const p = id('p-ui');
  const issues = [
    task('charter', 'LOCAL-1', 'Charter: the state of a task reads one way on every page', 'started', { projectId: p, sortOrder: 0 }),
    task('home', 'LOCAL-2', 'Home works with a real backlog', 'started', { projectId: p, parentId: id('charter'), sortOrder: 1 }),
    task('models', 'LOCAL-3', 'Settings numbers read in the rows', 'started', { projectId: p, parentId: id('charter'), sortOrder: 2 }),
    task('theseus', 'LOCAL-4', 'Theseus the stylesheet', 'started', { projectId: p, parentId: id('charter'), sortOrder: 3 }),
    task('look', 'LOCAL-5', 'Shared look across the pages', 'unstarted', { projectId: p, parentId: id('charter'), sortOrder: 4 }),
    task('never', 'LOCAL-6', 'Explain the rulings view (never run)', 'started', { projectId: p, sortOrder: 5 }),
    task('docs', 'LOCAL-7', 'Docs: the runner setup guide', 'started', { projectId: p, sortOrder: 6 }),
    task('docs-1', 'LOCAL-8', 'Write the runner setup guide', 'started', { projectId: p, parentId: id('docs'), sortOrder: 7 }),
    task('docs-2', 'LOCAL-9', 'Explain the rulings view', 'unstarted', { projectId: p, parentId: id('docs'), sortOrder: 8 }),
    task('docs-3', 'LOCAL-10', 'Archive the old prompt notes', 'unstarted', { projectId: p, parentId: id('docs'), sortOrder: 9 }),
    task('track', 'LOCAL-11', 'A task with a plan and a failed build', 'started', { projectId: p, sortOrder: 10 }),
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, runnerKey: true, issues,
      projects: [{ id: p, name: 'UI finish', content: 'The pages a new user meets', sortOrder: 0 }],
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
}

async function runnerAuth(page, urlKey) {
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// One run on a task: enqueue, take it, then write its feedback (done, failed, or nothing yet for a running run).
async function seedRun(page, urlKey, auth, identifier, kind, feedback = null) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
  if (feedback) {
    expect((await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: feedback } })).status()).toBe(200);
  }
}

// A ruling on a task: a worker blocked on a structured question, as lin-4024's seedRuling writes it.
async function seedRuling(page, urlKey, auth, identifier, decisionId) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'research prompt', promptName: 'research', kind: 'research', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth })).status()).toBe(200);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data });
  expect((await feedback({ message: '[blocked] which way should the numbers read?' })).status()).toBe(200);
  expect((await feedback({
    kind: 'decision',
    message: JSON.stringify({
      decision_id: decisionId, question: 'Which way should the numbers read?',
      options: [{ id: 'rows', label: 'In the rows' }, { id: 'page', label: 'On the page' }],
    }),
  })).status()).toBe(200);
}

async function seedScene(page, urlKey) {
  await seedTasks(page, urlKey);
  const auth = await runnerAuth(page, urlKey);
  // Parent LOCAL-1: LOCAL-2 running, LOCAL-3 and LOCAL-4 both need a ruling, LOCAL-5 never run.
  await seedRun(page, urlKey, auth, 'LOCAL-2', 'plan');
  await seedRuling(page, urlKey, auth, 'LOCAL-3', 'lin4103-rows');
  await seedRuling(page, urlKey, auth, 'LOCAL-4', 'lin4103-page');
  // Parent LOCAL-7: LOCAL-8 running, the other two never run: its row reads "1 of 3 running".
  await seedRun(page, urlKey, auth, 'LOCAL-8', 'implementation');
  // LOCAL-11: a plan that finished, then a build that failed. The track draws these two and no usual stage after them.
  await seedRun(page, urlKey, auth, 'LOCAL-11', 'plan', '[done] planned it');
  await seedRun(page, urlKey, auth, 'LOCAL-11', 'implementation', '[failed] the build could not finish');
  // A queue record (a plain prompt, kind custom) on LOCAL-11: the Sessions list leaves it out, because it is not a run.
  await seedRun(page, urlKey, auth, 'LOCAL-11', 'custom');
}

const OUT = (name) => `${DIR}/${name}.png`;

for (const theme of ['light', 'dark']) {
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    test(`Home rows and the navbar badge, owner, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
      await seedScene(page, localWorkerUrlKey);
      await page.context().clearCookies({ name: 'theme' });
      if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${localWorkerUrlKey}/`);
      await page.waitForLoadState('networkidle');
      // The badge fills from a 5s poll: two rulings in this workspace (LOCAL-3 and LOCAL-4).
      await expect(page.locator('.rulings-badge .rulings-count')).toHaveText('2', { timeout: 15000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
      await page.screenshot({ path: OUT(`home-owner-${theme}-${label}`), fullPage: true });
    });

    test(`the opened parent names both subtasks that need you, owner, ${theme}, ${label}px`, async ({ page, localWorkerUrlKey }) => {
      await seedScene(page, localWorkerUrlKey);
      await page.context().clearCookies({ name: 'theme' });
      if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${localWorkerUrlKey}/`);
      await page.waitForLoadState('networkidle');
      const parent = page.locator('.in-progress-section .line[data-identifier="LOCAL-1"]').first();
      await parent.click();
      const box = page.locator('[data-testid="opened-task"]').first();
      await expect(box).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Each subtask is named, with its own Open link (LIN-4103 beat 4).
      await expect(box).toContainText('2 subtasks need you');
      await expect(box.locator('[data-testid="opened-task-needs-you"]')).toContainText('LOCAL-3');
      await expect(box.locator('[data-testid="opened-task-needs-you"]')).toContainText('LOCAL-4');
      await expect(box.locator('[data-testid="opened-task-needs-you-open"]')).toHaveCount(2);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
      await page.screenshot({ path: OUT(`opened-box-owner-${theme}-${label}`), fullPage: true });
    });
  }

  test(`the task track draws the stages that ran, owner, ${theme}, 1280px`, async ({ page, localWorkerUrlKey }) => {
    await seedScene(page, localWorkerUrlKey);
    await page.context().clearCookies({ name: 'theme' });
    if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
    await page.setViewportSize(WIDTHS[1280]);
    await page.goto(`/workspace/${localWorkerUrlKey}/task/LOCAL-11`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="task-page-track"], [data-testid="task-page-strip"]').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
    await page.screenshot({ path: OUT(`track-owner-${theme}-1280`), fullPage: true });
  });
}

test('the Sessions list shows runs only, owner, light, 1280px', async ({ page, localWorkerUrlKey }) => {
  await seedScene(page, localWorkerUrlKey);
  await page.setViewportSize(WIDTHS[1280]);
  await page.goto(`/workspace/${localWorkerUrlKey}/`);
  await page.waitForLoadState('networkidle');
  // Open LOCAL-11, the task with the plan, the failed build and the queue record, and its own Sessions fold.
  await page.locator('.in-progress-section .line[data-identifier="LOCAL-11"]').first().click();
  const box = page.locator('[data-testid="opened-task"]').filter({ hasText: 'LOCAL-11' }).first();
  await expect(box).toBeVisible();
  await box.locator('[data-testid="sessions-toggle"]').first().click();
  await expect(box.locator('[data-testid="sessions-count"], .sessions-count-meta').first()).toContainText('2');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
  await page.screenshot({ path: OUT('sessions-owner-light-1280'), fullPage: true });
});
