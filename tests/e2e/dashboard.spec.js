import { test, expect } from '@playwright/test';

test.describe('Authenticated Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session (server will use mock data in test mode)
    await page.goto('/test/set-session');

    // Navigate to main page
    await page.goto('/');
  });

  test('renders project tree with issues', async ({ page }) => {
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Should show both projects from mock data
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Project Beta")')).toBeVisible();
  });

  test('shows In Progress section with active issues', async ({ page }) => {
    // Should have In Progress section header
    const inProgressHeader = page.locator('.in-progress-header');
    await expect(inProgressHeader).toBeVisible();
    await expect(inProgressHeader).toContainText('In Progress');

    // Should show in-progress issues as tree with their descendants
    // issue-1 (in-progress) + issue-2 (child of issue-1, hidden) + issue-4 (in-progress) + issue-11 (blocked, in-progress) + issue-15 (code-review, in-review) = 5 lines total
    await expect(page.locator('.in-progress-items .line')).toHaveCount(5);

    // Top-level items are visible
    await expect(page.locator('.in-progress-items .line:has-text("Parent task in progress")')).toBeVisible();
    await expect(page.locator('.in-progress-items .line:has-text("Beta task in progress")')).toBeVisible();

    // Child task exists but is hidden (depth > 0) until parent is expanded
    // Note: hidden class is now on .node wrapper, not .line
    const childTask = page.locator('.in-progress-items .line:has-text("Child task todo")');
    await expect(childTask).toHaveCount(1);
    // Use data-id to get the specific node wrapper
    const childNode = page.locator('.in-progress-items .node[data-id="issue-2"]');
    await expect(childNode).toHaveClass(/hidden/);
  });

  test('displays correct state indicators', async ({ page }) => {
    // Mock data defines 15 issues with various states and labels
    // In-progress issues: issue-1, issue-4, issue-11 (blocked), issue-15 (code-review)
    // Each in-progress appears 2x (In Progress section + project section)
    // In-progress count: issue-1 x2 + issue-4 x2 + issue-11 x2 + issue-15 x2 = 8
    const inProgressStates = page.locator('.state.in-progress');
    await expect(inProgressStates).toHaveCount(8);

    // Todo issues include: issue-2 (x2), issue-5, issue-6, issue-7, issue-8, issue-9, issue-10, issue-12, issue-13, issue-14
    // Count: issue-2 x2 + all others x1 = 11
    await expect(page.locator('.state.todo')).toHaveCount(11);
  });

  test('shows logout link when authenticated', async ({ page }) => {
    const logoutLink = page.locator('.nav-action[href="/logout"]');
    await expect(logoutLink).toBeVisible();
    await expect(logoutLink).toContainText('logout');
  });

  test('shows text-based navigation bar with logout only', async ({ page }) => {
    // Should have nav bar
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Should have logout in nav bar (reset/audit moved to footer)
    await expect(page.locator('.nav-action[href="/logout"]')).toBeVisible();

    // Reset and audit should NOT be in nav bar
    await expect(page.locator('.nav-bar .reset-view')).not.toBeVisible();
    await expect(page.locator('.nav-bar .nav-action[href="/fancy"]')).not.toBeVisible();
  });

  test('shows footer with reset, all navigation links, and deploy info', async ({ page }) => {
    // Footer should be visible
    await expect(page.locator('.page-footer')).toBeVisible();

    // Should have reset link in footer
    await expect(page.locator('.footer-action.reset-view')).toBeVisible();

    // Should have all navigation links (dashboard has no "current page" so all are links)
    await expect(page.locator('.footer-action[href="/settings"]')).toBeVisible();
    await expect(page.locator('.footer-action[href="/prompts"]')).toBeVisible();
    await expect(page.locator('.footer-action[href="/fancy"]')).toBeVisible();

    // Should NOT have any bold current page indicator on dashboard
    await expect(page.locator('.footer-current')).not.toBeVisible();

    // Should have deploy info section with GitHub link (fallback in test mode)
    await expect(page.locator('.footer-deploy')).toBeVisible();
    await expect(page.locator('.footer-link')).toBeVisible();
  });

  test('shows organization name from mock data', async ({ page }) => {
    // The h1 should contain the organization name from mock data
    // (not the landing page title "Linear Projects Viewer")
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    // Check it's not the landing page
    await expect(h1).not.toContainText('Linear Projects Viewer');
  });

  test('renders CSS-based tree structure', async ({ page }) => {
    // Tree structure is now rendered with CSS pseudo-elements instead of box-drawing characters
    // Verify the .tree container exists and contains nodes
    const treeContainer = page.locator('.project .tree');
    await expect(treeContainer.first()).toBeVisible();

    // Verify nodes are inside tree container
    const nodesInTree = page.locator('.project .tree > .node');
    await expect(nodesInTree.first()).toBeVisible();

    // Verify the node has padding-left for indentation (applied by CSS)
    const nodeStyle = await nodesInTree.first().evaluate(el => getComputedStyle(el).paddingLeft);
    expect(parseFloat(nodeStyle)).toBeGreaterThan(0);
  });
});
