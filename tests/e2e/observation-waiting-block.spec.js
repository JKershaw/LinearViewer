import { test, expect } from '../fixtures/test-base.js';
import { clearRuns, seedBlockedRun } from '../fixtures/observation-seed.js';

import { SELECTORS } from '../helpers.js';

// LIN-3983 PR 1: what waits on you comes first, the view and filter survive a
// reload, and a run waiting on a plain message is not hidden by the default filter.
// LIN-4553: what waits is one line ("N questions waiting →", linking to the Questions
// tab), so the runs stay on the first screen; the cards are on the Questions tab.
// Unit coverage of the same rules is in tests/unit/observation-waiting-block.test.js.

let URL_KEY;
let OBSERVATION_URL;

test.beforeEach(async ({ page, workerUrlKey, localWorkerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  await page.request.get('/test/clear-comment-dedupe');
  await page.request.get(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
  await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  await clearRuns(page, URL_KEY);
});

// Several runs, each waiting on a question asked of the signed-in person: the shape that pushed the runs off the screen.
async function seedWaitingQuestions(page, n, prefix) {
  for (let i = 1; i <= n; i++) {
    await seedBlockedRun(page, { urlKey: URL_KEY, issueIdentifier: `${prefix}-${i}`, issueTitle: `Waiting question ${i}`, question: true });
  }
}

// The waiting line is one line, holds no card, and the first run sits on the first screen under it.
async function expectOneLineAndRunsOnFirstScreen(page, { height, count }) {
  const line = page.locator(SELECTORS.observation.waiting);
  await expect(line).toBeVisible();
  await expect(page.locator(SELECTORS.observation.waitingQuestions)).toHaveText(`${count} questions waiting →`);
  await expect(line.locator('[data-testid="question-record-card"]')).toHaveCount(0);
  const lineBox = await line.boundingBox();
  expect(lineBox.height, 'the waiting line is one line').toBeLessThanOrEqual(60);
  const firstRun = page.locator('#obs-active .obs-session').first();
  await expect(firstRun).toBeVisible();
  const runBox = await firstRun.boundingBox();
  expect(runBox.y, 'the first run starts on the first screen').toBeLessThan(height);
}

test.describe('waiting on you (LIN-3983, one line since LIN-4553)', () => {
  test('at 1280px several waiting questions are one line above the runs, and the runs stay on the first screen', async ({ page }) => {
    await seedWaitingQuestions(page, 4, 'LIN-4553-W');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await expectOneLineAndRunsOnFirstScreen(page, { height: 900, count: 4 });
  });

  test('at 390×844 the same: one line, the runs on the first screen, no sideways scroll', async ({ page }) => {
    await seedWaitingQuestions(page, 4, 'LIN-4553-P');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await expectOneLineAndRunsOnFirstScreen(page, { height: 844, count: 4 });
    const pageScrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(pageScrolls, 'the page does not scroll sideways').toBe(false);
  });

  test('the line opens the Questions tab, where every card is drawn with its task', async ({ page }) => {
    await seedWaitingQuestions(page, 2, 'LIN-4553-Q');
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator(SELECTORS.observation.waitingQuestions).click();
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/[?&]view=questions/);
    await expect(page.locator(SELECTORS.observation.waiting)).toBeHidden();
    const rows = page.locator(SELECTORS.observation.ruling.row);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'LIN-4553-Q-1' }).locator('[data-testid="question-record-card-task-title"]')).toHaveText('Waiting question 1');
    // Nothing a person reads here is raw: no task record id, no person id, no ISO time.
    const text = await page.locator(SELECTORS.observation.rulingsSection).innerText();
    expect(text).not.toMatch(/\btask-[0-9a-f]{6,}\b/);
    expect(text).not.toMatch(/\bperson:/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  test('with nothing waiting, the line is absent', async ({ page }) => {
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.observation.waiting)).toBeHidden();
  });

  test('a run waiting on a plain message, with no question, is counted on the line under the default filter', async ({ page }) => {
    await seedBlockedRun(page, {
      urlKey: URL_KEY, issueIdentifier: 'LIN-3983-S1', issueTitle: 'Standalone plain wait', standalone: true,
      message: '[blocked] the route still has callers'
    });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    // The autopilot filter does not carry standalone runs; the line's own read does, and links to the run.
    const runs = page.locator(SELECTORS.observation.waitingRuns);
    await expect(runs).toHaveText('1 run waiting →', { timeout: 15000 });
    await expect(runs).toHaveAttribute('href', new RegExp(`/workspace/${URL_KEY}/observation/session/`));
    await expect(page.locator(SELECTORS.observation.waitingQuestions)).toBeHidden();
  });
});

test.describe('the phone layout (LIN-3983)', () => {
  test('at 390×844 every tab label sits on one line and the page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    const measures = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
      // A wrapped label has text rects on more than one line; a one-line label has one top.
      const wrapped = tabs.filter(tab => {
        const range = document.createRange();
        range.selectNodeContents(tab);
        const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
        return tops.size > 1;
      }).map(tab => tab.textContent.trim());
      // The strip is overflow-x:auto with nowrap labels, so labels that outgrow 390px are
      // clipped inside it: they neither wrap nor scroll the page. Only the strip's own
      // scrollWidth against its clientWidth sees that.
      const strip = document.querySelector('[role="tablist"]');
      return {
        tabCount: tabs.length,
        wrapped,
        strip: [strip.scrollWidth, strip.clientWidth],
        pageScrolls: document.documentElement.scrollWidth > window.innerWidth
      };
    });
    expect(measures.tabCount).toBe(2);
    expect(measures.wrapped, 'no tab label wraps').toEqual([]);
    expect(measures.strip[0], 'the tab strip fits without scrolling').toBeLessThanOrEqual(measures.strip[1]);
    expect(measures.pageScrolls, 'the page does not scroll sideways').toBe(false);
  });
});

test.describe('the view and the filter survive a reload (LIN-3983)', () => {
  test('the Questions tab reads "Questions" and reopens from the URL after a reload', async ({ page }) => {
    await page.goto(`${OBSERVATION_URL}?view=questions`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveText('Questions');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveClass(/is-active/);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveClass(/is-active/);
    await expect(page.locator(SELECTORS.observation.rulingsSection)).toBeVisible();
  });

  test('the old ?view=rulings link still opens the Questions tab (LIN-4553)', async ({ page }) => {
    await page.goto(`${OBSERVATION_URL}?view=rulings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveClass(/is-active/);
    await expect(page.locator(SELECTORS.observation.rulingsSection)).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=questions/);
  });

  test('a filter chosen on the runs view is in the URL and reopens after a reload', async ({ page }) => {
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('obs-filter-standalone').click();
    await expect(page).toHaveURL(/[?&]filter=standalone/);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('obs-filter-standalone')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the old ?view=sessions link opens on the all filter', async ({ page }) => {
    await page.goto(`${OBSERVATION_URL}?view=sessions`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('obs-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('obs-tab-runs')).toHaveClass(/is-active/);
  });

  test('the tab strip is reachable by keyboard: arrow keys move across the tabs', async ({ page }) => {
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('obs-tab-runs').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/[?&]view=questions/);
  });
});
