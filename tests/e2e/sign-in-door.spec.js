import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';

// LIN-3995 outcome 2: a sign-in door this server has not set up carries the
// landing's look. The e2e webServer runs with no GITHUB_* configured (see
// settings-providers.spec.js), so the GitHub door is the unconfigured one here.
test.describe('Unconfigured sign-in door', () => {
  // LIN-4567: in the public frame, the wordmark in the band links home and the door's sentence is the page's one h1.
  test('carries the Harbour wordmark linking home, under a title with no "Projects"', async ({ page }) => {
    const response = await page.goto('/auth/github?mode=new');
    expect(response.status()).toBe(503);
    await expect(page.locator(SELECTORS.nav.publicBrand)).toHaveAttribute('href', '/');
    await expect(page.locator(SELECTORS.nav.heading)).toHaveText('GitHub sign-in is not set up');
    await expect(page).toHaveTitle('GitHub sign-in is not set up · Harbour');
    await expect(page.locator('a.login-button')).toHaveText('Go back');
  });
});
