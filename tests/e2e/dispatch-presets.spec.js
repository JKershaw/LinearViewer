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
import { SELECTORS } from '../helpers.js';

// LIN-3198: the preset create/save/delete handlers await a fetch, then call
// window.location.reload() (public/settings.js). A bare
// `waitForLoadState('networkidle')` races that navigation: it can resolve
// against the pre-reload page's quiet moment and then the reload wipes the DOM
// the assertion is about to read (the observed 1/20 cross-spec flake). Arm the
// `load` listener BEFORE the click so the app-triggered navigation can never
// fire unseen, then click and await it. `networkidle` stays after plain
// `goto`/`reload`, where no app-triggered navigation is in flight.
async function clickAndAwaitReload(page, locator) {
  const loaded = page.waitForEvent('load');
  await locator.click();
  await loaded;
}

test.describe('Dispatch presets settings UI', () => {
  test.beforeEach(async ({ request, seedLocal, localWorkerUrlKey }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${localWorkerUrlKey}`);
    await seedLocal();
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows the Dispatch presets section beside the Models body, at its anchor (LIN-3855)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const section = page.locator('[data-testid="settings-section-dispatch-presets"]');
    await expect(section).toBeVisible();
    await expect(section.locator(SELECTORS.settings.groupTitle('dispatch-presets'))).toHaveText('Dispatch presets');
    await expect(page.locator('#dispatch-presets')).toBeVisible();
    // Not nested inside the Models form: its fields never post with the staged save.
    await expect(page.locator('[data-testid="models-changes-form"] [data-testid="settings-section-dispatch-presets"]')).toHaveCount(0);
  });

  test('shows an empty state with no saved presets', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();
  });

  test('creating a preset persists it and clears the empty state', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await createForm.locator('.dispatch-preset-name-input').fill('My Claude preset');
    await createForm.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');
    // A curated OpenCode id on a claude-code row isn't in that row's
    // preset-only option set, so it's the escape hatch (HARD RULE 2/3).
    await createForm.locator('.dispatch-preset-toplevel-config select.dispatch-model-input').selectOption('__other__');
    await createForm.locator('.dispatch-preset-toplevel-config .dispatch-model-input-other').fill('anthropic/claude-opus-4.8');
    await clickAndAwaitReload(page, page.locator('.dispatch-preset-create-btn'));

    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toHaveCount(0);
    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="My Claude preset"]') });
    await expect(item).toBeVisible();
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input')).toHaveValue('__other__');
    await expect(item.locator('.dispatch-preset-toplevel-config .dispatch-model-input-other')).toHaveValue('anthropic/claude-opus-4.8');

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
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await expect(createForm.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('');
    // LIN-2616: effort is a plain opaque text input (like model), never a
    // pre-selectable enum — but it must still be genuinely blank on an
    // untouched new-preset row, the same invariant harness proves above.
    await expect(createForm.locator('.dispatch-preset-toplevel-config input.dispatch-effort-input')).toHaveValue('');
    await createForm.locator('.dispatch-preset-name-input').fill('Blank config preset');
    await clickAndAwaitReload(page, page.locator('.dispatch-preset-create-btn'));

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blank config preset"]') });
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('');
    await expect(item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input')).toHaveValue('');
    await expect(item.locator('.dispatch-preset-toplevel-config input.dispatch-effort-input')).toHaveValue('');
  });

  test('editing a preset persists the change', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Editable preset', config: { harness: 'opencode' } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Editable preset"]') });
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('opencode');

    await item.locator('.dispatch-preset-name-input').fill('Renamed preset');
    await item.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');
    await item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input').selectOption('opus');
    await clickAndAwaitReload(page, item.locator('.dispatch-preset-save-btn'));

    const renamed = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Renamed preset"]') });
    await expect(renamed).toBeVisible();
    await expect(renamed.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(renamed.locator('.dispatch-preset-toplevel-config select.dispatch-model-input')).toHaveValue('opus');
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

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="To be deleted"]') });
    await expect(item).toBeVisible();

    // The delete asks in place (LIN-3855): open its panel, then confirm. No native dialog.
    const id = await item.getAttribute('data-preset-id');
    await page.locator(`[data-testid="dispatch-preset-delete-${id}"] > summary`).click();
    await clickAndAwaitReload(page, page.locator(`[data-testid="dispatch-preset-delete-${id}-confirm"]`));

    await expect(page.locator('.dispatch-preset-name-input[value="To be deleted"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="dispatch-presets-empty"]')).toBeVisible();
  });

  test('creating a blend preset via the per-kind editor persists per-kind overrides (LIN-1400)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await createForm.locator('.dispatch-preset-name-input').fill('Blend preset');
    await createForm.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('claude-code');

    await createForm.locator('[data-testid="dispatch-preset-new-row-kind-overrides"]').locator('summary').click();
    const reviewRow = createForm.locator('[data-testid="dispatch-preset-new-row-kind-review"]');
    await reviewRow.locator('select.harness-select').selectOption('opencode');
    await reviewRow.locator('select.dispatch-model-input').selectOption('anthropic/claude-opus-4.8');

    await clickAndAwaitReload(page, page.locator('.dispatch-preset-create-btn'));

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blend preset"]') });
    await expect(item).toBeVisible();
    await expect(item.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    const itemReviewRow = item.locator('[data-testid$="-kind-review"]');
    await expect(itemReviewRow.locator('select.harness-select')).toHaveValue('opencode');
    await expect(itemReviewRow.locator('select.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');

    // Survives a reload — a real persisted write, not just DOM state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedItem = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Blend preset"]') });
    const reloadedReviewRow = reloadedItem.locator('[data-testid$="-kind-review"]');
    await expect(reloadedReviewRow.locator('select.harness-select')).toHaveValue('opencode');
    await expect(reloadedReviewRow.locator('select.dispatch-model-input')).toHaveValue('anthropic/claude-opus-4.8');
  });

  test('editing one kind of a blend preset changes only that kind', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: {
        name: 'Two-kind blend',
        config: { byKind: { review: { model: 'opus' }, implementation: { model: 'sonnet' } } }
      }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Two-kind blend"]') });
    const reviewRow = item.locator('[data-testid$="-kind-review"]');
    // 'opus-updated' isn't a curated/catalog id anywhere — always the escape
    // hatch (HARD RULE 2/3), the client-side round-trip proof plan-review F1
    // required.
    await reviewRow.locator('select.dispatch-model-input').selectOption('__other__');
    await reviewRow.locator('.dispatch-model-input-other').fill('opus-updated');
    await clickAndAwaitReload(page, item.locator('.dispatch-preset-save-btn'));

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Two-kind blend"]') });
    await expect(saved.locator('[data-testid$="-kind-review"] select.dispatch-model-input')).toHaveValue('__other__');
    await expect(saved.locator('[data-testid$="-kind-review"] .dispatch-model-input-other')).toHaveValue('opus-updated');
    // 'sonnet' is a Claude preset id, not curated for OpenCode — this row's
    // harness is unset (blank → OpenCode-effective option set), so it too
    // degrades onto the escape hatch. Untouched by this test, it must still
    // round-trip through the save (HARD RULE 2's silent-deletion hazard).
    await expect(saved.locator('[data-testid$="-kind-implementation"] select.dispatch-model-input')).toHaveValue('__other__');
    await expect(saved.locator('[data-testid$="-kind-implementation"] .dispatch-model-input-other')).toHaveValue('sonnet');
  });

  test('clearing a blend preset\'s per-kind override removes it on save', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Clearable blend', config: { byKind: { review: { model: 'opus' } } } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    const reviewRow = item.locator('[data-testid$="-kind-review"]');
    // 'opus' is a Claude preset id, but this row's harness is unset (blank →
    // OpenCode-effective option set), so the stored value degrades onto the
    // escape hatch (HARD RULE 2/3) rather than being silently dropped.
    await expect(reviewRow.locator('select.dispatch-model-input')).toHaveValue('__other__');
    await expect(reviewRow.locator('.dispatch-model-input-other')).toHaveValue('opus');
    await reviewRow.locator('.dispatch-model-input-other').fill('');
    await clickAndAwaitReload(page, item.locator('.dispatch-preset-save-btn'));

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    await expect(saved.locator('[data-testid$="-kind-review"] select.dispatch-model-input')).toHaveValue('');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloaded = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Clearable blend"]') });
    await expect(reloaded.locator('[data-testid$="-kind-review"] select.dispatch-model-input')).toHaveValue('');
  });

  test('a top-level-only preset edited without opening the per-kind block keeps its top-level config', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Top-level only', config: { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' } }
    });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Top-level only"]') });
    // Never open the per-kind <details> — save with it untouched/collapsed.
    await clickAndAwaitReload(page, item.locator('.dispatch-preset-save-btn'));

    const saved = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Top-level only"]') });
    await expect(saved.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    // A curated OpenCode id on a claude-code row degrades onto the escape
    // hatch (HARD RULE 2/3) — the save-without-opening-the-per-kind-block
    // path must still round-trip it rather than silently dropping it.
    await expect(saved.locator('.dispatch-preset-toplevel-config select.dispatch-model-input')).toHaveValue('__other__');
    await expect(saved.locator('.dispatch-preset-toplevel-config .dispatch-model-input-other')).toHaveValue('anthropic/claude-opus-4.8');
  });

  test('lists multiple presets independently', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Preset A', config: { harness: 'claude-code' } } });
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Preset B', config: { harness: 'opencode' } } });

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.dispatch-preset-item')).toHaveCount(2);
    const a = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Preset A"]') });
    const b = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Preset B"]') });
    await expect(a.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('claude-code');
    await expect(b.locator('.dispatch-preset-toplevel-config select.harness-select')).toHaveValue('opencode');
  });

  // LIN-2719 S3: each saved preset row links to the Dispatch page,
  // pre-selecting itself there (public/dispatch.js reads `?preset=<id>`) —
  // the reverse direction of the Dispatch-page empty-picker "create a
  // preset" link (tests/e2e/dispatch-page-preset-picker.spec.js).
  test('each preset row links to "use on Dispatch"', async ({ page, localWorkerUrlKey, request }) => {
    const createRes = await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, {
      data: { name: 'Use me', config: { harness: 'opencode' } }
    });
    const preset = await createRes.json();
    const presetId = preset.id ?? preset._id;

    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');

    const link = page.getByTestId(`dispatch-preset-use-${presetId}`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/workspace/${localWorkerUrlKey}/dispatch?preset=${presetId}`);
  });

  // LIN-3855: three witnesses moved here from dispatch-defaults.spec.js, which retired with its form. They read
  // the preset rows, which keep the same option sets and the same catalog snapshot.
  test('a preset row swaps its model option set when its harness changes (LIN-1282)', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Swap harness', config: {} } });
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');
    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Swap harness"]') });
    const harness = item.locator('.dispatch-preset-toplevel-config select.harness-select');
    const model = item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input').first();

    await harness.selectOption('claude-code');
    await expect(model.locator('option[value="sonnet"]')).toHaveCount(1);
    await expect(model.locator('option[value^="openai/"]')).toHaveCount(0);

    await harness.selectOption('opencode');
    await expect(model.locator('option[value="openai/gpt-5.5"]')).toHaveCount(1);
  });

  test('a preset row merges the live OpenRouter catalog into its OpenCode option set (LIN-1111 Session 2)', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Catalog merge', config: { harness: 'opencode' } } });
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');
    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Catalog merge"]') });
    const model = item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input').first();
    // The curated list is ten ids; the mocked catalog adds more, and they arrive on the row without a reload.
    const count = await model.locator('option').count();
    expect(count).toBeGreaterThan(12);
  });

  test('a free catalog model on a preset row is marked on its option (LIN-2719)', async ({ page, localWorkerUrlKey, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${localWorkerUrlKey}`, { data: { name: 'Free marker', config: { harness: 'opencode' } } });
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/models`);
    await page.waitForLoadState('networkidle');
    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="Free marker"]') });
    await expect(item.locator('.dispatch-preset-toplevel-config select.dispatch-model-input option[data-free="true"]').first()).toHaveCount(1);
  });
});
