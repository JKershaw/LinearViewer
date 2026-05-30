import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SWIM_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swim`;

// Flow is the default layout; these specs exercise the lane view, so pin
// orientation to horizontal (only when nothing is stored, so reload-persistence
// tests still work).
async function pinHorizontal(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('swim-settings')) {
      localStorage.setItem('swim-settings', JSON.stringify({ orientation: 'horizontal' }));
    }
  });
}

test.describe('Swim Page', () => {
  test.beforeEach(async ({ page }) => {
    await pinHorizontal(page);
    await page.goto('/test/set-session');
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders swim page with lanes', async ({ page }) => {
    // Should have the settings panel
    await expect(page.locator('.swim-settings-toggle')).toBeVisible();

    // Should have lanes container
    await expect(page.locator('#swim-lanes')).toBeVisible();

    // Should have at least one lane
    await expect(page.locator('.swim-lane').first()).toBeVisible();
  });

  test('displays task boxes with correct elements', async ({ page }) => {
    // Boxes should have state indicator, id, and title
    const box = page.locator('.swim-box').first();
    await expect(box).toBeVisible();
    await expect(box.locator('.swim-box-state')).toBeVisible();
    await expect(box.locator('.swim-box-title')).toBeVisible();
  });

  test('settings panel toggles open/closed', async ({ page }) => {
    const body = page.locator('.swim-settings-body');
    const toggle = page.locator('.swim-settings-toggle');

    // Settings should start closed
    await expect(body).toHaveClass(/hidden/);

    // Click to open
    await toggle.click();
    await expect(body).not.toHaveClass(/hidden/);

    // Click to close
    await toggle.click();
    await expect(body).toHaveClass(/hidden/);
  });

  test('changing grouping re-renders lanes', async ({ page }) => {
    // Open settings
    await page.locator('.swim-settings-toggle').click();

    // Get initial lane labels
    const initialLabels = await page.locator('.swim-lane-label').allTextContents();

    // Switch to project grouping
    await page.locator('#swim-grouping').selectOption('project');

    // Lane labels should change
    const newLabels = await page.locator('.swim-lane-label').allTextContents();
    // Project grouping should show project names
    expect(newLabels.some(l => l.includes('Project'))).toBeTruthy();
  });

  test('changing max lanes slider updates lane count', async ({ page }) => {
    // Open settings
    await page.locator('.swim-settings-toggle').click();

    // Set max lanes to 1
    await page.locator('#swim-max-lanes').fill('1');
    await page.locator('#swim-max-lanes').dispatchEvent('input');

    // Should show exactly 1 lane
    const laneCount = await page.locator('.swim-lane').count();
    expect(laneCount).toBe(1);

    // Value display should update
    await expect(page.locator('.swim-max-lanes-value')).toHaveText('1');
  });

  test('compact mode reduces box size', async ({ page }) => {
    // Open settings
    await page.locator('.swim-settings-toggle').click();

    // Enable compact mode
    await page.locator('#swim-compact').check();

    // Boxes should have compact class
    const box = page.locator('.swim-box').first();
    await expect(box).toHaveClass(/compact/);
  });

  test('show completed toggle adds completed tasks', async ({ page }) => {
    // Open settings
    await page.locator('.swim-settings-toggle').click();

    // Count boxes without completed
    const initialCount = await page.locator('.swim-box').count();

    // Enable show completed
    await page.locator('#swim-show-completed').check();

    // Should have more boxes now (mock data has completed issues)
    const newCount = await page.locator('.swim-box').count();
    expect(newCount).toBeGreaterThanOrEqual(initialCount);
  });

  test('clicking a task box shows popover', async ({ page }) => {
    const popover = page.locator('#swim-popover');

    // Popover should start hidden
    await expect(popover).toHaveClass(/hidden/);

    // Click a box
    await page.locator('.swim-box').first().click();

    // Popover should appear
    await expect(popover).not.toHaveClass(/hidden/);

    // Should have title and meta
    await expect(page.locator('#swim-popover-title')).not.toBeEmpty();
  });

  test('popover closes on close button click', async ({ page }) => {
    // Open popover
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);

    // Close it
    await page.locator('#swim-popover-close').click();
    await expect(page.locator('#swim-popover')).toHaveClass(/hidden/);
  });

  test('popover closes on Escape key', async ({ page }) => {
    // Open popover
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#swim-popover')).toHaveClass(/hidden/);
  });

  test('settings persist across page reload', async ({ page }) => {
    // Open settings and change grouping
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');

    // Reload page
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');

    // Open settings - grouping should still be 'project'
    await page.locator('.swim-settings-toggle').click();
    await expect(page.locator('#swim-grouping')).toHaveValue('project');
  });
});

test.describe('Swim Page with Sample Data', () => {
  test.beforeEach(async ({ page }) => {
    await pinHorizontal(page);
    await page.goto('/test/set-session?swimSample=true');
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders swim sample data with multiple lanes', async ({ page }) => {
    const laneCount = await page.locator('.swim-lane').count();
    expect(laneCount).toBeGreaterThan(1);
  });

  test('has SVG connectors between boxes', async ({ page }) => {
    const connectors = await page.locator('.swim-connector-path').count();
    expect(connectors).toBeGreaterThan(0);
  });

  test('lanes contain segment containers for global alignment', async ({ page }) => {
    // Each lane should have at least one segment
    const segments = await page.locator('.swim-lane-segment').count();
    expect(segments).toBeGreaterThan(0);

    // Segments should have data-segment attributes
    const firstSegment = page.locator('.swim-lane-segment').first();
    await expect(firstSegment).toHaveAttribute('data-segment');

    // Segments should have min-width set
    const style = await firstSegment.getAttribute('style');
    expect(style).toContain('min-width');
  });

  test('in-progress items appear in segment 0', async ({ page }) => {
    // Segment 0 should contain started items
    const seg0StartedBoxes = page.locator('.swim-lane-segment[data-segment="0"] .swim-box.state-started');
    const startedCount = await seg0StartedBoxes.count();
    expect(startedCount).toBeGreaterThan(0);

    // Segment 1 should not contain started items
    const seg1StartedBoxes = page.locator('.swim-lane-segment[data-segment="1"] .swim-box.state-started');
    const seg1StartedCount = await seg1StartedBoxes.count();
    expect(seg1StartedCount).toBe(0);
  });

  test('popover has critical path button', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover-critical-path')).toBeVisible();
    await expect(page.locator('#swim-popover-critical-path')).toHaveText('Show critical path');
  });

  test('critical path filter hides non-chain tasks', async ({ page }) => {
    const totalBoxes = await page.locator('.swim-box').count();

    // Click a box and activate critical path
    await page.locator('.swim-box').first().click();
    await page.locator('#swim-popover-critical-path').click();

    // Some boxes should be hidden
    const hiddenBoxes = await page.locator('.swim-box.swim-cp-hidden').count();
    const visibleBoxes = await page.locator('.swim-box:not(.swim-cp-hidden)').count();
    expect(visibleBoxes).toBeGreaterThan(0);
    expect(visibleBoxes).toBeLessThanOrEqual(totalBoxes);

    // Clear filter pill should be visible
    await expect(page.locator('#swim-cp-clear')).toBeVisible();
  });

  test('critical path clears on Escape', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await page.locator('#swim-popover-critical-path').click();

    // Filter is active
    await expect(page.locator('#swim-cp-clear')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Filter should be cleared
    await expect(page.locator('#swim-cp-clear')).not.toBeVisible();
    const hiddenBoxes = await page.locator('.swim-box.swim-cp-hidden').count();
    expect(hiddenBoxes).toBe(0);
  });

  test('critical path clears on clear pill click', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await page.locator('#swim-popover-critical-path').click();

    await page.locator('#swim-cp-clear').click();

    // Filter should be cleared
    await expect(page.locator('#swim-cp-clear')).not.toBeVisible();
    const hiddenBoxes = await page.locator('.swim-box.swim-cp-hidden').count();
    expect(hiddenBoxes).toBe(0);
  });

  test('label filter shows only matching issues and their blockers', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-label-filter').selectOption('launch');

    // Should show fewer boxes than the full set
    const boxes = await page.locator('.swim-box').count();
    expect(boxes).toBeGreaterThan(0);
    expect(boxes).toBeLessThan(20); // Full set has ~20 issues

    // Goal issues should have the swim-goal class
    const goalBoxes = await page.locator('.swim-box.swim-goal').count();
    expect(goalBoxes).toBeGreaterThan(0);

    // Show blockers should be auto-enabled
    await expect(page.locator('#swim-show-blockers')).toBeChecked();
  });

  test('label filter clears when set back to All', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();

    // Set filter
    await page.locator('#swim-label-filter').selectOption('launch');
    const filteredCount = await page.locator('.swim-box').count();

    // Clear filter
    await page.locator('#swim-label-filter').selectOption('');
    const fullCount = await page.locator('.swim-box').count();
    expect(fullCount).toBeGreaterThan(filteredCount);
  });

  test('project grouping shows all 4 sample projects', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');

    const labels = await page.locator('.swim-lane-label').allTextContents();
    expect(labels).toContain('Authentication Overhaul');
    expect(labels).toContain('Dashboard Redesign');
    expect(labels).toContain('API v2');
    expect(labels).toContain('Infrastructure');
  });

  test('group subtasks checkbox is checked by default', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await expect(page.locator('#swim-group-subtasks')).toBeChecked();
  });

  test('subtask groups emit data-group-id attributes when enabled', async ({ page }) => {
    // Sample data has DASH-1 parent with DASH-1a/1b/1c subtasks
    const groupedBoxes = await page.locator('.swim-box[data-group-id]').count();
    expect(groupedBoxes).toBeGreaterThan(0);

    // At least one parent role and one child role should exist
    const parents = await page.locator('.swim-box[data-group-role="parent"]').count();
    const children = await page.locator('.swim-box[data-group-role="child"]').count();
    expect(parents).toBeGreaterThan(0);
    expect(children).toBeGreaterThan(0);
  });

  test('group decoration SVG is drawn when groups exist', async ({ page }) => {
    // Wait for the post-layout decoration to be drawn
    await expect(page.locator('#swim-group-decorations')).toBeAttached();
    const rects = await page.locator('.swim-group-rect').count();
    expect(rects).toBeGreaterThan(0);
  });

  test('subtask clustering: children are adjacent to parent in DOM order', async ({ page }) => {
    // With clustering on, a parent's children should be the immediately
    // following siblings within the same segment.
    const parent = page.locator('.swim-box[data-group-role="parent"]').first();
    const parentGroupId = await parent.getAttribute('data-group-id');
    const parentIssueId = await parent.getAttribute('data-issue-id');

    // All boxes in the same segment as this parent, in DOM order
    const segment = parent.locator('xpath=ancestor::*[contains(@class, "swim-lane-segment")][1]');
    const siblingBoxes = segment.locator('.swim-box');
    const siblingCount = await siblingBoxes.count();

    // Find the parent's index
    let parentIdx = -1;
    for (let i = 0; i < siblingCount; i++) {
      const id = await siblingBoxes.nth(i).getAttribute('data-issue-id');
      if (id === parentIssueId) { parentIdx = i; break; }
    }
    expect(parentIdx).toBeGreaterThanOrEqual(0);

    // The box immediately after the parent should belong to the same group
    const nextGroup = await siblingBoxes.nth(parentIdx + 1).getAttribute('data-group-id');
    expect(nextGroup).toBe(parentGroupId);
  });

  test('disabling group subtasks removes decoration and data-group-id attributes', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();

    // Baseline: decoration visible
    const initialRects = await page.locator('.swim-group-rect').count();
    expect(initialRects).toBeGreaterThan(0);

    // Turn it off
    await page.locator('#swim-group-subtasks').uncheck();

    // Decorations should be gone and no group data attributes remain
    await expect(page.locator('.swim-group-rect')).toHaveCount(0);
    await expect(page.locator('.swim-box[data-group-id]')).toHaveCount(0);
  });

  test('group subtasks works alongside show blockers', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();

    // Turn on show blockers (switches to column-slot rendering)
    await page.locator('#swim-show-blockers').check();

    // Column slots should be present
    const slots = await page.locator('.swim-column-slot').count();
    expect(slots).toBeGreaterThan(0);

    // Group decorations are drawn in a requestAnimationFrame after re-render,
    // so use auto-retrying assertions rather than a one-shot count().
    await expect(page.locator('.swim-group-rect').first()).toBeVisible();
    await expect(page.locator('.swim-box[data-group-role="parent"]').first()).toBeVisible();
  });

  test('group subtasks setting persists across reload', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-group-subtasks').uncheck();

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/swim`);
    await page.waitForLoadState('networkidle');

    await page.locator('.swim-settings-toggle').click();
    await expect(page.locator('#swim-group-subtasks')).not.toBeChecked();
    await expect(page.locator('.swim-group-rect')).toHaveCount(0);
  });
});

test.describe('Swim Flow layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session?swimSample=true');
    await page.evaluate(() => localStorage.removeItem('swim-settings'));
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('flow');
  });

  test('renders flow cards and nested subtask groups', async ({ page }) => {
    await expect(page.locator('.swim-flow')).toBeVisible();
    expect(await page.locator('.swim-fcard').count()).toBeGreaterThan(0);
    // Sample data has nested subtask groups (DASH-1 → DASH-1b → DASH-1b1/2)
    expect(await page.locator('.swim-fgroup').count()).toBeGreaterThan(0);
    // Card shows title text, not just the id
    await expect(page.locator('.swim-fcard .swim-box-title').first()).not.toBeEmpty();
  });

  test('draws orange blocking spines', async ({ page }) => {
    await expect(page.locator('.swim-flow-edges')).toBeAttached();
    await expect(page.locator('.swim-blk-spine').first()).toBeAttached();
  });

  test('long-haul edge is hidden at rest and revealed on hover', async ({ page }) => {
    // DASH-3 blocks INFRA-2 across the API column — its line crosses an
    // intervening card, so it is suppressed (swim-blk-long, opacity 0) at rest
    // and marked with endpoint nubs (swim-blk-stub).
    const longLine = page.locator('.swim-flow-edges .swim-blk-long').first();
    await expect(longLine).toBeAttached();
    await expect(page.locator('.swim-flow-edges .swim-blk-stub').first()).toBeAttached();
    expect(await longLine.evaluate(el => getComputedStyle(el).opacity)).toBe('0');

    // Hovering the target traces the full line.
    await page.locator('.swim-fcard[data-issue-id="infra-2"]').hover();
    await expect(longLine).toHaveClass(/swim-edge-hl/);
    await expect.poll(() => longLine.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  });

  test('clicking a flow card opens the popover', async ({ page }) => {
    await page.locator('.swim-fcard').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);
    await expect(page.locator('#swim-popover-title')).not.toBeEmpty();
  });

  test('flow layout persists across reload', async ({ page }) => {
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.swim-flow')).toBeVisible();
    await page.locator('.swim-settings-toggle').click();
    await expect(page.locator('#swim-orientation')).toHaveValue('flow');
  });
});
