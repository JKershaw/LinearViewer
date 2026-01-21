import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

test.describe('Input Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test('invalid workspace urlKey on switch returns 400', async ({ page }) => {
    // Special characters are not allowed in urlKey
    const response = await page.request.post('/workspace/invalid@workspace!/switch');
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('Invalid workspace ID');
  });

  test('invalid workspace urlKey on remove returns 400', async ({ page }) => {
    // urlKey too long (over 50 chars) is invalid
    const response = await page.request.post('/workspace/' + 'a'.repeat(51) + '/remove');
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('Invalid workspace ID');
  });

  test('non-existent workspace urlKey on switch returns 404', async ({ page }) => {
    // Valid urlKey format but not in session
    const response = await page.request.post('/workspace/nonexistent-workspace/switch');
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('Workspace not found');
  });

  test('invalid team filter is ignored', async ({ page }) => {
    // Invalid team ID should be ignored (not cause error)
    await page.goto(`${WORKSPACE_URL}?team=invalid-team-id`);

    // Page should still load normally
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('.project')).toHaveCount(2); // Both test projects
  });
});

test.describe('Session State', () => {
  test('cleared session shows landing page', async ({ page }) => {
    // First authenticate
    await page.goto('/test/set-session');
    await page.goto(WORKSPACE_URL);
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Clear session
    await page.goto('/test/clear-session');
    await page.goto('/');

    // Should show landing page
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('session persists across page reloads', async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto(WORKSPACE_URL);
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Reload the page
    await page.reload();

    // Session should still be valid
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('#workspace-toggle')).toHaveText('Test Workspace');
  });
});

test.describe('Team Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test('team selector shows all teams', async ({ page }) => {
    await page.goto(WORKSPACE_URL);

    const teamToggle = page.locator('#team-toggle');
    await expect(teamToggle).toBeVisible();
    await teamToggle.click();

    const teamOptions = page.locator('#team-options');
    await expect(teamOptions).toBeVisible();

    // Should show "all" + 2 teams from mock data (Engineering, Design)
    const options = teamOptions.locator('.nav-option');
    await expect(options).toHaveCount(3);
    await expect(teamOptions).toContainText('all');
    await expect(teamOptions).toContainText('Engineering');
    await expect(teamOptions).toContainText('Design');
  });

  test('selecting "all" removes team filter', async ({ page }) => {
    // Start with Engineering team filter (UUID format)
    await page.goto(`${WORKSPACE_URL}?team=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`);

    await page.locator('#team-toggle').click();
    await page.locator('#team-options .nav-option[data-team="all"]').click();

    // URL should not have team parameter
    await expect(page).not.toHaveURL(/team=/);
    await expect(page.locator('#team-toggle')).toHaveText('all');
  });

  test('team filter shows only issues from selected team', async ({ page }) => {
    // Filter to Engineering team - should show Project Alpha issues only
    await page.goto(`${WORKSPACE_URL}?team=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`);

    // Team toggle should show Engineering
    await expect(page.locator('#team-toggle')).toHaveText('Engineering');

    // Project Alpha has Engineering issues, Project Beta has Design issues
    // With Engineering filter, Beta project should have no visible issues
    const alphaProject = page.locator('.project[data-id="proj-alpha"]');
    const betaProject = page.locator('.project[data-id="proj-beta"]');

    // Alpha should have issues visible
    await expect(alphaProject.locator('.node')).not.toHaveCount(0);

    // Beta should exist but have no issues (empty project)
    await expect(betaProject).toBeVisible();
    await expect(betaProject.locator('.node')).toHaveCount(0);
  });
});

test.describe('OAuth Error Handling', () => {
  test('OAuth callback with error shows friendly message', async ({ page }) => {
    // Simulate user denying access
    await page.goto('/auth/callback?error=access_denied');

    // Should show error page with message
    await expect(page.locator('.error-container')).toBeVisible();
    await expect(page.locator('.error-title')).toContainText('Authorization Cancelled');
    await expect(page.locator('.error-message')).toContainText('cancelled');
  });

  test('OAuth callback with invalid state shows error', async ({ page }) => {
    // Try callback without valid state (session state won't match)
    await page.goto('/auth/callback?code=test&state=invalid-state');

    await expect(page.locator('.error-container')).toBeVisible();
    await expect(page.locator('.error-title')).toContainText('Session Expired');
  });
});
