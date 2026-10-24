import { test, expect } from '../fixtures/test-base.js';
import {
  workspaceApiLocalSeed,
} from '../fixtures/local-harness.js';

// Migrated onto a GENUINE `provider: 'local'` session (LIN-425, parent S3) seeded
// from `workspaceApiLocalSeed` — the same `testMockData` ids/titles the old
// `test-token` path used, so TEST_ISSUE_ID (TEST-6) and the prompt-content
// assertions survive. Flag-specific tests re-seed via the third `options` arg
// (`{ features }`) instead of `/test/set-session?features=`.
//
// One faithful assertion shift: the prompt's tracker reference renders as the
// provider's display name. On the local provider that is "in Local", not "in
// Linear" (applyPromptCapabilities renames `Linear` → `Local`). LIN-3848 removed
// the `linearMcp` switch: that reference is now always present.
// UUID-format issue ID from the seed (TEST-6 = "Task needing preparation", Backlog)
const TEST_ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Feature Toggle Settings', () => {
  test.beforeEach(async ({ seedLocal }) => {
    // Seed a local-backed workspace with default feature flags.
    await seedLocal(workspaceApiLocalSeed);
  });

  test('settings page shows AI and Workflow sections with all toggles', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // AI and Workflow section headers should be visible
    await expect(page.locator('.settings-header:text-is("AI")')).toBeVisible();
    await expect(page.locator('.settings-header:text-is("Workflow")')).toBeVisible();

    // All feature toggle labels should be present (split across sections)
    // LIN-3849: no Dispatch queue or Linear API proxy toggle any more.
    await expect(page.locator('.feature-toggle-label:has-text("Narrative roadmap")')).toBeVisible();
  });

  test('shows correct default toggle states', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Defaults: roadmap OFF
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('○ off');
  });

  // LIN-3848: nine switches that did nothing or were superseded are gone.
  test('settings offers none of the removed switches', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    for (const key of ['linearMcp', 'aiRecommendations', 'promptButtons', 'codeReview', 'codeReviewSelf', 'codeReviewCicd', 'codeReviewPr', 'feedbackTriage', 'observerAuthority']) {
      await expect(page.locator(`[data-feature="${key}"]`)).toHaveCount(0);
    }
    await expect(page.locator('[data-feature="feedbackWidget"]')).toHaveCount(1);
  });

  test('can toggle a feature on and state persists on reload', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // roadmap should start OFF
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('○ off');

    // LIN-3401: the bound click handler must be what saves, not the button's native
    // form submit (which also persists the toggle and would mask a missing handler).
    // Prove the AJAX path ran: an XHR-flagged POST, and no main-frame navigation.
    let navigated = false;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true; });
    const ajaxPost = page.waitForRequest((r) =>
      r.method() === 'POST' && r.headers()['x-requested-with'] === 'XMLHttpRequest' && /\/settings\//.test(r.url())
    );

    // Click the toggle button to turn it on (AJAX — no page reload)
    await page.locator('[data-feature="roadmap"] .toggle-btn').click();
    await ajaxPost;

    // Should update inline via AJAX
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('● on');
    expect(navigated, 'the toggle saved in place, not by a full-page form submit').toBe(false);

    // Reload page — state should persist (stored in session)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('● on');
  });

  test('toggling one feature does not affect others', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Turn on roadmap (AJAX — no page reload)
    await page.locator('[data-feature="roadmap"] .toggle-btn').click();

    // roadmap should be on, but others unchanged
    await expect(page.locator('[data-feature="roadmap"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="feedbackWidget"] .toggle-state')).toHaveText('○ off');
  });

  // =========================================================================
  // LIN-3848: tracker wording is always on (the linearMcp switch is gone)
  // =========================================================================

  test('prompts include tracker references, even with a stale linearMcp:false', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // The tracker reference renders with the provider's display name — "in Local"
    // on the local provider (was "in Linear" on Linear). A stale stored
    // `linearMcp: false` is ignored.
    for (const features of [undefined, { linearMcp: false }]) {
      if (features) await seedLocal(workspaceApiLocalSeed, { features });
      const response = await page.request.get(
        `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/look-into`
      );
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.prompt).toContain('in Local');
    }
  });

  // =========================================================================
  // LIN-3296: the featureBranches toggle is gone. Its git block only ever
  // reached plan, which must not branch or open a PR; implementation carries
  // its own branch and PR steps.
  // =========================================================================

  test('settings no longer offers a feature branch toggle', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.settings-header:text-is("Workflow")')).toBeVisible();
    await expect(page.locator('[data-feature="featureBranches"]')).toHaveCount(0);
    await expect(page.locator('.feature-toggle-label:has-text("Feature branch workflow")')).toHaveCount(0);
  });

  test('plan prompt has no git workflow', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('Git Workflow');
    expect(data.prompt).not.toMatch(/create a pull request/i);
  });

  // =========================================================================
  // LIN-170: Dispatch toggle affects UI visibility
  // =========================================================================

  test('dispatch UI is hidden when the workspace has no way to run (LIN-3849)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // No runner key and no queue token: no run controls, whoever the viewer is.
    await seedLocal(workspaceApiLocalSeed, { runnerKey: false });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Queue badge should not be in the DOM
    await expect(page.locator('[data-queue-badge]')).toHaveCount(0);

    // Dispatch buttons on prompts should not exist
    await expect(page.locator('.dispatch-btn')).toHaveCount(0);
  });

  test('dispatch UI is visible for the owner of a workspace with a runner key', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { runnerKey: true });

    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Queue badge should exist (hidden class applied by JS when count is 0, but element exists)
    await expect(page.locator('[data-queue-badge]')).toHaveCount(1);
  });

  test('dispatch section hidden in settings (LIN-3849: no dispatch switch at all)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Dispatch section should not be visible
    await expect(page.locator('.settings-header:text-is("Dispatch")')).toHaveCount(0);
  });

  test('dispatch link visible in header switcher with run controls', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { runnerKey: true });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // The dispatch link lives in the header view switcher (LIN-978), gated on run controls (LIN-3849).
    await expect(page.locator('.nav-views [data-testid="nav-view-dispatch"]')).toBeVisible();
  });

  test('Settings carries neither a Dispatch queue nor a Linear API proxy switch (LIN-3849)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-feature="dispatch"]')).toHaveCount(0);
    await expect(page.locator('[data-feature="proxy"]')).toHaveCount(0);
    await expect(page.locator('.feature-toggle-label:has-text("Linear API proxy")')).toHaveCount(0);
    await expect(page.locator('.feature-toggle-label:has-text("Dispatch queue")')).toHaveCount(0);
  });

  test('prompts section is always visible (LIN-3848: promptButtons switch removed)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    await page.locator('.in-progress-items .line.expandable').first().click();
    await page.locator('.in-progress-items .detail-toggle[data-toggle="prompts"]').first().click();
    const component = page.locator('.in-progress-items .prompt-section').first();
    await expect(component).toBeVisible();
    await expect(component.locator('[data-testid="other-prompts"]')).toBeVisible();
  });

  test('the ✦ primary is always shown (LIN-3848: aiRecommendations switch removed)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    await page.locator('.in-progress-items .line.expandable').first().click();
    await page.locator('.in-progress-items .detail-toggle[data-toggle="prompts"]').first().click();
    const go = page.locator('.in-progress-items .prompt-section [data-testid="opened-task-next-step"]').first();
    await expect(go).toBeVisible();
  });

  // LIN-3848: no prompt carries review sections any more, whatever stale
  // codeReview* values a saved preference still holds.
  test('prompts exclude code review sections by default', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(
      `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/plan`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompt).not.toContain('Self-Review');
    expect(data.prompt).not.toContain('CI/CD Check');
    expect(data.prompt).not.toContain('PR Review');
  });

  test('implementation and review prompts have no review sections, even with stale codeReview* flags', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { features: { codeReview: true, codeReviewCicd: true, codeReviewPr: true } });

    for (const kind of ['plan', 'implementation', 'review']) {
      const response = await page.request.get(
        `/workspace/${localWorkerUrlKey}/api/prompt/${TEST_ISSUE_ID}/${kind}`
      );
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.prompt).not.toContain('## Self-Review');
      expect(data.prompt).not.toContain('## CI/CD Check');
      expect(data.prompt).not.toContain('## PR Review');
    }
  });

  // =========================================================================
  // LIN-193: Proxy toggle affects UI visibility
  // =========================================================================

  test('proxy header nav link is always visible (LIN-3849)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, {});

    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // The proxy link lives in the header view switcher (LIN-978). LIN-3849: it is a
    // key tool, so it is always there (it was gated on a per-user flag).
    await expect(page.locator('.nav-views [data-testid="nav-view-proxy"]')).toBeVisible();
  });

  test('proxy page loads with no flag set (LIN-3849)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, {});

    await page.goto(`/workspace/${localWorkerUrlKey}/proxy`);
    await page.waitForLoadState('networkidle');

    // Should stay on proxy page, not redirect
    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/proxy`));
  });

  // =========================================================================
  // Proxy toggle button in prompt UI
  // =========================================================================

  test('proxy toggle button rendered in the opened-task component when proxy feature is on', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, {});

    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Expand an in-progress issue and open its Prompts section (the shared
    // component mounts there), then pick a default template so the action cluster
    // — which owns the +proxy toggle — renders.
    await page.locator('.in-progress-items .line.expandable').first().click();
    await page.locator('.in-progress-items .detail-toggle[data-toggle="prompts"]').first().click();
    const component = page.locator('.in-progress-items .prompt-section').first();
    await expect(component).toBeVisible();
    await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn').first().click();
    await expect(component).toHaveAttribute('data-phase', 'fresh');
    await expect(component.locator('.prompt-proxy-toggle')).toBeAttached();
  });

  test('proxy toggle button appears on dispatch page for the owner (LIN-3849)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { runnerKey: true });

    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`);
    await page.waitForLoadState('networkidle');

    // The +proxy toggle lives inside the Dispatch options disclosure panel;
    // expand it so the button is visible.
    await page.locator('.dispatch-toggle').click();
    await expect(page.locator('.prompt-proxy-toggle')).toBeVisible();
  });

  // =========================================================================
  // Validation
  // =========================================================================

  test('feature toggles API rejects invalid feature key', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.post(
      `/workspace/${localWorkerUrlKey}/settings/features`,
      {
        form: { feature: 'invalidFeature', enabled: 'true' }
      }
    );
    // Should redirect with error (or return 400 for API)
    expect(response.status()).toBe(400);
  });
});
