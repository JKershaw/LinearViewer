import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS } from '../helpers.js';

// LIN-4106 (S4): the opened task and the task page say one thing, in one line, in plain words.
//
//   - the task page has exactly one pill and one sentence, no "Tracker:" line and no "Harbour:" label, and says the last
//     run in words ("Last run: Plan finished … · the only run");
//   - a waiting task's ruling card comes before the run block ("Runs on", "Another step") in the DOM;
//   - Home's opened task carries the same state line, and its All-runs button, with no raw "Last:" words;
//   - the Change drawer has a heading, the default choice in words with its figures, and house-page links.
//
// Seeding goes through tests/fixtures/local-harness.js, and selectors through SELECTORS (tests/helpers.js).

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const DONE = 'LOCAL-S4A';
const WAITING = 'LOCAL-S4B';
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
  await page.goto(`/test/clear-task-decisions?urlKey=${URL_KEY}`);
});

test.afterEach(async ({ page, localWorkerUrlKey }) => {
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-task-decisions']) {
    await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
  }
});

/** Two In Progress tasks in one project; an owner with a runner unless `runnerKey` is false (a new user). */
async function seedTasks(page, { runnerKey = true } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey,
      openRouterConnected: false,
      projects: [{ id: id('s4-proj'), name: 'Opened task project', content: 'A project', sortOrder: 1 }],
      issues: [
        { id: id('s4-done'), identifier: DONE, title: 'A task with a plan done', description: 'Seeded task', projectId: id('s4-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('s4-done')}` },
        { id: id('s4-wait'), identifier: WAITING, title: 'A task waiting on a ruling', description: 'Seeded task', projectId: id('s4-proj'), sortOrder: 2, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('s4-wait')}` },
      ],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session on `identifier`, take it, and post the lines the runner would (a `[done]` ends it). */
async function seedRun(page, token, identifier, { kind, feedback = [] }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  for (const message of feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message } });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

/** A worker waiting on an open ruling on `identifier`, written the way a runner writes it (`[blocked]`, then `[decision]`). */
async function seedRuling(page, token, identifier) {
  const itemId = await seedRun(page, token, identifier, { kind: 'implementation' });
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const blocked = await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: '[blocked] which way?' } });
  expect(blocked.status()).toBe(200);
  const decision = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: auth,
    data: {
      kind: 'decision',
      message: JSON.stringify({
        decision_id: `d-${identifier}`, question: `Which for ${identifier}?`,
        options: [{ id: 'ship', label: 'Ship it now' }, { id: 'wait', label: 'Wait for review' }], recommended: 'wait',
      }),
    },
  });
  expect(decision.status(), `decision failed: ${await decision.text()}`).toBe(200);
}

async function gotoTask(page, identifier) {
  await page.goto(`/workspace/${URL_KEY}/task/${identifier}`);
  await page.waitForLoadState('networkidle');
}

async function gotoHome(page) {
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');
}

/** Open Home's top In Progress task (the one `seedTasks` sorts first) unless it is open already; return its block. */
async function openTask(page) {
  const block = page.locator(SELECTORS.openedTask.box).first();
  if (!(await block.isVisible())) await page.locator(SELECTORS.openedTask.top).click();
  await expect(block).toBeVisible();
  return block;
}

/** True when `later` comes after `earlier` in the document (DOM order, not layout). */
function followsInDom(page, earlier, later) {
  return page.evaluate(([a, b]) => {
    const x = document.querySelector(a);
    const y = document.querySelector(b);
    return !!(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, [earlier, later]);
}

test.describe('LIN-4106 — the task page says one state, in one line', () => {
  test('exactly one pill and one sentence; no Tracker line and no Harbour label; the last run in words', async ({ page }) => {
    await seedTasks(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, DONE, { kind: 'plan', feedback: ['[done] planned it'] });

    await gotoTask(page, DONE);
    await expect(page.locator(SELECTORS.taskPage.answer)).toBeVisible();
    await expect(page.locator(SELECTORS.taskPage.pill)).toHaveCount(1);
    await expect(page.locator(SELECTORS.taskPage.sentence)).toHaveCount(1);
    await expect(page.locator(SELECTORS.taskPage.sentence)).toContainText(/^Last run: Plan finished .*the only run/);
    const main = page.locator('main');
    await expect(main).not.toContainText('Tracker:');
    await expect(main).not.toContainText('Harbour:');
    await expect(page.locator(SELECTORS.taskPage.harbourLabel)).toHaveCount(0);
  });

  test('a waiting task: the ruling card comes before the run block and the stages in the DOM', async ({ page }) => {
    await seedTasks(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRuling(page, token, WAITING);

    await gotoTask(page, WAITING);
    await expect(page.locator(SELECTORS.taskPage.question)).toHaveCount(1);
    await expect(page.locator(SELECTORS.taskPage.run)).toHaveCount(1);
    expect(await followsInDom(page, SELECTORS.taskPage.question, SELECTORS.taskPage.run), 'the ruling card precedes the run block').toBe(true);
    expect(await followsInDom(page, SELECTORS.taskPage.question, SELECTORS.taskPage.stages), 'the ruling card precedes the stages').toBe(true);
    expect(await followsInDom(page, SELECTORS.taskPage.question, SELECTORS.taskPage.runsOn), 'the ruling card precedes "Runs on"').toBe(true);
    expect(await followsInDom(page, SELECTORS.taskPage.question, SELECTORS.taskPage.another), 'the ruling card precedes "Another step"').toBe(true);
    // The DOM order is what a reader gets on a phone; on desktop the grid places the blocks, so the drawn order is checked too.
    const top = async (sel) => (await page.locator(sel).first().boundingBox()).y;
    expect(await top(SELECTORS.taskPage.question), 'the ruling card is drawn above "Runs on"').toBeLessThan(await top(SELECTORS.taskPage.runsOn));
    expect(await top(SELECTORS.taskPage.question), 'the ruling card is drawn above "Another step"').toBeLessThan(await top(SELECTORS.taskPage.another));
  });
});

test.describe('LIN-4106 — Home\'s opened task has the same state line', () => {
  test('one pill and one plain-words sentence, the same as the task page, and the All-runs button with no raw Last words', async ({ page }) => {
    await seedTasks(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, DONE, { kind: 'plan', feedback: ['[done] planned it'] });

    await gotoHome(page);
    const block = await openTask(page);
    const line = block.locator(SELECTORS.homeTaskStatus.line);
    await expect(line).toHaveCount(1);
    await expect(line.locator(SELECTORS.homeTaskStatus.pill)).toHaveCount(1);
    await expect(line.locator(SELECTORS.homeTaskStatus.sentence)).toContainText(/^Last run: Plan finished .*the only run/);
    await expect(block.locator(SELECTORS.homeTaskStatus.allRuns)).toHaveCount(1);
    await expect(block).not.toContainText('No session running');
    await expect(block.locator(SELECTORS.homeTaskStatus.lastLine)).not.toContainText('Last:');
  });
});

test.describe('LIN-4106 — the Change drawer: a heading, the default in words, its figures, and the house pages', () => {
  test('the drawer opens with its heading, a default card, and links to Settings › Models and Dispatch', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedTasks(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, DONE, { kind: 'plan', feedback: ['[done] planned it'] });

    await gotoHome(page);
    const block = await openTask(page);
    await block.locator(SELECTORS.runControl.change).click();
    const panel = page.locator(SELECTORS.runControl.changePanel);
    await expect(panel).toBeVisible();
    await expect(panel.locator(SELECTORS.runControl.changeHeading)).toHaveText('Change this run');
    await expect(panel.locator(SELECTORS.runControl.defaultCard)).toContainText('Default for');
    await expect(panel.locator(SELECTORS.runControl.settingsModelsLink)).toHaveAttribute('href', new RegExp(`/workspace/${URL_KEY}/settings/models$`));
    await expect(panel.locator(SELECTORS.runControl.dispatchLink)).toHaveAttribute('href', new RegExp(`/workspace/${URL_KEY}/dispatch$`));
  });

  test('on a phone the drawer keeps "Use for this run" on the first screen, heading and links in place', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedTasks(page);
    await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    const token = await runnerToken(page);
    await seedRun(page, token, DONE, { kind: 'plan', feedback: ['[done] planned it'] });

    await gotoHome(page);
    const block = await openTask(page);
    await block.locator(SELECTORS.runControl.change).click();
    const use = page.locator(SELECTORS.runControl.use);
    await expect(use).toBeVisible();
    const bottom = await use.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom, 'the bottom of "Use for this run"').toBeLessThanOrEqual(PHONE.height);
  });
});
