/**
 * E2E tests for the Dispatch defaults settings UI + write path (LIN-1095).
 *
 * Proves the cross-module contract HTTP handler → WorkspacePreferencesStore →
 * settings render end-to-end: the new section is a sibling of the AI section
 * (not nested), the workspace-wide row and per-prompt-type override rows
 * persist independently via read-merge-write, and invalid fields are rejected
 * without clobbering the rest of workspace preferences (LIN-1094's
 * `dispatchDefaults` storage shape).
 */
import { test, expect } from '../fixtures/test-base.js';

test.describe('Dispatch defaults settings', () => {
  test.beforeEach(async ({ request, seedLocal, localWorkerUrlKey }) => {
    // Clean slate: delete the whole workspace-prefs doc (no modelId = delete).
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
    await seedLocal();
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows the Dispatch defaults section as a sibling of AI, with a row per live prompt type', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const section = page.locator('[data-testid="settings-section-dispatch-defaults"]');
    await expect(section).toBeVisible();
    await expect(section.locator('.settings-header')).toHaveText('Dispatch defaults');

    // Sibling of the AI section, not nested inside it.
    const aiSection = page.locator('.settings-section', { has: page.locator('.settings-header:text-is("AI")') });
    await expect(aiSection.locator('[data-testid="settings-section-dispatch-defaults"]')).toHaveCount(0);

    // Workspace-wide row is visible up front; per-kind rows (bug is easy to
    // miss — LIN-1094/this ticket's own count correction — and close-out is
    // the newest kind) live behind the collapsed progressive-disclosure
    // toggle (LIN-1111), so expand it first.
    await expect(section.locator('[data-testid="dispatch-default-row-default"]')).toBeVisible();
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    await expect(section.locator('[data-testid="dispatch-default-row-bug"]')).toBeVisible();
    await expect(section.locator('[data-testid="dispatch-default-row-implementation"]')).toBeVisible();
    await expect(section.locator('[data-testid="dispatch-default-row-close-out"]')).toBeVisible();
  });

  test('the 15 per-kind rows are collapsed behind a closed toggle until expanded (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const details = page.locator('details.dispatch-kind-overrides');
    const bugRow = page.locator('[data-testid="dispatch-default-row-bug"]');
    await expect(details).not.toHaveJSProperty('open', true);
    await expect(bugRow).not.toBeVisible();

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    await expect(details).toHaveJSProperty('open', true);
    await expect(bugRow).toBeVisible();
  });

  test('model inputs offer recommended suggestions via a shared datalist (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const datalist = page.locator('#dispatch-model-suggestions');
    await expect(datalist).toHaveCount(1);
    await expect(datalist.locator('option')).not.toHaveCount(0);
    await expect(page.locator('input[name="defaultModel"]')).toHaveAttribute('list', 'dispatch-model-suggestions');
  });

  test('saving the workspace-wide default persists across reloads', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="defaultModel"]', 'anthropic/claude-opus-4.8');
    await page.selectOption('select[name="defaultHarnessSelect"]', 'opencode');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('opencode');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('opencode');
  });

  test('saving a per-prompt-type override persists independently of the workspace-wide default', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Per-kind rows live behind the collapsed progressive-disclosure toggle
    // (LIN-1111) until expanded.
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await row.locator('input.dispatch-model-input').fill('anthropic/claude-sonnet-5');
    await row.locator('input.harness-input').fill('my-custom-harness');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    const savedRow = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(savedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(savedRow.locator('input.harness-input')).toHaveValue('my-custom-harness');

    // Workspace-wide default row stays untouched.
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedRow = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(reloadedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(reloadedRow.locator('input.harness-input')).toHaveValue('my-custom-harness');
  });

  test('the workspace-wide harness select pre-selects claude-code when unconfigured (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('per-kind override rows leave their harness select blank (inherit) even though the workspace-wide row pre-selects claude-code (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(row.locator('select.harness-select')).toHaveValue('');
  });

  test('saving a per-kind-only change also persists the pre-selected claude-code workspace default (LIN-1111, expected consequence of the shared form)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await row.locator('input.dispatch-model-input').fill('anthropic/claude-sonnet-5');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('rejects an oversized field and does not persist it', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;
    const res = await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { defaultModel: 'a'.repeat(1001) },
      maxRedirects: 0
    });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'];
    expect(location).toContain('dispatchDefaultsError=invalid-field');

    // Follow the actual redirect target (carries the error query param) rather
    // than a bare reload, which would drop it.
    await page.goto(location);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('');
    await expect(page.locator('[data-testid="settings-section-dispatch-defaults"] .settings-value.error')).toContainText('1000 characters or less');
  });

  test('read-merge-write does not clobber workspace features or the AI model preference', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;

    await page.request.post(`${settingsUrl}/workspace-features`, {
      form: { feature: 'periodicals', enabled: 'true' }
    });
    await page.request.post(`${settingsUrl}/model`, {
      form: { modelId: 'anthropic/claude-opus-4.8' }
    });
    await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { defaultModel: 'anthropic/claude-sonnet-5', defaultHarnessSelect: 'claude-code' }
    });

    await page.goto(settingsUrl);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('.model-id')).toHaveText('anthropic/claude-opus-4.8');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('ignores a byKind key that is not a live PROMPT_TEMPLATES kind', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;
    // Nothing in the rendered form can produce this — a live PROMPT_TEMPLATES
    // row is the only per-kind field the POST handler ever reads — but prove
    // the write path drops an unrelated posted field defensively rather than
    // erroring.
    const res = await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { 'kind__not-a-real-kind__Model': 'should-never-be-read', defaultModel: 'anthropic/claude-opus-4.8' }
    });
    expect(res.ok()).toBeTruthy();

    await page.goto(settingsUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
  });
});
