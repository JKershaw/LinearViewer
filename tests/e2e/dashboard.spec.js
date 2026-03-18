import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

test.describe('Authenticated Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session (server will use mock data in test mode)
    await page.goto('/test/set-session');

    // Navigate to workspace page (authenticated users are redirected here)
    await page.goto(WORKSPACE_URL);
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
    // Mock data defines 10 issues with various states and labels
    // In-progress issues (type: 'started'): issue-1, issue-4, blocked issue, code-review issue
    // Each in-progress appears 2x (In Progress section + project section)
    // In-progress count: 4 issues x 2 = 8
    const inProgressStates = page.locator('.state.in-progress');
    await expect(inProgressStates).toHaveCount(8);

    // Todo issues (type: 'unstarted'): issue-2, bug issue, plan issue
    // issue-2 appears 2x (child of in-progress parent), others appear 1x
    // Todo count: 2 + 1 + 1 = 4
    await expect(page.locator('.state.todo')).toHaveCount(4);

    // Backlog issues (type: 'backlog'): issue-5, preparing issue
    // Each appears 1x in project section only
    // Backlog count: 1 + 1 = 2
    await expect(page.locator('.state.backlog')).toHaveCount(2);
  });

  test('shows text-based navigation bar', async ({ page }) => {
    // Should have nav bar
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Logout should NOT be in nav bar (moved to settings page)
    await expect(page.locator('.nav-action[href="/logout"]')).not.toBeVisible();

    // Reset and audit should NOT be in nav bar
    await expect(page.locator('.nav-bar .reset-view')).not.toBeVisible();
    await expect(page.locator('.nav-bar .nav-action[href="/audit"]')).not.toBeVisible();
  });

  test('shows footer with reset, all navigation links, and deploy info', async ({ page }) => {
    // Footer should be visible
    await expect(page.locator('.page-footer')).toBeVisible();

    // Should have reset link in footer
    await expect(page.locator('.footer-action.reset-view')).toBeVisible();

    // Should have all navigation links with workspace prefix (dashboard has no "current page" so all are links)
    await expect(page.locator(`.footer-action[href="/workspace/${TEST_WORKSPACE_URL_KEY}/settings"]`)).toBeVisible();
    await expect(page.locator(`.footer-action[href="/workspace/${TEST_WORKSPACE_URL_KEY}/swim"]`)).toBeVisible();

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
