/**
 * E2E tests for the workspace-scoped feature-toggle mechanism (LIN-340).
 *
 * Proves the cross-module contract HTTP handler → WorkspacePreferencesStore →
 * settings render end-to-end, and that the workspace path stays isolated from
 * the per-user feature path.
 */
import { test, expect } from '../fixtures/test-base.js';

test.describe('Workspace feature toggles', () => {
  test.beforeEach(async ({ page, request, seedLocal, localWorkerUrlKey }) => {
    // Clean slate: delete the whole workspace-prefs doc (no modelId = delete),
    // which resets the periodicals override back to its default (off).
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
    await seedLocal();
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows the Workspace features section with periodicals (default off)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.settings-header:has-text("Workspace features")')).toBeVisible();
    await expect(page.locator('.feature-toggle-label:has-text("Periodicals")')).toBeVisible();
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('○ off');

    // periodicals must render exactly once — it is NOT part of the per-user
    // AI/Workflow auto-render loop.
    await expect(page.locator('[data-feature="periodicals"]')).toHaveCount(1);
  });

  test('toggling periodicals on persists to the store across reloads', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('○ off');

    // Toggle on (settings-page toggle client posts via AJAX)
    await page.locator('[data-feature="periodicals"] .toggle-btn').click();
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');

    // Reload — value must come back from WorkspacePreferencesStore, proving it
    // persisted server-side (not just a client-side flip).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');
  });

  test('toggling periodicals off persists across reloads', async ({ page, localWorkerUrlKey }) => {
    // Seed it on directly via the handler (page.request shares the session
    // cookie), then toggle off through the UI.
    await page.request.post(`/workspace/${localWorkerUrlKey}/settings/workspace-features`, {
      form: { feature: 'periodicals', enabled: 'true' }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');

    await page.locator('[data-feature="periodicals"] .toggle-btn').click();
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('○ off');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('○ off');
  });

  test('workspace toggle is isolated — it does not appear in the per-user features sections', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // The periodicals toggle lives only under "Workspace features".
    const periodicalsSection = page.locator('.settings-section', { has: page.locator('[data-feature="periodicals"]') });
    await expect(periodicalsSection.locator('.settings-header')).toHaveText('Workspace features');

    // And the AI / Workflow sections do not render it.
    const aiSection = page.locator('.settings-section', { has: page.locator('.settings-header:text-is("AI")') });
    await expect(aiSection.locator('[data-feature="periodicals"]')).toHaveCount(0);
  });

  test('toggling periodicals does not disturb per-user toggles', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Per-user defaults before the workspace toggle.
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('● on');

    await page.locator('[data-feature="periodicals"] .toggle-btn').click();
    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');

    // Per-user toggle states are untouched by the workspace write.
    await expect(page.locator('[data-feature="linearMcp"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('[data-feature="dispatch"] .toggle-state')).toHaveText('○ off');
  });

  test('handler rejects an invalid workspace feature key', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal();
    const res = await page.request.post(`/workspace/${localWorkerUrlKey}/settings/workspace-features`, {
      form: { feature: 'linearMcp', enabled: 'true' } // a per-user key, not a workspace key
    });
    expect(res.status()).toBe(400);
  });
});
