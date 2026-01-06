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
    // issue-1 (in-progress) + issue-2 (child of issue-1, hidden) + issue-4 (in-progress) = 3 lines total
    await expect(page.locator('.in-progress-items .line')).toHaveCount(3);

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
    // Mock data defines 5 issues:
    // - issue-1: in-progress (appears in In Progress + Project Alpha)
    // - issue-2: todo, child of issue-1 (appears in In Progress as child + Project Alpha)
    // - issue-3: completed (hidden by default, only in Project Alpha)
    // - issue-4: in-progress (appears in In Progress + Project Beta)
    // - issue-5: backlog/todo (only in Project Beta)

    // In-progress count: issue-1 x2 + issue-4 x2 = 4
    const inProgressStates = page.locator('.state.in-progress');
    await expect(inProgressStates).toHaveCount(4);

    // Todo count: issue-2 x2 (In Progress + Alpha) + issue-5 x1 (Beta only) = 3
    await expect(page.locator('.state.todo')).toHaveCount(3);
  });

  test('shows logout link when authenticated', async ({ page }) => {
    const logoutLink = page.locator('.nav-action[href="/logout"]');
    await expect(logoutLink).toBeVisible();
    await expect(logoutLink).toContainText('logout');
  });

  test('shows text-based navigation bar', async ({ page }) => {
    // Should have nav bar
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Should have reset and logout actions
    await expect(page.locator('.nav-action.reset-view')).toBeVisible();
    await expect(page.locator('.nav-action[href="/logout"]')).toBeVisible();
  });

  test('shows organization name from mock data', async ({ page }) => {
    // The h1 should contain the organization name from mock data
    // (not the landing page title "Linear Projects Viewer")
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    // Check it's not the landing page
    await expect(h1).not.toContainText('Linear Projects Viewer');
  });

  test('renders box-drawing characters for tree structure', async ({ page }) => {
    // Should have prefix elements with box-drawing characters
    const prefixes = page.locator('.prefix');
    await expect(prefixes.first()).toBeVisible();

    // The prefix should contain box-drawing characters
    const prefixText = await prefixes.first().textContent();
    expect(prefixText).toMatch(/[├└│─]/);
  });
});
