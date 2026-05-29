/**
 * Swim Flow (side-rail) Screenshot Maker
 *
 * Captures the new "flow" layout of the real swim view.
 * Run manually:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/swim-flow-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Screenshots saved to: tests/screenshots/swim-flow/
 */
import { test } from '../fixtures/test-base.js';

const SWIM_URL = '/workspace/test-workspace/swim';
const DIR = 'tests/screenshots/swim-flow';

test.describe.configure({ mode: 'serial' });

async function openFlow(page) {
  await page.goto('/test/set-session?swimSample=true');
  await page.evaluate(() => localStorage.removeItem('swim-settings'));
  await page.goto(SWIM_URL);
  await page.waitForLoadState('networkidle');
  await page.locator('.swim-settings-toggle').click();
  await page.locator('#swim-orientation').selectOption('flow');
  await page.waitForTimeout(450); // let requestAnimationFrame draw spines
}

test('flow - desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1400 });
  await openFlow(page);
  await page.screenshot({ path: `${DIR}/flow-desktop.png`, fullPage: true });
});

test('flow - mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await openFlow(page);
  await page.screenshot({ path: `${DIR}/flow-mobile.png`, fullPage: true });
});
