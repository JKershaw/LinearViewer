import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
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
    await expect(page.locator('.project-header')).toHaveCount(4);
    await expect(page.locator('.project-header:has-text("Login")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("What This Is")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Self-Host")')).toBeVisible();
    await expect(page.locator('.project-header:has-text("Source")')).toBeVisible();
  });

  test('displays state indicators correctly', async ({ page }) => {
    await page.goto('/');

    // Should have different state indicators
    await expect(page.locator('.state.done')).toHaveCount(4); // ✓ indicators
    await expect(page.locator('.state.in-progress')).toHaveCount(1); // ◐ indicator
    await expect(page.locator('.state.todo')).toHaveCount(4); // ○ indicators
  });

  test('does not show logout link on landing page', async ({ page }) => {
    await page.goto('/');

    // Should NOT have logout link (only for authenticated users)
    await expect(page.locator('a.logout')).not.toBeVisible();
  });
});
