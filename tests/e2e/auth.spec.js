import { test, expect } from '../fixtures/test-base.js';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.goto('/test/clear-session');
  });

  test('unauthenticated users see landing page', async ({ page }) => {
    await page.goto('/');

    // Should see landing page (has is-landing class on body)
    await expect(page.locator('body')).toHaveClass(/is-landing/);

    // The Harbour brand hero fronts the page with the Linear sign-in CTA
    // (LIN-726 moved sign-in out of the content tree into the hero).
    await expect(page.locator('[data-testid="landing-hero"]')).toBeVisible();
    await expect(page.locator('[data-testid="landing-cta-linear"]')).toBeVisible();
  });

  test('unauthenticated users see the shared nav sign-in but no authed chrome', async ({ page }) => {
    await page.goto('/');

    // LIN-980: the landing composes D's shared header nav (isLanding branch) —
    // so it DOES carry a sign-in action, but none of the authenticated-only
    // chrome (workspace/team selectors, reset, logout).
    await expect(page.locator('nav.nav-bar a.login')).toBeVisible();
    await expect(page.locator('[data-selector="workspace"]')).toHaveCount(0);
    await expect(page.locator('[data-selector="team"]')).toHaveCount(0);
    await expect(page.locator('.reset-view')).toHaveCount(0);
    await expect(page.locator('a.logout')).toHaveCount(0);
  });

  test('login link exists and points to auth endpoint', async ({ page }) => {
    await page.goto('/');

    // The Linear CTA in the hero is a plain, directly-visible link (LIN-726) —
    // no expand step, always reachable for keyboard/screen-reader users.
    const loginLink = page.locator('[data-testid="landing-cta-linear"]');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/auth/linear');
    await expect(loginLink).toContainText('Log in with Linear');

    // Reachable by keyboard (it's a real <a>, in the tab order).
    await loginLink.focus();
    await expect(loginLink).toBeFocused();
  });

  test('authenticated users see dashboard with navigation', async ({ page, workerUrlKey }) => {
    // Set up authenticated session
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/`);

    // Should see dashboard (no is-landing class)
    await expect(page.locator('body')).not.toHaveClass(/is-landing/);

    // Should see navigation bar with actions
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('.reset-view')).toBeVisible();
  });

  test('authenticated users see workspace selector', async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/`);

    // Should see workspace selector
    const workspaceToggle = page.locator('#workspace-toggle');
    await expect(workspaceToggle).toBeVisible();
    await expect(workspaceToggle).toHaveText('Test Workspace');
  });
});

test.describe('Logout Flow', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    // Set up authenticated session
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
  });

  test('logout link destroys session and shows landing page', async ({ page, workerUrlKey }) => {
    await page.goto(`/workspace/${workerUrlKey}/settings`);

    // Verify we're authenticated
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Click logout on settings page and wait for navigation
    await Promise.all([
      page.waitForURL('/'),
      page.click('a[href="/logout"]')
    ]);

    // Should be redirected to landing page
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('after logout, navigating to home shows landing page', async ({ page, workerUrlKey }) => {
    await page.goto(`/workspace/${workerUrlKey}/settings`);

    // Click logout on settings page and wait for redirect
    await Promise.all([
      page.waitForURL('/'),
      page.click('a[href="/logout"]')
    ]);

    // Navigate again to verify session is truly destroyed
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });
});
