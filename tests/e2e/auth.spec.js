import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.goto('/test/clear-session');
  });

  test('unauthenticated users see landing page', async ({ page }) => {
    await page.goto('/');

    // Should see landing page (has is-landing class on body)
    await expect(page.locator('body')).toHaveClass(/is-landing/);

    // Should have the "Login" project section
    await expect(page.locator('.project-header:has-text("Login")')).toBeVisible();

    // The "Connect with Linear" issue should be visible (parent issue in Login section)
    await expect(page.locator('.title:has-text("Connect with Linear")')).toBeVisible();
  });

  test('unauthenticated users do not see logout or reset links', async ({ page }) => {
    await page.goto('/');

    // Navigation actions should not be present on landing page
    await expect(page.locator('.nav-action')).toHaveCount(0);
    await expect(page.locator('a[href="/logout"]')).toHaveCount(0);
  });

  test('login link exists and points to auth endpoint', async ({ page }) => {
    await page.goto('/');

    // The login link is in the details of the "Connect with Linear" issue
    // First expand that issue to reveal the link
    const connectIssue = page.locator('.line:has(.title:has-text("Connect with Linear"))');
    await connectIssue.click();

    // Now the login link should be visible
    const loginLink = page.locator('a[href="/auth/linear"]');
    await expect(loginLink).toBeVisible();

    // Verify the link text
    await expect(loginLink).toContainText('Login with Linear');
  });

  test('authenticated users see dashboard with navigation', async ({ page }) => {
    // Set up authenticated session
    await page.goto('/test/set-session');
    await page.goto('/');

    // Should see dashboard (no is-landing class)
    await expect(page.locator('body')).not.toHaveClass(/is-landing/);

    // Should see navigation bar with actions
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('.reset-view')).toBeVisible();
    await expect(page.locator('a[href="/logout"]')).toBeVisible();
  });

  test('authenticated users see workspace selector', async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/');

    // Should see workspace selector
    const workspaceToggle = page.locator('#workspace-toggle');
    await expect(workspaceToggle).toBeVisible();
    await expect(workspaceToggle).toHaveText('test-workspace');
  });
});

test.describe('Logout Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated session
    await page.goto('/test/set-session');
  });

  test('logout link destroys session and shows landing page', async ({ page }) => {
    await page.goto('/');

    // Verify we're authenticated
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Click logout and wait for navigation
    await Promise.all([
      page.waitForURL('/'),
      page.click('a[href="/logout"]')
    ]);

    // Should be redirected to landing page
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('after logout, navigating to home shows landing page', async ({ page }) => {
    await page.goto('/');

    // Click logout and wait for redirect
    await Promise.all([
      page.waitForURL('/'),
      page.click('a[href="/logout"]')
    ]);

    // Navigate again to verify session is truly destroyed
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });
});
