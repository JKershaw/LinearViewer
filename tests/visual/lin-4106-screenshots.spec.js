/**
 * LIN-4106 evidence maker (beat 4): the task page's one state line, the ruling card before the run block, Home's opened
 * box with the same line, and the Change drawer, for the owner (with a runner) and a new user (no runner), at 1280px and
 * 390px, light and dark. Like the other makers in this directory it writes PNGs and asserts only what it needs to frame
 * the picture:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4106-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-03-lin4106/
 *   task-page-owner-{light,dark}-{1280,390}.png        a finished Plan: one pill, one sentence, "Last run: …"
 *   task-page-waiting-owner-{light,dark}-{1280,390}.png a worker waiting on a ruling: the card above the run block
 *   opened-box-owner-{light,dark}-{1280,390}.png        Home's opened task: the same one line, All runs, the run box
 *   change-drawer-owner-{light,dark}-{1280,390}.png     the Change drawer: heading, default card, house links
 *   task-page-newuser-{light,dark}-{1280,390}.png       a new user with no runner and no run: the one line, the copy-first run
 *   opened-box-newuser-{light,dark}-1280.png            a new user's Home: the copy-first view, no state line
 *
 * Data seam: the local provider, since the states need real dispatch rows. Runs and rulings are written through the public
 * dispatch API the way a runner writes them (as lin-4104 and lin-4114 do).
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

const DIR = 'docs/reviews/_evidence-2026-11-03-lin4106';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const DONE = 'LOCAL-S4A';
const WAITING = 'LOCAL-S4B';

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-task-decisions']) {
    await page.goto(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
  }
});

async function seed(page, urlKey, { runnerKey }) {
  const id = (raw) => localSeedId(urlKey, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey,
      runnerKey,
      openRouterConnected: false,
      projects: [{ id: id('s4-proj'), name: 'Opened task project', content: 'A project', sortOrder: 1 }],
      issues: [
        { id: id('s4-done'), identifier: DONE, title: 'A task with a plan done', description: 'Seeded task', projectId: id('s4-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('s4-done')}` },
        { id: id('s4-wait'), identifier: WAITING, title: 'A task waiting on a ruling', description: 'Seeded task', projectId: id('s4-proj'), sortOrder: 2, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('s4-wait')}` },
      ],
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
}

async function auth(page, urlKey) {
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function run(page, urlKey, headers, identifier, kind, feedback = []) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const itemId = (await res.json()).item.id;
  expect((await page.request.post(`/api/dispatch/take/${itemId}`, { headers })).status()).toBe(200);
  for (const message of feedback) {
    expect((await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers, data: { message } })).status()).toBe(200);
  }
  return itemId;
}

async function ruling(page, urlKey, headers, identifier) {
  const itemId = await run(page, urlKey, headers, identifier, 'implementation');
  expect((await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers, data: { message: '[blocked] which way?' } })).status()).toBe(200);
  const decision = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers,
    data: {
      kind: 'decision',
      message: JSON.stringify({
        decision_id: `d-${identifier}`, question: `Which for ${identifier}?`,
        options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }], recommended: 'wait',
      }),
    },
  });
  expect(decision.status()).toBe(200);
}

/** Set the theme the way the site reads it (a persisted cookie), and the viewport. */
async function frame(page, urlKey, { viewport, theme }) {
  await page.context().clearCookies({ name: 'theme' });
  if (theme === 'dark') await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
  await page.setViewportSize(WIDTHS[viewport]);
  void urlKey;
}

async function snap(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: '.nav-bar { position: static !important; }' });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

for (const theme of ['light', 'dark']) {
  for (const viewport of [1280, 390]) {
    test(`task page, owner, ${theme}, ${viewport}px`, async ({ page, localWorkerUrlKey: urlKey }) => {
      await frame(page, urlKey, { viewport, theme });
      await seed(page, urlKey, { runnerKey: true });
      await seedWorkspaceOwnership(page, urlKey, 'owner');
      await run(page, urlKey, await auth(page, urlKey), DONE, 'plan', ['[done] planned it']);
      await page.goto(`/workspace/${urlKey}/task/${DONE}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="task-page-status-pill"]')).toHaveCount(1);
      await snap(page, `task-page-owner-${theme}-${viewport}`);
    });

    test(`task page waiting on a ruling, owner, ${theme}, ${viewport}px`, async ({ page, localWorkerUrlKey: urlKey }) => {
      await frame(page, urlKey, { viewport, theme });
      await seed(page, urlKey, { runnerKey: true });
      await seedWorkspaceOwnership(page, urlKey, 'owner');
      await ruling(page, urlKey, await auth(page, urlKey), WAITING);
      await page.goto(`/workspace/${urlKey}/task/${WAITING}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="task-page-question"]')).toHaveCount(1);
      await snap(page, `task-page-waiting-owner-${theme}-${viewport}`);
    });

    test(`Home's opened box, owner, ${theme}, ${viewport}px`, async ({ page, localWorkerUrlKey: urlKey }) => {
      await frame(page, urlKey, { viewport, theme });
      await seed(page, urlKey, { runnerKey: true });
      await seedWorkspaceOwnership(page, urlKey, 'owner');
      await run(page, urlKey, await auth(page, urlKey), DONE, 'plan', ['[done] planned it']);
      await page.goto(`/workspace/${urlKey}/`);
      await page.waitForLoadState('networkidle');
      const box = page.locator('.opened-task').first();
      if (!(await box.isVisible())) await page.locator('[data-top-task="1"]').click();
      await expect(box).toBeVisible();
      await snap(page, `opened-box-owner-${theme}-${viewport}`);
    });

    test(`Change drawer, owner, ${theme}, ${viewport}px`, async ({ page, localWorkerUrlKey: urlKey }) => {
      await frame(page, urlKey, { viewport, theme });
      await seed(page, urlKey, { runnerKey: true });
      await seedWorkspaceOwnership(page, urlKey, 'owner');
      await run(page, urlKey, await auth(page, urlKey), DONE, 'plan', ['[done] planned it']);
      await page.goto(`/workspace/${urlKey}/`);
      await page.waitForLoadState('networkidle');
      const box = page.locator('.opened-task').first();
      if (!(await box.isVisible())) await page.locator('[data-top-task="1"]').click();
      await expect(box).toBeVisible();
      await box.locator('[data-testid="run-change"]').click();
      await expect(page.locator('[data-testid="run-change-panel"]')).toBeVisible();
      await snap(page, `change-drawer-owner-${theme}-${viewport}`);
    });

    test(`task page, new user with no runner, ${theme}, ${viewport}px`, async ({ page, localWorkerUrlKey: urlKey }) => {
      await frame(page, urlKey, { viewport, theme });
      // No runner and no run: a dispatch token would register a runner, so a new user is seeded without one and never runs.
      await seed(page, urlKey, { runnerKey: false });
      await seedWorkspaceOwnership(page, urlKey, 'owner');
      await page.goto(`/workspace/${urlKey}/task/${DONE}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="task-page-status-pill"]')).toHaveCount(1);
      await snap(page, `task-page-newuser-${theme}-${viewport}`);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`Home, new user with no runner, ${theme}, 1280px`, async ({ page, localWorkerUrlKey: urlKey }) => {
    await frame(page, urlKey, { viewport: 1280, theme });
    await seed(page, urlKey, { runnerKey: false });
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    await page.goto(`/workspace/${urlKey}/`);
    await page.waitForLoadState('networkidle');
    const box = page.locator('.opened-task').first();
    if (!(await box.isVisible())) await page.locator('[data-top-task="1"]').click();
    await expect(box).toBeVisible();
    await snap(page, `opened-box-newuser-${theme}-1280`);
  });
}
