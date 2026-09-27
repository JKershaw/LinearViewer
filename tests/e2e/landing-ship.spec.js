import { test, expect } from '../fixtures/test-base.js';

// LIN-1892 (G2): the unauthenticated /ship preview renders the same isLanding
// navbar as /swipe and /swim, and that bar is its only sign-in path. No other
// spec does a signed-out goto('/ship') (every ship*.spec.js uses
// /workspace/…/ship), so this one pins the navbar's CTAs there.
test.describe('Landing Ship Page (/ship)', () => {
  test('shows the landing nav with the Linear, Jira and email sign-in CTAs', async ({ page }) => {
    await page.goto('/ship');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="nav-login-linear"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-linear"]')).toHaveAttribute('href', '/auth/linear');
    // Jira: the webServer sets the three JIRA_* placeholders (see landing-swipe.spec.js).
    await expect(page.locator('[data-testid="nav-login-jira"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-jira"]')).toHaveAttribute('href', '/auth/jira/oauth?mode=new');
    // Email: the webServer sets EMAIL_TRANSPORT=capture (NODE_ENV=test).
    await expect(page.locator('[data-testid="nav-login-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-email"]')).toHaveAttribute('href', '/auth/email');
    await expect(page.locator('nav a[href="/"]')).toBeVisible();
  });

  test('signed-out /ship is the preview, not a redirect', async ({ page }) => {
    const response = await page.goto('/ship');
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/ship$/);
  });
});
