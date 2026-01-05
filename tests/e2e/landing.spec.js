import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh state for each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('renders landing page for unauthenticated users', async ({ page }) => {
    await page.goto('/');

    // Should show the organization name from landing.md
    await expect(page.locator('h1')).toContainText('Linear Projects Viewer');
  });

  test('shows login link', async ({ page }) => {
    await page.goto('/');

    // Should have a login link pointing to OAuth
    const loginLink = page.locator('a.login');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/auth/linear');
  });

  test('displays static project preview from landing.md', async ({ page }) => {
    await page.goto('/');

    // Should show project headers from landing.md
    await expect(page.locator('.project-header')).toHaveCount(5);
    await expect(page.locator('.project-header:has-text("Login")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("What This Is")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Self-Host")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Use Cases")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Source")')).toBeVisible();
  });

  test('displays state indicators correctly', async ({ page }) => {
    await page.goto('/');

    // Should have different state indicators
    await expect(page.locator('.state.done')).toHaveCount(4); // ✓ indicators
    await expect(page.locator('.state.in-progress')).toHaveCount(1); // ◐ indicator
    await expect(page.locator('.state.todo')).toHaveCount(8); // ○ indicators
  });

  test('does not show logout link on landing page', async ({ page }) => {
    await page.goto('/');

    // Should NOT have logout link (only for authenticated users)
    await expect(page.locator('a.logout')).not.toBeVisible();
  });

  test('projects with @collapsed start collapsed by default', async ({ page }) => {
    await page.goto('/');

    // Self-Host, Use Cases, and Source should be collapsed (have ▶ arrow)
    const selfHostHeader = page.locator('.project-header:has-text("Self-Host")');
    const useCasesHeader = page.locator('.project-header:has-text("Use Cases")');
    const sourceHeader = page.locator('.project-header:has-text("Source")');

    await expect(selfHostHeader).toContainText('▶');
    await expect(useCasesHeader).toContainText('▶');
    await expect(sourceHeader).toContainText('▶');

    // Login and What This Is should be expanded (have ▼ arrow)
    const loginHeader = page.locator('.project-header:has-text("Login")');
    const whatThisIsHeader = page.locator('.project-header:has-text("What This Is")');

    await expect(loginHeader).toContainText('▼');
    await expect(whatThisIsHeader).toContainText('▼');
  });

  test('collapsed projects have hidden content', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project (should be collapsed)
    const selfHostProject = page.locator('.project[data-default-collapsed="true"]').first();
    await expect(selfHostProject).toBeVisible();

    // Lines inside collapsed project should not be visible
    const linesInCollapsed = selfHostProject.locator('.line');
    await expect(linesInCollapsed.first()).not.toBeVisible();
  });

  test('collapsed projects can be expanded by clicking header', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project
    const selfHostProject = page.locator('.project:has(.project-header:has-text("Self-Host"))');
    const selfHostHeader = selfHostProject.locator('.project-header');
    const linesInProject = selfHostProject.locator('.line');

    // Should start collapsed
    await expect(linesInProject.first()).not.toBeVisible();

    // Click to expand
    await selfHostHeader.click();

    // Lines should now be visible
    await expect(linesInProject.first()).toBeVisible();
    await expect(selfHostHeader).toContainText('▼');
  });

  test('data-default-collapsed attribute is present on collapsed projects', async ({ page }) => {
    await page.goto('/');

    // Should have 3 projects with data-default-collapsed
    const collapsedProjects = page.locator('.project[data-default-collapsed="true"]');
    await expect(collapsedProjects).toHaveCount(3);
  });

  test('reset button applies default collapsed state', async ({ page }) => {
    await page.goto('/');

    // Get the Self-Host project and expand it
    const selfHostProject = page.locator('.project:has(.project-header:has-text("Self-Host"))');
    const selfHostHeader = selfHostProject.locator('.project-header');
    const linesInProject = selfHostProject.locator('.line');

    // Expand it
    await selfHostHeader.click();
    await expect(linesInProject.first()).toBeVisible();

    // Click reset
    const resetButton = page.locator('.reset-view');
    await resetButton.click();

    // Should be collapsed again (default state)
    await expect(linesInProject.first()).not.toBeVisible();
    await expect(selfHostHeader).toContainText('▶');
  });
});
