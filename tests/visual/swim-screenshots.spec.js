/**
 * Swim Page Screenshot Maker
 *
 * Captures screenshots of the swim view with different configurations.
 * Run manually: npx playwright test tests/e2e/swim-screenshots.spec.js --project=chromium
 *
 * Screenshots saved to: tests/screenshots/swim/
 */
import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SWIM_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swim`;
const SCREENSHOT_DIR = 'tests/screenshots/swim';

test.describe.configure({ mode: 'serial' });

test.describe('Swim Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Use swim sample data for realistic screenshots
    await page.goto('/test/set-session?swimSample=true');
    // Clear any persisted settings
    await page.evaluate(() => localStorage.removeItem('swim-settings'));
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
  });

  test('01 - default view (dependency grouping)', async ({ page }) => {
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/01-default.png`,
      fullPage: true
    });
  });

  test('02 - settings panel open', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-settings-open.png`,
      fullPage: true
    });
  });

  test('03 - project grouping', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-project-grouping.png`,
      fullPage: true
    });
  });

  test('04 - assignee grouping', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('assignee');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-assignee-grouping.png`,
      fullPage: true
    });
  });

  test('05 - status grouping', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('status');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/05-status-grouping.png`,
      fullPage: true
    });
  });

  test('06 - compact boxes', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-compact').check();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/06-compact.png`,
      fullPage: true
    });
  });

  test('07 - max lanes = 3', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-max-lanes').fill('3');
    await page.locator('#swim-max-lanes').dispatchEvent('input');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/07-max-lanes-3.png`,
      fullPage: true
    });
  });

  test('08 - max lanes = 12', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-max-lanes').fill('12');
    await page.locator('#swim-max-lanes').dispatchEvent('input');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/08-max-lanes-12.png`,
      fullPage: true
    });
  });

  test('09 - with completed tasks shown', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-show-completed').check();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/09-show-completed.png`,
      fullPage: true
    });
  });

  test('10 - popover open', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/10-popover.png`,
      fullPage: true
    });
  });

  test('11 - mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/11-mobile.png`,
      fullPage: true
    });
  });

  test('12 - project grouping + compact + completed', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-compact').check();
    await page.locator('#swim-show-completed').check();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/12-project-compact-completed.png`,
      fullPage: true
    });
  });
});
