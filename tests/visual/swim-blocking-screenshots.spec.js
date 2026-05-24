/**
 * Swim Blocking Screenshots
 *
 * Captures screenshots of cross-lane blocking scenarios across different
 * configurations. Used for visual review during development of the
 * blocking/staggering feature.
 *
 * Run: npx playwright test tests/e2e/swim-blocking-screenshots.spec.js --project=chromium
 * Screenshots: tests/screenshots/swim-blocking/
 */
import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SWIM_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swim`;
const SCREENSHOT_DIR = 'tests/screenshots/swim-blocking';

test.describe.configure({ mode: 'serial' });

test.describe('Swim Blocking Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Use swim sample data (includes cross-project blocking edges)
    await page.goto('/test/set-session?swimSample=true');
    // Clear persisted settings for clean screenshots
    await page.evaluate(() => localStorage.removeItem('swim-settings'));
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
  });

  // =========================================================================
  // Baseline (current behavior, no blocking feature yet)
  // =========================================================================

  test('01 - baseline: project grouping, blockers OFF', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    // Explicitly turn off blockers for baseline comparison
    await page.locator('#swim-show-blockers').uncheck();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/01-project-baseline.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Project grouping — primary use case for cross-lane blocking
  // =========================================================================

  test('02 - project grouping, blockers ON', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    // Toggle blockers if the checkbox exists (no-op before implementation)
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-project-blockers-on.png`,
      fullPage: true
    });
  });

  test('03 - project + compact + blockers ON', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-compact').check();
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-project-compact-blockers.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Assignee grouping — cross-assignee blocking
  // =========================================================================

  test('04 - assignee grouping, blockers ON', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('assignee');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-assignee-blockers-on.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Dependency grouping — cross-lane blocking rare, verify no regressions
  // =========================================================================

  test('05 - dependency grouping, blockers OFF', async ({ page }) => {
    // Default grouping is dependency, blockers should be OFF by default here
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/05-dependency-no-blockers.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Merged lanes — cross-lane blocking with maxLanes constraint
  // =========================================================================

  test('06 - max lanes = 3, project grouping, blockers ON', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-max-lanes').fill('3');
    await page.locator('#swim-max-lanes').dispatchEvent('input');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/06-project-max-lanes-3-blockers.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Show completed — completed blockers become visible
  // =========================================================================

  test('07 - project grouping + show completed + blockers ON', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-show-completed').check();
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/07-project-completed-blockers.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Popover on blocked / blocker items
  // =========================================================================

  test('08 - popover on a blocked item (API-5)', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    // Click API-5 (blocked by AUTH-3)
    const api5 = page.locator('.swim-box[data-issue-id="api-5"]');
    if (await api5.count() > 0) {
      await api5.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/08-popover-blocked-item.png`,
      fullPage: true
    });
  });

  test('09 - popover on a blocker item (AUTH-3)', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    // Click AUTH-3 (blocks API-5 and AUTH-4)
    const auth3 = page.locator('.swim-box[data-issue-id="auth-3"]');
    if (await auth3.count() > 0) {
      await auth3.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/09-popover-blocker-item.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Mobile viewport
  // =========================================================================

  test('10 - mobile viewport, project grouping, blockers ON', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/10-mobile-project-blockers.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Dense layout — stress test for connector routing around cards
  // =========================================================================

  test('11 - dense: max lanes 2, project grouping, blockers ON', async ({ page }) => {
    // Force all 4 projects into 2 lanes — makes lanes very dense
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-max-lanes').fill('2');
    await page.locator('#swim-max-lanes').dispatchEvent('input');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/11-dense-max-lanes-2.png`,
      fullPage: true
    });
  });

  test('12 - dense: assignee grouping, compact, blockers ON (wide)', async ({ page }) => {
    // Wider viewport to show more columns; compact boxes pack more densely
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('assignee');
    await page.locator('#swim-compact').check();
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    await page.locator('#swim-show-completed').check();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/12-dense-assignee-compact-wide.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Hover chain highlighting
  // =========================================================================

  test('13 - hover chain: project grouping, hover blocked item', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    // Hover API-5 (blocked by AUTH-3, which is blocked by AUTH-2)
    const api5 = page.locator('.swim-box[data-issue-id="api-5"]');
    if (await api5.count() > 0) {
      await api5.hover();
      await page.waitForTimeout(200);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/13-hover-chain-blocked.png`,
      fullPage: true
    });
  });

  test('14 - hover chain: project grouping, hover blocker item', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    // Hover AUTH-2 (blocks AUTH-3 which blocks API-5 and AUTH-4)
    const auth2 = page.locator('.swim-box[data-issue-id="auth-2"]');
    if (await auth2.count() > 0) {
      await auth2.hover();
      await page.waitForTimeout(200);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/14-hover-chain-blocker.png`,
      fullPage: true
    });
  });

  test('15 - hover chain: compact, hover mid-chain item', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-compact').check();
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    // Hover AUTH-3 (mid-chain: blocked by AUTH-2, blocks AUTH-4 and API-5)
    const auth3 = page.locator('.swim-box[data-issue-id="auth-3"]');
    if (await auth3.count() > 0) {
      await auth3.hover();
      await page.waitForTimeout(200);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/15-hover-chain-compact-mid.png`,
      fullPage: true
    });
  });

  // =========================================================================
  // Critical Path Filter
  // =========================================================================

  test('16 - critical path: blocked item (API-5)', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    const api5 = page.locator('.swim-box[data-issue-id="api-5"]');
    if (await api5.count() > 0) {
      await api5.click();
      await page.waitForTimeout(200);
      await page.locator('#swim-popover-critical-path').click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/16-critical-path-api5.png`,
      fullPage: true
    });
  });

  test('17 - critical path: mid-chain item (AUTH-3)', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    const auth3 = page.locator('.swim-box[data-issue-id="auth-3"]');
    if (await auth3.count() > 0) {
      await auth3.click();
      await page.waitForTimeout(200);
      await page.locator('#swim-popover-critical-path').click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/17-critical-path-auth3.png`,
      fullPage: true
    });
  });

  test('18 - label filter: launch label, project grouping', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-label-filter').selectOption('launch');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/18-label-filter-launch-project.png`,
      fullPage: true
    });
  });

  test('19 - label filter: launch label, assignee grouping', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('assignee');
    await page.locator('#swim-label-filter').selectOption('launch');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/19-label-filter-launch-assignee.png`,
      fullPage: true
    });
  });

  test('20 - critical path: compact mode', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');
    await page.locator('#swim-compact').check();
    const showBlockers = page.locator('#swim-show-blockers');
    if (await showBlockers.count() > 0) {
      await showBlockers.check();
    }
    const api5 = page.locator('.swim-box[data-issue-id="api-5"]');
    if (await api5.count() > 0) {
      await api5.click();
      await page.waitForTimeout(200);
      await page.locator('#swim-popover-critical-path').click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/20-critical-path-compact.png`,
      fullPage: true
    });
  });
});
