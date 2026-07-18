/**
 * E2E tests for the Dispatch presets Settings CRUD UI (LIN-1391 S7).
 *
 * A sibling of dispatch-defaults.spec.js: proves the cross-module contract
 * public/settings.js → routes/dispatch.js CRUD API → DispatchPresetsStore →
 * settings render, end-to-end — the section is a sibling of Dispatch defaults
 * (not nested), create/edit/delete round-trip and persist across reloads, and
 * a blank config value on a preset row never gets pre-selected as an explicit
 * harness (LIN-1111's hazard applies to preset rows too).
 *
 * Routing/precedence (which harness/model an actual dispatch resolves to when
 * a preset is selected) is LIN-1390's job, not re-verified here — see
 * dispatch-route-presets.test.js / dispatch-factory.test.js for that.
 */
import { test, expect } from '../fixtures/test-base.js';

test.describe('Dispatch presets settings UI', () => {
  test.beforeEach(async ({ request, seedLocal, localWorkerUrlKey }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${localWorkerUrlKey}`);
    await seedLocal();
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows the Dispatch presets section as a sibling of Dispatch defaults', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const section = page.locator('[data-testid="settings-section-dispatch-presets"]');
    await expect(section).toBeVisible();
    await expect(section.locator('.settings-header')).toHaveText('Dispatch presets');

    // Sibling of Dispatch defaults, not nested inside it.
    const defaultsSection = page.locator('[data-testid="settings-section-dispatch-defaults"]');
    await expect(defaultsSection.locator('[data-testid="settings-section-dispatch-presets"]')).toHaveCount(0);
  });

  test('shows an empty state with no saved presets', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();
  });

  test('creating a preset persists it and clears the empty state', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await createForm.locator('.dispatch-preset-name-input').fill('My Claude preset');
    await createForm.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');
    await createForm.locator('.dispatch-preset-toplevel-config input.dispatch-model-input').fill('anthropic/claude-opus-4.8');
    await page.locator('.dispatch-preset-create-btn').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toHaveCount(0);
    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="My Claude preset"]') });
    await expect(item).toBeVisible();
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(item.locator('.dispatch-preset-toplevel-config input.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');

    // Survives a reload — a real persisted write, not just DOM state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedItem = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="My Claude preset"]') });
    await expect(reloadedItem).toBeVisible();
    await expect(reloadedItem.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
  });

  test('creating a preset leaves an untouched harness select truly blank (not pre-selected)', async ({ page, localWorkerUrlKey }) => {
    // LIN-1111's hazard: renderDispatchDefaultRow pre-selects claude-code for
    // SOME rows (the dispatch-defaults workspace-wide row); a preset's new-row
    // must stay preselectDefault:false so an untouched blank harness really
    // means "not set by this preset", never an implicit claude-code override.
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await expect(createForm.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('');
    await createForm.locator('.dispatch-preset-name-input').fill('Blank config preset');
    await page.locator('.dispatch-preset-create-btn').click();
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blank config preset"]') });
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('');
    await expect(item.locator('.dispatch-preset-toplevel-config input.dispatch-model-input')).toHaveValue('');
  });

  test('editing a preset persists the change', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Editable preset', config: { harness: 'opencode' } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Editable preset"]') });
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('opencode');

    await item.locator('.dispatch-preset-name-input').fill('Renamed preset');
    await item.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');
    await item.locator('.dispatch-preset-toplevel-config input.dispatch-model-input').fill('opus');
    await item.locator('.dispatch-preset-save-btn').click();
    await page.waitForLoadState('networkidle');

    const renamed = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Renamed preset"]') });
    await expect(renamed).toBeVisible();
    await expect(renamed.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(renamed.locator('.dispatch-preset-toplevel-config input.dispatch-model-input')).toHaveValue('opus');
    // The old name is gone — this was an in-place update, not a second preset.
    await expect(page.locator('.dispatch-preset-name-input[value="Editable preset"]')).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.dispatch-preset-name-input[value="Renamed preset"]')).toHaveCount(1);
  });

  test('deleting a preset removes it and restores the empty state', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'To be deleted', config: { model: 'anthropic/claude-opus-4.8' } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="To be deleted"]') });
    await expect(item).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await item.locator('.dispatch-preset-delete-btn').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.dispatch-preset-name-input[value="To be deleted"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();
  });

  test('creating a blend preset via the per-kind editor persists per-kind overrides (LIN-1400)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await createForm.locator('.dispatch-preset-name-input').fill('Blend preset');
    await createForm.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');

    await createForm.locator('[data-testid="dispatch-preset-new-row-kind-overrides"]').locator('summary').click();
    const reviewRow = createForm.locator('[data-testid="dispatch-preset-new-row-kind-review"]');
    await reviewRow.locator('select.harness-select').selectOption('opencode');
    await reviewRow.locator('input.dispatch-model-input').fill('anthropic/claude-opus-4.8');

    await page.locator('.dispatch-preset-create-btn').click();
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blend preset"]') });
    await expect(item).toBeVisible();
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    const itemReviewRow = item.locator('[data-testid$="-kind-review"]');
    await expect(itemReviewRow.locator('select.harness-select')).toHaveValue('opencode');
    await expect(itemReviewRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');

    // Survives a reload — a real persisted write, not just DOM state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedItem = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blend preset"]') });
    const reloadedReviewRow = reloadedItem.locator('[data-testid$="-kind-review"]');
    await expect(reloadedReviewRow.locator('select.harness-select')).toHaveValue('opencode');
    await expect(reloadedReviewRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');
  });

  test('editing one kind of a blend preset changes only that kind', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: {
        name: 'Two-kind blend',
        config: { byKind: { review: { model: 'opus' }, implementation: { model: 'sonnet' } } }
      }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Two-kind blend"]') });
    const reviewRow = item.locator('[data-testid$="-kind-review"]');
    await reviewRow.locator('input.dispatch-model-input').fill('opus-updated');
    await item.locator('.dispatch-preset-save-btn').click();
    await page.waitForLoadState('networkidle');

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Two-kind blend"]') });
    await expect(saved.locator('[data-testid$="-kind-review"] input.dispatch-model-input')).toHaveValue('opus-updated');
    await expect(saved.locator('[data-testid$="-kind-implementation"] input.dispatch-model-input')).toHaveValue('sonnet');
  });

  test('clearing a blend preset\'s per-kind override removes it on save', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Clearable blend', config: { byKind: { review: { model: 'opus' } } } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    const reviewRow = item.locator('[data-testid$="-kind-review"]');
    await expect(reviewRow.locator('input.dispatch-model-input')).toHaveValue('opus');
    await reviewRow.locator('input.dispatch-model-input').fill('');
    await item.locator('.dispatch-preset-save-btn').click();
    await page.waitForLoadState('networkidle');

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    await expect(saved.locator('[data-testid$="-kind-review"] input.dispatch-model-input')).toHaveValue('');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloaded = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    await expect(reloaded.locator('[data-testid$="-kind-review"] input.dispatch-model-input')).toHaveValue('');
  });

  test('a top-level-only preset edited without opening the per-kind block keeps its top-level config', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Top-level only', config: { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Top-level only"]') });
    // Never open the per-kind <details> — save with it untouched/collapsed.
    await item.locator('.dispatch-preset-save-btn').click();
    await page.waitForLoadState('networkidle');

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Top-level only"]') });
    await expect(saved.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(saved.locator('.dispatch-preset-toplevel-config input.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');
  });

  test('lists multiple presets independently', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Preset A', config: { harness: 'claude-code' } } });
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Preset B', config: { harness: 'opencode' } } });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.dispatch-preset-item')).toHaveCount(2);
    const a = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Preset A"]') });
    const b = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Preset B"]') });
    await expect(a.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(b.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('opencode');
  });
});
