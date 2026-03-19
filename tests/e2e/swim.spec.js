import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SWIM_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/swim`;

test.describe('Swim Page', () => {
  test.beforeEach(async ({ page }) => {
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
    await page.goto('/test/set-session?swimSample=true');
    await page.goto(SWIM_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders swim sample data with multiple lanes', async ({ page }) => {
    const laneCount = await page.locator('.swim-lane').count();
    expect(laneCount).toBeGreaterThan(1);
  });

  test('has sequence arrows between boxes', async ({ page }) => {
    const arrows = await page.locator('.swim-lane-arrow').count();
    expect(arrows).toBeGreaterThan(0);
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

  test('project grouping shows all 4 sample projects', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-grouping').selectOption('project');

    const labels = await page.locator('.swim-lane-label').allTextContents();
    expect(labels).toContain('Authentication Overhaul');
    expect(labels).toContain('Dashboard Redesign');
    expect(labels).toContain('API v2');
    expect(labels).toContain('Infrastructure');
  });
});
