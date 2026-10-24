/**
 * E2E tests for the workspace-scoped feature-toggle mechanism (LIN-340).
 *
 * Proves the cross-module contract HTTP handler → WorkspacePreferencesStore →
 * settings render end-to-end, and that the workspace path stays isolated from
 * the per-user feature path.
 */
import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';

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

  const RUNNING = (key) => `/workspace/${key}/settings/running`;
  // LIN-3846: periodic reviews affect everyone, so the switch is an in-place ask: open the row,
  // say why, confirm. The state shows in a static row beside it.
  async function turn(page, reason) {
    const row = page.getByTestId('settings-toggle-periodicals');
    await row.locator('summary').click();
    await row.locator('textarea[name="reason"]').fill(reason);
    await row.locator('[data-testid$="-confirm"]').click();
    await page.waitForLoadState('networkidle');
  }
  const state = (page) => page.getByTestId('settings-periodicals-state');

  test('Running shows periodic reviews (default off), once', async ({ page, localWorkerUrlKey }) => {
    await page.goto(RUNNING(localWorkerUrlKey));
    await expect(page.getByTestId('settings-section-workspace-features')).toContainText('For everyone in');
    await expect(state(page)).toContainText('Off');
    await expect(page.getByTestId('settings-toggle-periodicals')).toHaveCount(1);
    await expect(page.getByTestId('settings-section-workspace-features')).toContainText('by hand');
  });

  test('turning periodic reviews on asks why and persists across reloads', async ({ page, localWorkerUrlKey }) => {
    await page.goto(RUNNING(localWorkerUrlKey));
    await turn(page, 'Weekly reviews');
    await expect(state(page)).toContainText('On');
    await page.reload();
    await expect(state(page)).toContainText('On');
  });

  test('turning them off persists across reloads', async ({ page, localWorkerUrlKey }) => {
    await page.request.post(`/workspace/${localWorkerUrlKey}/settings/workspace-features`, {
      form: { feature: 'periodicals', enabled: 'true', reason: 'seed' }
    });
    await page.goto(RUNNING(localWorkerUrlKey));
    await expect(state(page)).toContainText('On');
    await turn(page, 'Not needed');
    await expect(state(page)).toContainText('Off');
    await page.reload();
    await expect(state(page)).toContainText('Off');
  });

  test('the workspace switch is not among the per-user features', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/features`);
    await expect(page.locator('[data-feature="periodicals"]')).toHaveCount(0);
    await expect(page.locator(SELECTORS.settings.switch('roadmap'))).toHaveText('○ off');
  });

  test('the handler rejects an invalid workspace feature key, and a change with no reason', async ({ page, localWorkerUrlKey }) => {
    const bad = await page.request.post(`/workspace/${localWorkerUrlKey}/settings/workspace-features`, {
      form: { feature: 'roadmap', enabled: 'true', reason: 'x' } // a per-user key, not a workspace key
    });
    expect(bad.status()).toBe(400);
    const noReason = await page.request.post(`/workspace/${localWorkerUrlKey}/settings/workspace-features`, {
      form: { feature: 'periodicals', enabled: 'true' }
    });
    expect(noReason.status()).toBe(400);
  });
});
