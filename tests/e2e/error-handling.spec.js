import { test, expect } from '../fixtures/test-base.js';
import { localDashboardUrl } from '../fixtures/local-harness.js';

// Mixed-harness boundary split (LIN-428, parent S3/LIN-389).
//   - Input Validation + Session State migrate onto a GENUINE `provider: 'local'`
//     session (seedLocalWorkspace) — provider-agnostic validation and the
//     session lifecycle are fully modelled by the local harness.
//   - Team Filtering + OAuth Error Handling stay PINNED on the Linear
//     `test-token` path: team filtering needs the full team data the local
//     provider declares OFF, and OAuth callbacks are the auth bootstrap the
//     local harness deliberately does not model.

test.describe('Input Validation', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal();
  });

  test('invalid workspace urlKey on remove returns 400', async ({ page }) => {
    // urlKey too long (over 50 chars) is invalid
    const response = await page.request.post('/workspace/' + 'a'.repeat(51) + '/remove');
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('Invalid workspace ID');
  });

  test('invalid team filter is ignored', async ({ page, localWorkerUrlKey }) => {
    // Invalid team ID should be ignored (not cause error)
    await page.goto(`${localDashboardUrl(localWorkerUrlKey)}?team=invalid-team-id`);

    // Page should still load normally
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('.project')).toHaveCount(2); // Both local-seed projects
  });
});

test.describe('Session State', () => {
  test('cleared session shows landing page', async ({ page, seedLocal }) => {
    // First authenticate (seed a local-backed session)
    const { dashboard } = await seedLocal();
    await page.goto(dashboard);
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Clear session
    await page.goto('/test/clear-session');
    await page.goto('/');

    // Should show landing page
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('session persists across page reloads', async ({ page, seedLocal }) => {
    const { dashboard } = await seedLocal();
    await page.goto(dashboard);
    await expect(page.locator('.nav-bar')).toBeVisible();

    // Reload the page
    await page.reload();

    // Session should still be valid
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('#workspace-toggle')).toHaveText('Local Workspace');
  });
});

test.describe('Team Filtering', () => {
  // PINNED: needs full team data the local provider declares OFF. Driven off the
  // per-worker key (LIN-628) so session + nav address this worker's partition.
  let WORKSPACE_URL;

  test.beforeEach(async ({ page, workerUrlKey }) => {
    WORKSPACE_URL = `/workspace/${workerUrlKey}/`;
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
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

    // The filter is cleared (toggle shows "all"). Selecting "all" now carries an
    // explicit ?team=all so the server records the choice rather than treating a
    // bare URL as "restore the prior selection" (LIN-727).
    await expect(page).toHaveURL(/team=all/);
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

  // LIN-2025 close-out (implementation review, "What CI Did Not Prove" #2):
  // the page routes' GRACEFUL arm — a well-formed team id that is not in a
  // NON-EMPTY team list — had no CI coverage. `error-handling.spec.js:25`
  // covers the teamless-provider passthrough (Local) and the tests above cover
  // a matching id; this covers the third arm, which is the one John's ruling
  // deliberately left graceful for pages: render the full board, not an empty
  // one, and let the toggle report the filter as dropped.
  test('an unmatched team filter drops to unscoped: full board renders, toggle reads all', async ({ page }) => {
    const UNMATCHED_TEAM_UUID = '99999999-9999-9999-9999-999999999999';
    await page.goto(`${WORKSPACE_URL}?team=${UNMATCHED_TEAM_UUID}`);

    // Dropped to unscoped, and the UI says so rather than showing a stale name.
    await expect(page.locator('#team-toggle')).toHaveText('all');

    // Both teams' work is present — Alpha is Engineering, Beta is Design — so
    // this is genuinely the whole board, not one team's slice or an empty one.
    await expect(page.locator('.project[data-id="proj-alpha"] .node')).not.toHaveCount(0);
    await expect(page.locator('.project[data-id="proj-beta"] .node')).not.toHaveCount(0);
  });
});

test.describe('OAuth Error Handling', () => {
  // PINNED: OAuth callbacks are the auth bootstrap the local harness does not model.
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
