import { test, expect } from '@playwright/test';

test.describe('Interactive Features', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session first
    await page.goto('/test/set-session');

    // Clear localStorage once (after navigation so we have a page context)
    await page.evaluate(() => localStorage.clear());

    // Navigate to main page
    await page.goto('/');
  });

  test('expands issue details on click', async ({ page }) => {
    // Find an expandable issue line in project section (not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    await expect(issueLine).toBeVisible();

    // Details should be hidden initially
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);
    await expect(details).toHaveClass(/hidden/);

    // Click to expand
    await issueLine.click();

    // Details should now be visible
    await expect(details).not.toHaveClass(/hidden/);
  });

  test('collapses issue details on second click', async ({ page }) => {
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);

    // Click to expand
    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click again to collapse
    await issueLine.click();
    await expect(details).toHaveClass(/hidden/);
  });

  test('collapses entire project on header click', async ({ page }) => {
    const projectHeader = page.locator('.project-header').first();
    const project = page.locator('.project').first();

    // Get issue lines in this project
    const linesInProject = project.locator('.line');
    await expect(linesInProject.first()).toBeVisible();

    // Click header to collapse
    await projectHeader.click();

    // Lines should be hidden (have hidden class or not visible)
    await expect(linesInProject.first()).not.toBeVisible();

    // Click again to expand
    await projectHeader.click();

    // Lines should be visible again
    await expect(linesInProject.first()).toBeVisible();
  });

  test('toggles In Progress section', async ({ page }) => {
    const inProgressHeader = page.locator('.in-progress-header');
    const inProgressItems = page.locator('.in-progress-items');

    // Initially visible
    await expect(inProgressItems).toBeVisible();

    // Click to collapse
    await inProgressHeader.click();
    await expect(inProgressItems).not.toBeVisible();

    // Click to expand
    await inProgressHeader.click();
    await expect(inProgressItems).toBeVisible();
  });

  test('shows completed issues when toggle clicked', async ({ page }) => {
    // Find completed toggle button (mock data has completed issues, so this should exist)
    const completedToggle = page.locator('.completed-toggle').first();
    await expect(completedToggle).toBeVisible();
    await expect(completedToggle).toContainText('show');

    // Get the project ID
    const projectId = await completedToggle.getAttribute('data-project-id');
    const completedSection = page.locator(`[data-completed-for="${projectId}"]`);

    // Initially hidden
    await expect(completedSection).toHaveClass(/hidden/);

    // Click to show
    await completedToggle.click();

    // Should now be visible
    await expect(completedSection).not.toHaveClass(/hidden/);
    await expect(completedToggle).toContainText('hide');
  });

  test('reset button restores default state', async ({ page }) => {
    // Expand something first (use project section, not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');
    const details = project.locator(`.details[data-details-for="${issueId}"]`);

    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click reset
    const resetButton = page.locator('.reset-view');
    await resetButton.click();

    // Details should be hidden again
    await expect(details).toHaveClass(/hidden/);
  });

  test('state persists after page reload', async ({ page }) => {
    // Expand an issue (use project section, not In Progress)
    const project = page.locator('.project').first();
    const issueLine = project.locator('.line.expandable').first();
    const issueId = await issueLine.getAttribute('data-id');

    await issueLine.click();

    // Verify localStorage was updated
    const storageState = await page.evaluate(() => {
      return localStorage.getItem('linear-projects-state');
    });
    expect(storageState).toBeTruthy();
    const parsed = JSON.parse(storageState);
    // expanded is now an array of { id, section } objects
    expect(parsed.expanded).toContainEqual({ id: issueId, section: 'project' });

    // Reload page
    await page.reload();

    // Re-query locators after reload
    const projectAfterReload = page.locator('.project').first();
    const detailsAfterReload = projectAfterReload.locator(`.details[data-details-for="${issueId}"]`);

    // Issue should still be expanded
    await expect(detailsAfterReload).not.toHaveClass(/hidden/);
  });
});

test.describe('Landing Page Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate first to have a page context, then clear localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('collapse and expand work on landing page', async ({ page }) => {
    // Reload to start with clean localStorage state
    await page.reload();

    // Find an expandable issue
    const issueLine = page.locator('.line.expandable').first();

    // Landing page uses content/landing.md (not mock data) - skip if no expandable issues
    const count = await issueLine.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const issueId = await issueLine.getAttribute('data-id');
    const details = page.locator(`.details[data-details-for="${issueId}"]`);

    // Click to expand
    await issueLine.click();
    await expect(details).not.toHaveClass(/hidden/);

    // Click to collapse
    await issueLine.click();
    await expect(details).toHaveClass(/hidden/);
  });

  test('project headers collapse on landing page', async ({ page }) => {
    await page.reload();

    const projectHeader = page.locator('.project-header').first();
    const project = page.locator('.project').first();
    const linesInProject = project.locator('.line');

    // Click to collapse
    await projectHeader.click();
    await expect(linesInProject.first()).not.toBeVisible();

    // Click to expand
    await projectHeader.click();
    await expect(linesInProject.first()).toBeVisible();
  });
});
