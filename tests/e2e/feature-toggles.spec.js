import { test, expect } from '../fixtures/test-base.js';
import {
  seedLocalWorkspace,
  workspaceApiLocalSeed,
  LOCAL_WORKSPACE_URL_KEY,
} from '../fixtures/local-harness.js';

// Migrated onto a GENUINE `provider: 'local'` session (LIN-425, parent S3) seeded
// from `workspaceApiLocalSeed` — the same `testMockData` ids/titles the old
// `test-token` path used, so TEST_ISSUE_ID (TEST-6) and the prompt-content
// assertions survive. Flag-specific tests re-seed via the third `options` arg
// (`{ features }`) instead of `/test/set-session?features=`.
//
// One faithful assertion shift: the prompt's tracker reference renders as the
// provider's display name. On the local provider that is "in Local", not "in
// Linear" (applyPromptCapabilities renames `Linear` → `Local`). The `linearMcp`
// toggle still gates that reference identically — only the tracker name differs.
const TEST_WORKSPACE_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;
// UUID-format issue ID from the seed (TEST-6 = "Task needing preparation", Backlog)
const TEST_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Feature Toggle Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Seed a local-backed workspace with default feature flags.
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
  });

  test('settings page shows AI and Workflow sections with all toggles', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // AI and Workflow section headers should be visible
    await expect(page.locator('.settings-header:text-is("AI")')).toBeVisible();
    await expect(page.locator('.settings-header:text-is("Workflow")')).toBeVisible();

    // All feature toggle labels should be present (split across sections)
    await expect(page.locator('.feature-toggle-label:has-text("Use Linear MCP")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Feature branch workflow")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Code review before completing")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Dispatch queue")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Linear API proxy")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("AI recommendations")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Prompt buttons")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Narrative roadmap")')).toBeVisible();
  });

  test('shows correct default toggle states', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Defaults: linearMcp ON, featureBranches OFF, codeReview OFF, dispatch OFF, proxy OFF, aiRecommendations ON, promptButtons ON, roadmap OFF
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="featureBranches"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="codeReview"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="proxy"] .toggle-state')).toHaveText('○ off');
    await expect(page.locator('[data-feature="aiRecommendations"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="promptButtons"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('○ off');
  });

  test('shows recommendation note on Linear references toggle', async ({ page }) => {
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
  // Linear references toggle affects prompt content
  // =========================================================================

  test('prompts include tracker references by default', async ({ page }) => {
    // Default: linearMcp is ON. The tracker reference renders with the provider's
    // display name — "in Local" on the local provider (was "in Linear" on Linear).
    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/look-into`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('in Local');
  });

  test('prompts exclude tracker references when linearMcp is off', async ({ page }) => {
    // Re-seed with linearMcp OFF — the tracker reference must drop out entirely.
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { linearMcp: false } });

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/look-into`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('in Local');
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
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { featureBranches: true } });

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
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { dispatch: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Queue badge should exist (hidden class applied by JS when count is 0, but element exists)
    await expect(page.locator('[data-queue-badge]')).toHaveCount(1);
  });

  test('dispatch section hidden in settings when dispatch off', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Dispatch section should not be visible
    await expect(page.locator('.settings-header:text-is("Dispatch")')).toHaveCount(0);
  });

  test('dispatch link visible in footer when dispatch on', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { dispatch: true } });

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Dispatch link should appear in footer
    await expect(page.locator('footer a[href*="/dispatch"]')).toBeVisible();
  });

  // =========================================================================
  // LIN-172: Prompt buttons toggle affects UI visibility
  // =========================================================================

  test('prompts section is hidden when promptButtons is off', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { promptButtons: false } });

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
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { aiRecommendations: false } });

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
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { codeReview: true } });

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

  test('clicking codeReview toggle dynamically shows sub-toggles via AJAX', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Sub-toggles should start hidden (codeReview defaults to off)
    await expect(page.locator('.code-review-options')).toBeHidden();

    // Click the codeReview toggle to turn it on
    await page.locator('[data-feature="codeReview"] .toggle-btn').click();

    // Sub-toggles should appear without page reload
    await expect(page.locator('.code-review-options')).toBeVisible();
  });

  test('clicking codeReview toggle dynamically hides sub-toggles via AJAX', async ({ page }) => {
    // Start with codeReview ON
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { codeReview: true } });
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Sub-toggles should start visible
    await expect(page.locator('.code-review-options')).toBeVisible();

    // Click the codeReview toggle to turn it off
    await page.locator('[data-feature="codeReview"] .toggle-btn').click();

    // Sub-toggles should hide without page reload
    await expect(page.locator('.code-review-options')).toBeHidden();
  });

  test('codeReview sub-toggles round-trip: on then off in single session', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Start off
    await expect(page.locator('.code-review-options')).toBeHidden();

    // Toggle on
    await page.locator('[data-feature="codeReview"] .toggle-btn').click();
    await expect(page.locator('.code-review-options')).toBeVisible();

    // Toggle off again without reload
    await page.locator('[data-feature="codeReview"] .toggle-btn').click();
    await expect(page.locator('.code-review-options')).toBeHidden();
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

  test('plan prompt does NOT get code review sections (plan is not implementation)', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { codeReview: true, codeReviewCicd: true, codeReviewPr: true } });

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Plan is a pure planning step — code review sections only apply to implementation
    expect(data.prompt).not.toContain('Self-Review');
    expect(data.prompt).not.toContain('CI/CD Check');
    expect(data.prompt).not.toContain('PR Review');
  });

  test('implementation prompt also gets code review sections', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { codeReview: true, codeReviewCicd: true } });

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/implementation`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).toContain('Self-Review');
    expect(data.prompt).toContain('CI/CD Check');
  });

  test('review prompt does NOT get code review sections', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { codeReview: true, codeReviewCicd: true } });

    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/prompt/${TEST_ISSUE_ID}/review`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // review IS a review (code-review was consolidated into it — LIN-523); the
    // implementation-only codeReview flag sections must not be appended to it.
    expect(data.prompt).not.toContain('## Self-Review');
    expect(data.prompt).not.toContain('## CI/CD Check');
  });

  // =========================================================================
  // LIN-193: Proxy toggle affects UI visibility
  // =========================================================================

  test('proxy toggle is visible in Workflow section on settings page', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.feature-toggle-label:has-text("Linear API proxy")')).toBeVisible();
  });

  test('proxy toggle defaults to off', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-feature="proxy"] .toggle-state')).toHaveText('○ off');
  });

  test('proxy nav link hidden by default (proxy off)', async ({ page }) => {
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('a[href*="/proxy"]')).toHaveCount(0);
  });

  test('proxy footer link visible when proxy is on', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { proxy: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.footer-actions a:has-text("proxy")')).toBeVisible();
  });

  test('proxy page redirects to settings when proxy is off', async ({ page }) => {
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/proxy`);

    // Should redirect to settings
    await expect(page).toHaveURL(new RegExp(`/workspace/${TEST_WORKSPACE_URL_KEY}/settings`));
  });

  test('proxy page loads when proxy is on', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { proxy: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/proxy`);
    await page.waitForLoadState('networkidle');

    // Should stay on proxy page, not redirect
    await expect(page).toHaveURL(new RegExp(`/workspace/${TEST_WORKSPACE_URL_KEY}/proxy`));
  });

  test('can toggle proxy on via settings and state persists', async ({ page }) => {
    await page.goto(SETTINGS_URL);
    await page.waitForLoadState('networkidle');

    // Should start OFF
    await expect(page.locator('[data-feature="proxy"] .toggle-state')).toHaveText('○ off');

    // Click to turn on
    await page.locator('[data-feature="proxy"] .toggle-btn').click();
    await expect(page.locator('[data-feature="proxy"] .toggle-state')).toHaveText('● on');

    // Reload — state should persist
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="proxy"] .toggle-state')).toHaveText('● on');
  });

  // =========================================================================
  // Proxy toggle button in prompt UI
  // =========================================================================

  test('proxy toggle button hidden when proxy feature is off', async ({ page }) => {
    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // Proxy toggle buttons should not exist
    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);
  });

  test('proxy toggle button rendered in prompt containers when proxy feature is on', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { proxy: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    // LIN-442: prompt containers (and their +proxy toggle) now live in the lazy
    // detail block, fetched on first expand — so expand an issue, then the
    // toggle is present in the DOM (inside the hidden prompt container).
    await page.locator('.line.expandable').first().click();
    await expect(page.locator('.prompt-proxy-toggle').first()).toBeAttached();
  });

  test('proxy toggle button appears on dispatch page when proxy is on', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { proxy: true, dispatch: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    // The +proxy toggle lives inside the Dispatch options disclosure panel;
    // expand it so the button is visible.
    await page.locator('.dispatch-toggle').click();
    await expect(page.locator('.prompt-proxy-toggle')).toBeVisible();
  });

  test('proxy toggle button absent on dispatch page when proxy is off', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed, { features: { dispatch: true } });

    await page.goto(`/workspace/${TEST_WORKSPACE_URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);
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
