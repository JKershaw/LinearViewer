import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;
// UUID-format issue ID from mock data (issue-4 = "Beta task in progress", In Progress state)
const TEST_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

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

  // =========================================================================
  // LIN-168: Linear MCP toggle affects prompt content
  // =========================================================================

  test('prompts include MCP instructions by default', async ({ page }) => {
    // Default: linearMcp is ON
    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/look-into`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('Linear MCP');
  });

  test('prompts exclude MCP instructions when linearMcp is off', async ({ page }) => {
    // Set session with linearMcp OFF
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ linearMcp: false }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/look-into`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('Linear MCP');
  });

  // =========================================================================
  // LIN-169: Feature branch toggle affects prompt content
  // =========================================================================

  test('prompts exclude git workflow by default', async ({ page }) => {
    // Default: featureBranches is OFF
    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('Git Workflow');
  });

  test('prompts include git workflow when featureBranches is on', async ({ page }) => {
    // Set session with featureBranches ON
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ featureBranches: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('Git Workflow');
  });

  // =========================================================================
  // LIN-170: Dispatch toggle affects UI visibility
  // =========================================================================

  test('dispatch UI is hidden by default (dispatch off)', async ({ page }) => {
    // Default: dispatch is OFF
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Queue badge should not be in the DOM
    await expect(page.locator('[data-queue-badge]')).toHaveCount(0);

    // Dispatch buttons on prompts should not exist
    await expect(page.locator('.dispatch-btn')).toHaveCount(0);
  });

  test('dispatch UI is visible when dispatch is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}`);

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Queue badge should exist (hidden class applied by JS when count is 0, but element exists)
    await expect(page.locator('[data-queue-badge]')).toHaveCount(1);
  });

  test('dispatch tokens section hidden in settings when dispatch off', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Dispatch Tokens section should not be visible
    await expect(page.locator('.settings-header:has-text("Dispatch Tokens")')).toHaveCount(0);
  });

  test('dispatch tokens section visible in settings when dispatch on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}`);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Dispatch Tokens section should be visible
    await expect(page.locator('.settings-header:has-text("Dispatch Tokens")')).toBeVisible();
  });

  // =========================================================================
  // LIN-172: Prompt buttons toggle affects UI visibility
  // =========================================================================

  test('prompts section is hidden when promptButtons is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ promptButtons: false }))}`);

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue to see its details
    await page.locator('.line[data-id]').first().click();
    await page.waitForTimeout(200);

    // Prompts toggle should not exist in any detail section
    await expect(page.locator('[data-toggle="prompts"]')).toHaveCount(0);
  });

  test('prompts section is visible by default (promptButtons on)', async ({ page }) => {
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue to see its details
    await page.locator('.line[data-id]').first().click();
    await page.waitForTimeout(200);

    // Prompts toggle should exist in expanded detail section
    await expect(page.locator('[data-toggle="prompts"]')).not.toHaveCount(0);
  });

  // =========================================================================
  // Validation
  // =========================================================================

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
