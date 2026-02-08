import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;

test.describe('Feature Toggle Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session
    await page.goto('/test/set-session');
  });

  test('settings page shows Features section with all toggles', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Features section header should be visible
    const featuresHeader = page.locator('.settings-header:has-text("Features")');
    await expect(featuresHeader).toBeVisible();

    // All 5 feature toggle labels should be present
    await expect(page.locator('.feature-toggle-label:has-text("Linear MCP in prompts")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Feature branch workflow")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Dispatch queue")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("AI recommendations")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Prompt buttons")')).toBeVisible();
  });

  test('shows correct default toggle states', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Defaults: linearMcp ON, featureBranches OFF, dispatch OFF, aiRecommendations ON, promptButtons ON
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('on');
    await expect(page.locator('[data-feature="featureBranches"] .toggle-state')).toHaveText('off');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('off');
    await expect(page.locator('[data-feature="aiRecommendations"] .toggle-state')).toHaveText('on');
    await expect(page.locator('[data-feature="promptButtons"] .toggle-state')).toHaveText('on');
  });

  test('shows recommendation note on Linear MCP toggle', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    const mcpNote = page.locator('[data-feature="linearMcp"] .feature-note');
    await expect(mcpNote).toBeVisible();
    await expect(mcpNote).toContainText('Recommended');
  });

  test('can toggle a feature off and state persists on reload', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // linearMcp should start ON
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('on');

    // Click the toggle button to turn it off
    await page.locator('[data-feature="linearMcp"] .toggle-btn').click();

    // Should redirect back to settings — wait for page load
    await page.waitForLoadState('networkidle');

    // Should now be OFF
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('off');

    // Reload page — state should persist (stored in session)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('off');
  });

  test('can toggle a feature on', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // dispatch should start OFF
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('off');

    // Click to turn it on
    await page.locator('[data-feature="dispatch"] .toggle-btn').click();
    await page.waitForLoadState('networkidle');

    // Should now be ON
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('on');
  });

  test('toggling one feature does not affect others', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Turn off linearMcp
    await page.locator('[data-feature="linearMcp"] .toggle-btn').click();
    await page.waitForLoadState('networkidle');

    // linearMcp should be off, but others unchanged
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('off');
    await expect(page.locator('[data-feature="featureBranches"] .toggle-state')).toHaveText('off');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('off');
    await expect(page.locator('[data-feature="aiRecommendations"] .toggle-state')).toHaveText('on');
    await expect(page.locator('[data-feature="promptButtons"] .toggle-state')).toHaveText('on');
  });

  test('feature toggles API rejects invalid feature key', async ({ page }) => {
    const response = await page.request.post(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/settings/features`,
      {
        form: { feature: 'invalidFeature', enabled: 'true' }
      }
    );
    // Should redirect with error (or return 400 for API)
    expect(response.status()).toBe(400);
  });
});
