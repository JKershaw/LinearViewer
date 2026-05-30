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
  await page.setViewportSize({ width: 1320, height: 1400 });
  await openFlow(page);
  await page.screenshot({ path: `${DIR}/flow-desktop.png`, fullPage: true });
});

test('flow - mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await openFlow(page);
  await page.screenshot({ path: `${DIR}/flow-mobile.png`, fullPage: true });
});

test('flow - hover focus', async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1400 });
  await openFlow(page);
  // AUTH-2 is a chain hub (blocks AUTH-3 and DASH-2) — hovering dims everything else
  await page.locator('.swim-fcard[data-issue-id="auth-2"]').hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/flow-hover-focus.png`, fullPage: true });
});

test('flow - long-haul reveal', async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 1400 });
  await openFlow(page);
  // INFRA-2 is blocked by DASH-3 across the API column — a suppressed long-haul
  // edge at rest. Hovering should reveal the full traced line over the gap.
  await page.locator('.swim-fcard[data-issue-id="infra-2"]').hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/flow-longhaul-reveal.png`, fullPage: true });
});
