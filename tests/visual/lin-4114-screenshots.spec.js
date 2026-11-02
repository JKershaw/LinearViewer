/**
 * LIN-4114 evidence maker: Home's "Waiting on you" section, for a runner owner and a new user without a runner, at 1280px
 * and 390px, light and dark. The owner's workspace has two open rulings (one with a valid `recommended` option, one
 * without), and a running task whose ruling is still mid-turn (a read-only card). The new user has no runner, so Home
 * draws no section (the owner-only gate). Run:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4114-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: docs/reviews/_evidence-2026-11-02-lin4114/{owner,newuser}-{light,dark}-{1280,390}.png and
 * owner-waiting-section-{light,dark}-390.png (the section alone, at phone width).
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

const DIR = 'docs/reviews/_evidence-2026-11-02-lin4114';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const OLD = '2020-01-01T00:00:00Z';
const THREE_OPTIONS = {
  options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }, { id: 'split', label: 'Split the change' }],
  recommended: 'wait',
};
const TWO_OPTIONS = { options: [{ id: 'yes', label: 'Yes, go ahead' }, { id: 'no', label: 'Not yet' }] };

test.describe.configure({ mode: 'serial' });

/** A worker's dispatch, taken through the runner's token (the way a runner writes it). */
async function seedDispatch(page, urlKey, token, identifier, { decision, blocked, take = true }) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  if (res.status() !== 201) throw new Error(`dispatch seed failed: ${await res.text()}`);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (taken.status() !== 200) throw new Error(`take failed: ${await taken.text()}`);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data,
  });
  if (blocked) await feedback({ message: '[blocked] which way?' });
  await feedback({ kind: 'decision', message: JSON.stringify({ decision_id: `d-${identifier}`, question: `Which for ${identifier}?`, ...decision }) });
}

/** The workspace: a deep Todo task with a recommended ruling, a solo Todo task with a plain ruling, a running task with a
 *  mid-turn read-only card, and a finished task, so the page has a Running section beside the Waiting one. */
async function seed(page, urlKey, { runner }) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-task-decisions?urlKey=${urlKey}`);
  const id = (raw) => localSeedId(urlKey, raw);
  const issues = [
    { id: id('charter'), identifier: 'LOCAL-0', title: 'Charter: the Waiting on you section', projectId: id('proj'), sortOrder: 0, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('mid'), identifier: 'LOCAL-M', title: 'Middle task under the charter', projectId: id('proj'), parentId: id('charter'), sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('deep'), identifier: 'LOCAL-D', title: 'Deep task: which path to take', projectId: id('proj'), parentId: id('mid'), sortOrder: 2, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('solo'), identifier: 'LOCAL-S', title: 'Solo task: a yes or no question', projectId: id('proj'), sortOrder: 3, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } },
    { id: id('run'), identifier: 'LOCAL-R', title: 'Running task whose question is still mid-turn', projectId: id('proj'), sortOrder: 4, createdAt: OLD, state: { name: 'In Progress', type: 'started' } },
    { id: id('done'), identifier: 'LOCAL-F', title: 'Finished today', projectId: id('proj'), sortOrder: 5, createdAt: OLD, completedAt: new Date().toISOString(), state: { name: 'Done', type: 'completed' } },
  ];
  const resp = await page.request.post('/test/set-local-session', {
    data: { urlKey, runnerKey: runner, projects: [{ id: id('proj'), name: 'Project', content: 'Seeded for LIN-4114', sortOrder: 0 }], issues },
  });
  expect(resp.ok(), `seed failed: ${await resp.text()}`).toBeTruthy();
  if (!runner) return;
  const token = (await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json()).token;
  await seedDispatch(page, urlKey, token, 'LOCAL-D', { decision: THREE_OPTIONS, blocked: true });
  await seedDispatch(page, urlKey, token, 'LOCAL-S', { decision: TWO_OPTIONS, blocked: true });
  await seedDispatch(page, urlKey, token, 'LOCAL-R', { decision: TWO_OPTIONS, blocked: false });
}

async function shoot(page, urlKey, name, theme, width) {
  await page.context().addCookies([{ name: 'theme', value: theme, url: 'http://localhost:3001' }]);
  await page.setViewportSize(WIDTHS[width]);
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${DIR}/${name}-${theme}-${width}.png`, fullPage: true });
}

test.beforeAll(() => { mkdirSync(DIR, { recursive: true }); });

test('owner (runner): Home with Waiting on you, light and dark, 1280 and 390', async ({ page, localWorkerUrlKey }) => {
  await seed(page, localWorkerUrlKey, { runner: true });
  await page.goto(`/workspace/${localWorkerUrlKey}/`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-testid="waiting-on-you"]')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) await shoot(page, localWorkerUrlKey, 'owner', theme, width);
    await page.setViewportSize(WIDTHS[390]);
    await page.locator('[data-testid="waiting-on-you"]').screenshot({ path: `${DIR}/owner-waiting-section-${theme}-390.png` });
  }
});

test('new user (no runner): Home draws no Waiting on you section, light and dark, 1280 and 390', async ({ page, localWorkerUrlKey }) => {
  await seed(page, localWorkerUrlKey, { runner: false });
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      await shoot(page, localWorkerUrlKey, 'newuser', theme, width);
    }
  }
  await expect(page.locator('[data-testid="waiting-on-you"]')).toHaveCount(0);
});
