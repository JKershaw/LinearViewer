import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-4010: Home's opened task leads with its state and one clear next run. Witnesses in a real browser: the next run
// is one box, with the step, why it is next, and Run in that order, and Run is on the first screen at 390 and 1280;
// a running task names its state once, with Stop in view; Change is a drawer that Escape closes, returning focus to
// Change; a new user's Home says no "idle" and no "No sessions yet".

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const TOP = 'LOCAL-H1';
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

/** One In Progress task with a project. An owner with a runner, unless `runnerKey` is false (a new user). */
async function seedTask(page, { runnerKey = true } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey,
      openRouterConnected: false,
      projects: [{ id: id('h-proj'), name: 'Home project', content: 'A project', sortOrder: 1 }],
      issues: [{
        id: id('h-top'), identifier: TOP, title: 'Home polish task', description: 'Seeded task', projectId: id('h-proj'),
        sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('h-top')}`,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/** Enqueue a session on TOP and take it; post its feedback when given (a `[done]` line ends it, a null leaves it running). */
async function seedSession(page, token, { kind, feedback = null }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: TOP, issueTitle: 'Home polish task', target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  if (feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: feedback },
    });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

async function gotoHome(page) {
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');
}

/** Open Home's marked top task unless it is already open; return the opened-task block. */
async function openTopTask(page) {
  const block = page.locator('.opened-task').first();
  if (!(await block.isVisible())) await page.locator('[data-top-task="1"]').click();
  await expect(block).toBeVisible();
  return block;
}

const box = (locator) => locator.boundingBox();

for (const [label, viewport] of [['1280px', DESKTOP], ['390px', PHONE]]) {
  test.describe(`Home's next run at ${label} (LIN-4010)`, () => {
    test.use({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });

    test('one box: the step, why it is next, then Run; Run is on the first screen', async ({ page }) => {
      await seedTask(page);
      const token = await runnerToken(page);
      await seedSession(page, token, { kind: 'plan', feedback: '[done] planned it' });
      await gotoHome(page);
      const block = await openTopTask(page);

      const next = block.locator('[data-testid="opened-task-next-run"]');
      await expect(next).toBeVisible();
      const step = next.locator('.opened-task-step-name');
      const why = next.locator('[data-testid="opened-task-step-why"]');
      const run = next.locator('[data-testid="opened-task-go"]');
      await expect(step).toHaveText('Plan review');
      await expect(why).toContainText('usually next after Plan');
      await expect(run).toContainText('Run Plan review');

      // The order on the page: the step name, then the reason, then Run, with nothing between the reason and Run.
      const [stepBox, whyBox, runBox] = [await box(step), await box(why), await box(run)];
      expect(runBox.y, 'Run is below the reason').toBeGreaterThanOrEqual(whyBox.y + whyBox.height - 1);
      expect(whyBox.y, 'the reason is below the step').toBeGreaterThanOrEqual(stepBox.y);
      // On the first screen: the button's bottom edge is inside the viewport.
      expect(runBox.y + runBox.height, 'Run is on the first screen').toBeLessThanOrEqual(viewport.height);
    });
  });
}

for (const [label, viewport] of [['1280px', DESKTOP], ['390px', PHONE]]) {
  test.describe(`a running task says its state once, with Stop in view, at ${label} (LIN-4010)`, () => {
    test.use({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });

    test('the running box names the state once; Stop is on the first screen', async ({ page }) => {
      await seedTask(page);
      const token = await runnerToken(page);
      await seedSession(page, token, { kind: 'plan', feedback: '[done] planned it' });
      await seedSession(page, token, { kind: 'implementation', feedback: null });
      await gotoHome(page);
      const block = await openTopTask(page);

      const runningBox = block.locator('[data-testid="opened-task-running"]');
      await expect(runningBox).toBeVisible();
      await expect(runningBox.locator('.opened-task-running-title')).toHaveText('Running now');
      await expect(block.locator('.opened-task-running-title')).toHaveCount(1);
      await expect(block.locator('[data-testid="opened-task-last"]')).toHaveCount(0);
      const stop = runningBox.locator('[data-testid="run-stop"]');
      await expect(stop).toBeVisible();
      const stopBox = await box(stop);
      expect(stopBox.y + stopBox.height, 'Stop is on the first screen').toBeLessThanOrEqual(viewport.height);
    });
  });
}

test.describe('Change is a drawer at desktop width, and Escape closes it (LIN-4010)', () => {
  test.use({ viewport: DESKTOP });

  test('the drawer sits at the right edge; Escape closes it and returns focus to Change', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: '[done] planned it' });
    await gotoHome(page);
    const block = await openTopTask(page);

    await block.locator('[data-testid="run-change"]').click();
    const drawer = block.locator('[data-testid="run-change-panel"]');
    await expect(drawer).toBeVisible();
    // The panel repaints as its choices load, so read its box once it has settled at the right edge.
    await expect.poll(async () => {
      const b = await drawer.boundingBox();
      return b ? Math.round(b.x + b.width) : 0;
    }, { message: 'the drawer is at the right edge' }).toBeGreaterThanOrEqual(DESKTOP.width - 1);

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-action'));
    expect(focused, 'focus returns to the Change button').toBe('change-run');
  });
});

test.describe("a new user's Home says no idle and no No sessions yet (LIN-4010)", () => {
  test.use({ viewport: DESKTOP });

  test('copy-first: the opened task names the tracker word and what was copied, nowhere else', async ({ page }) => {
    await seedTask(page, { runnerKey: false });
    await gotoHome(page);
    const block = await openTopTask(page);

    await expect(block.locator('[data-testid="opened-task-copy-state"]')).toContainText('No prompt copied from here yet.');
    await expect(block).not.toContainText('idle');
    await expect(block).not.toContainText('No sessions yet');
    await expect(page.locator('body')).not.toContainText('No sessions yet');
  });
});
