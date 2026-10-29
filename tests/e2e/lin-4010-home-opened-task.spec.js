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

// Leave the shared workspace as it was found: these tests leave running sessions, and a running session would move
// the next step another spec reads from the same workspace.
test.afterEach(async ({ page, localWorkerUrlKey }) => {
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status']) {
    await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
  }
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

      if (viewport === PHONE) {
        // LIN-4010 review: at 390 Run fills the box under the reason, the opened task is at least 340px wide, and the
        // page does not scroll sideways.
        const nextBox = await box(next);
        const runFull = await box(run);
        expect(runFull.width, 'Run fills the box width at 390').toBeGreaterThanOrEqual(nextBox.width * 0.9);
        const taskBox = await box(block);
        expect(taskBox.width, 'the opened task is at least 340px wide at 390').toBeGreaterThanOrEqual(340);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(sideways, 'no sideways scroll at 390').toBeLessThanOrEqual(0);
      }
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
      // LIN-4010 review: the state is said once. Home's line is gone while it runs, and the stage chip for Build shows
      // its minutes; the word "running" is for screen readers only (a visually hidden span, not the visible text).
      await expect(block.locator('[data-testid="home-task-sentence"]')).toHaveCount(0);
      await expect(block.locator('[data-testid="home-task-status-pill"]')).toHaveCount(0);
      const buildChip = block.locator('[data-testid="task-page-strip-chip"][data-kind="implementation"]');
      const visibleWords = await buildChip.locator('.task-strip-state').evaluate((el) => [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim());
      expect(visibleWords, 'the chip shows its minutes, not the word').not.toMatch(/running/);
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
    // The panel repaints as its choices load, so read its box once it has settled on the right. The edge is compared to
    // the window with a tolerance for a classic scrollbar, which CI's Linux runner has and this Mac does not: the drawer
    // sits within a scrollbar's width of the right edge, and in the right half of the window.
    await expect.poll(async () => {
      const b = await drawer.boundingBox();
      const { innerWidth } = await page.evaluate(() => ({ innerWidth: window.innerWidth }));
      return b ? innerWidth - Math.round(b.x + b.width) : Infinity;
    }, { message: 'the drawer is within a scrollbar of the window\'s right edge' }).toBeLessThanOrEqual(24);
    expect((await drawer.boundingBox()).x, 'the drawer is in the right half').toBeGreaterThan(DESKTOP.width / 2);

    // LIN-4010 review: Change is a choice. The default is a card; the decision panel is hidden until "Choose for this run".
    await expect(drawer.locator('[data-testid="run-default"]')).toBeVisible();
    await expect(drawer.locator('[data-testid="run-choose-panel"]')).toBeHidden();
    await drawer.locator('[data-testid="run-choose"]').click();
    await expect(drawer.locator('[data-testid="run-choose-panel"]')).toBeVisible();

    // Tab from the last control wraps to the first, so focus stays in the drawer (a modal sheet on a phone).
    await drawer.locator('a').last().focus();
    await page.keyboard.press('Tab');
    const wrapped = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="run-change-panel"]');
      const first = [...d.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')]
        .find((el) => el.getClientRects().length > 0);
      return document.activeElement === first;
    });
    expect(wrapped, 'Tab wraps to the first control inside the drawer').toBe(true);

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

// LIN-4010 review: the review-shaped Home. Three In Progress tasks, the opened one third, and a six-stage running task
// (Research, Plan, Plan review and Plan done; Build running; Review and Close-out ahead). Light and dark, at 390 and 1280.
const LIGHT_AND_DARK = [['light', null], ['dark', 'dark']];

async function seedReviewShaped(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const issue = (identifier, sortOrder) => ({
    id: id(`rs-${identifier}`), identifier, title: `Task ${identifier}`, description: 'Seeded task', projectId: id('rs-proj'),
    sortOrder, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id(`rs-${identifier}`)}`,
  });
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey: true,
      openRouterConnected: false,
      projects: [{ id: id('rs-proj'), name: 'Review project', content: 'A project', sortOrder: 1 }],
      issues: [issue('LOCAL-R0', 1), issue('LOCAL-R0B', 2), issue(TOP, 3)],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

for (const [label, viewport] of [['1280px', DESKTOP], ['390px', PHONE]]) {
  for (const [theme, cookie] of LIGHT_AND_DARK) {
    test.describe(`the review-shaped Home at ${label}, ${theme} (LIN-4010 review)`, () => {
      test.use({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });

      test('one running box with Stop in view, six chips with the minutes only, no sideways scroll, readable text', async ({ page }) => {
        await seedReviewShaped(page);
        const token = await runnerToken(page);
        for (const kind of ['research', 'plan', 'plan-review']) await seedSession(page, token, { kind, feedback: '[done] done it' });
        await seedSession(page, token, { kind: 'implementation', feedback: null });
        await gotoHome(page);
        if (cookie) {
          await page.context().addCookies([{ name: 'theme', value: cookie, url: page.url() }]);
          await gotoHome(page);
          await expect(page.locator('html')).toHaveClass(/theme-dark/);
        }
        // The running task is the third row, not the first: open it by its own row.
        await page.locator(`.line[data-section="in-progress"][data-identifier="${TOP}"]`).click();
        const block = page.locator('.opened-task').first();
        await expect(block).toBeVisible();

        const runningBox = block.locator('[data-testid="opened-task-running"]');
        await expect(runningBox).toBeVisible();
        const stop = runningBox.locator('[data-testid="run-stop"]');
        await expect(stop).toBeVisible();
        const stopBox = await box(stop);
        expect(stopBox.y + stopBox.height, 'Stop is on the first screen').toBeLessThanOrEqual(viewport.height);

        // Six chips, one per usual stage; the running one shows its minutes and not the word.
        await expect(block.locator('[data-testid="task-page-strip-chip"]')).toHaveCount(6);

        if (viewport === PHONE) {
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(sideways, 'no sideways scroll at 390').toBeLessThanOrEqual(0);
        }

        // Readable in both themes: the running title's text against the opened task's own background, WCAG AA (4.5:1).
        const ratio = await page.evaluate(() => {
          const luminance = (rgb) => {
            const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const parse = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
          const fg = parse(getComputedStyle(document.querySelector('.opened-task-running-title')).color);
          const bg = parse(getComputedStyle(document.querySelector('.opened-task')).backgroundColor);
          const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        });
        expect(ratio, 'the running title reads against its background').toBeGreaterThanOrEqual(4.5);
      });
    });
  }
}

test.describe('the state poll repaints the run box without losing a Change draft or an open prompt (LIN-4010)', () => {
  test.use({ viewport: DESKTOP });

  test('a queued run flips to running on the poll; the drawer draft and the prompt body survive the repaint', async ({ page }) => {
    test.setTimeout(90000);
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: '[done] planned it' });
    await gotoHome(page);
    const block = await openTopTask(page);

    // An open prompt body: the step's prompt, read without a model call.
    await block.locator('[data-testid="run-see-prompt"]').click();
    await expect(block.locator('[data-prompt-body]')).toBeVisible();

    // A Change draft in progress: Claude Code on the web picked, not yet used.
    await block.locator('[data-testid="run-change"]').click();
    const drawer = block.locator('[data-testid="run-change-panel"]');
    await drawer.locator('[data-testid="run-target-web"]').click();
    await expect(drawer.locator('[data-testid="run-target-web"]')).toHaveAttribute('aria-pressed', 'true');

    // Run: the dispatch is queued, and the page starts its state poll. The runner takes the item; the next poll flips
    // the box to running.
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/api/dispatch'));
    await block.locator('[data-testid="opened-task-go"]').click();
    const itemId = (await (await posted).json()).item.id;
    await expect(block.locator('[data-testid="opened-task-queued"]')).toBeVisible();
    const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);

    await expect(block.locator('[data-testid="opened-task-running"]')).toBeVisible({ timeout: 40000 });
    await expect(block.locator('.opened-task-running-title')).toHaveText('Running now');
    // The repaint replaced the state slot and the run box, and left the drawer, its draft and the prompt body alone.
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-testid="run-target-web"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(block.locator('[data-prompt-body]')).toBeVisible();
  });
});
