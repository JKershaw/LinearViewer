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

  test('settings page shows AI and Workflow sections with all toggles', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // AI and Workflow section headers should be visible
    await expect(page.locator('.settings-header:has-text("AI")')).toBeVisible();
    await expect(page.locator('.settings-header:has-text("Workflow")')).toBeVisible();

    // All feature toggle labels should be present (split across sections)
    await expect(page.locator('.feature-toggle-label:has-text("Linear MCP in prompts")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Feature branch workflow")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Code review before completing")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Dispatch queue")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("AI recommendations")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Prompt buttons")')).toBeVisible();
  });

  test('shows correct default toggle states', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Defaults: linearMcp ON, featureBranches OFF, codeReview OFF, dispatch OFF, aiRecommendations ON, promptButtons ON
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="featureBranches"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="codeReview"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="aiRecommendations"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="promptButtons"] .toggle-state')).toHaveText('● on');
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
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('● on');

    // Click the toggle button to turn it off (AJAX — no page reload)
    await page.locator('[data-feature="linearMcp"] .toggle-btn').click();

    // Should update inline via AJAX
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('○ off');

    // Reload page — state should persist (stored in session)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('○ off');
  });

  test('can toggle a feature on', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // dispatch should start OFF
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('○ off');

    // Click to turn it on (AJAX — no page reload)
    await page.locator('[data-feature="dispatch"] .toggle-btn').click();

    // Should update inline via AJAX
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('● on');
  });

  test('toggling one feature does not affect others', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Turn off linearMcp (AJAX — no page reload)
    await page.locator('[data-feature="linearMcp"] .toggle-btn').click();

    // linearMcp should be off, but others unchanged
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="featureBranches"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="aiRecommendations"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="promptButtons"] .toggle-state')).toHaveText('● on');
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
  // LIN-171: AI recommendations toggle affects UI visibility
  // =========================================================================

  test('AI suggest button is hidden when aiRecommendations is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ aiRecommendations: false }))}`);

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue to see its details
    await page.locator('.line[data-id]').first().click();
    await page.waitForTimeout(200);

    // AI suggest button should not exist
    await expect(page.locator('.suggest-btn')).toHaveCount(0);

    // Recommendation container should not exist
    await expect(page.locator('.recommend-container')).toHaveCount(0);
  });

  test('AI suggest button is visible by default (aiRecommendations on)', async ({ page }) => {
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue to see its details
    await page.locator('.line[data-id]').first().click();
    await page.waitForTimeout(200);

    // AI suggest button should exist (when openRouterSource is configured in test)
    // Recommendation container should exist
    await expect(page.locator('.recommend-container')).not.toHaveCount(0);
  });

  // =========================================================================
  // LIN-173: Code review toggle affects prompt content and sub-toggle visibility
  // =========================================================================

  test('code review sub-toggles hidden by default (codeReview off)', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Parent toggle should be off
    await expect(page.locator('[data-feature="codeReview"] .toggle-state')).toHaveText('○ off');

    // Sub-toggles should be hidden
    await expect(page.locator('.code-review-options')).toBeHidden();
  });

  test('code review sub-toggles visible when codeReview is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true }))}`);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Parent toggle should be on
    await expect(page.locator('[data-feature="codeReview"] .toggle-state')).toHaveText('● on');

    // Sub-toggles should be visible with correct defaults
    await expect(page.locator('.code-review-options')).toBeVisible();
    await expect(page.locator('[data-feature="codeReviewSelf"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="codeReviewCicd"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="codeReviewPr"] .toggle-state')).toHaveText('○ off');
  });

  test('prompts exclude code review sections by default', async ({ page }) => {
    // Default: codeReview is OFF
    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('Self-Review');
    expect(data.prompt).not.toContain('CI/CD Check');
    expect(data.prompt).not.toContain('PR Review');
  });

  test('plan prompt includes self-review when codeReview is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Self-review defaults to on
    expect(data.prompt).toContain('Self-Review');
    expect(data.prompt).toContain('Verify correctness against task requirements');
  });

  test('plan prompt includes CI/CD check when codeReviewCicd is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true, codeReviewCicd: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('CI/CD Check');
    expect(data.prompt).toContain('Check CI/CD pipeline status');
  });

  test('plan prompt includes PR review when codeReviewPr is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true, codeReviewPr: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('PR Review');
    expect(data.prompt).toContain('Check for review comments');
  });

  test('implementation prompt also gets code review sections', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true, codeReviewCicd: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/implementation`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('Self-Review');
    expect(data.prompt).toContain('CI/CD Check');
  });

  test('code-review prompt does NOT get code review sections', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ codeReview: true, codeReviewCicd: true }))}`);

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/code-review`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // code-review template IS a review, should not get review instructions appended
    expect(data.prompt).not.toContain('Self-Review');
    expect(data.prompt).not.toContain('CI/CD Check');
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
