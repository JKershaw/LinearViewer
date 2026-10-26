import { test, expect } from '../fixtures/test-base.js';
import { clearRuns, seedBlockedRun } from '../fixtures/observation-seed.js';

// LIN-3983 PR 1: what waits on you comes first, the view and filter survive a
// reload, and a run waiting on a plain message is not hidden by the default filter.
// Unit coverage of the same rules is in tests/unit/observation-waiting-block.test.js.

let URL_KEY;
let OBSERVATION_URL;

test.beforeEach(async ({ page, workerUrlKey, localWorkerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  await page.request.get(`/test/clear-task-decisions?urlKey=${localWorkerUrlKey}`);
  await page.goto(`/test/clear-shelved-rulings?urlKey=${URL_KEY}`);
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  await clearRuns(page, URL_KEY);
});

test.describe('waiting on you (LIN-3983)', () => {
  test('a run waiting on a question shows that question above the feed, answerable in the first viewport', async ({ page }) => {
    await seedBlockedRun(page, {
      urlKey: URL_KEY, issueIdentifier: 'LIN-3983-W1', issueTitle: 'Waiting question', decisionId: 'd-waiting-block'
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    const block = page.getByTestId('obs-waiting');
    await expect(block).toBeVisible();
    const row = block.locator('.obs-ruling').filter({ hasText: 'LIN-3983-W1' });
    await expect(row).toBeVisible();
    const box = await row.locator('.chat-option-btn').first().boundingBox();
    expect(box, 'the answer control has a box').not.toBeNull();
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  });

  test('at 390×844 the waiting question is answerable in the first viewport, with no sideways scroll', async ({ page }) => {
    await seedBlockedRun(page, {
      urlKey: URL_KEY, issueIdentifier: 'LIN-3983-W2', issueTitle: 'Phone question', decisionId: 'd-waiting-phone'
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    const row = page.getByTestId('obs-waiting').locator('.obs-ruling').filter({ hasText: 'LIN-3983-W2' });
    await expect(row).toBeVisible();
    const box = await row.locator('.chat-option-btn').first().boundingBox();
    expect(box, 'the answer control has a box').not.toBeNull();
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const pageScrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(pageScrolls, 'the page does not scroll sideways').toBe(false);
  });

  test('with nothing waiting, the block is absent', async ({ page }) => {
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('obs-waiting')).toBeHidden();
  });

  test('a run waiting on a plain message, with no ruling row, shows as a compact row under the default filter', async ({ page }) => {
    await seedBlockedRun(page, {
      urlKey: URL_KEY, issueIdentifier: 'LIN-3983-S1', issueTitle: 'Standalone plain wait', standalone: true,
      message: '[blocked] the route still has callers'
    });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    // The autopilot filter does not carry standalone runs; the block's own read does.
    const compact = page.getByTestId('obs-waiting-runs').locator('.obs-waiting-run').filter({ hasText: 'Standalone plain wait' });
    await expect(compact).toBeVisible({ timeout: 15000 });
    await expect(compact).toContainText('the route still has callers');
    await expect(compact).not.toContainText('[blocked]');
    await expect(compact.getByRole('link', { name: /reply on its run page/ })).toBeVisible();
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
      return {
        tabCount: tabs.length,
        wrapped,
        pageScrolls: document.documentElement.scrollWidth > window.innerWidth
      };
    });
    expect(measures.tabCount).toBe(3);
    expect(measures.wrapped, 'no tab label wraps').toEqual([]);
    expect(measures.pageScrolls, 'the page does not scroll sideways').toBe(false);
  });
});

test.describe('the view and the filter survive a reload (LIN-3983)', () => {
  test('the Rulings tab reopens from the URL after a reload', async ({ page }) => {
    await page.goto(`${OBSERVATION_URL}?view=rulings`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('obs-tab-rulings')).toHaveClass(/is-active/);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('obs-tab-rulings')).toHaveClass(/is-active/);
    await expect(page.locator('#obs-rulings-section')).toBeVisible();
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
    await expect(page.getByTestId('obs-tab-rulings')).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/[?&]view=rulings/);
  });
});
