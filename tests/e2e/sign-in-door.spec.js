import { test, expect } from '../fixtures/test-base.js';

// LIN-3995 outcome 2: a sign-in door this server has not set up carries the
// landing's look. The e2e webServer runs with no GITHUB_* configured (see
// settings-providers.spec.js), so the GitHub door is the unconfigured one here.
test.describe('Unconfigured sign-in door', () => {
  test('heads with the Harbour wordmark linking home, under a title with no "Projects"', async ({ page }) => {
    const response = await page.goto('/auth/github?mode=new');
    expect(response.status()).toBe(503);
    await expect(page.locator('h1 a.header-link')).toHaveText('Harbour');
    await expect(page.locator('h1 a.header-link')).toHaveAttribute('href', '/');
    await expect(page).toHaveTitle('GitHub sign-in is not set up - Harbour');
    await expect(page.locator('a.login-button')).toHaveText('Go back');
  });
});
