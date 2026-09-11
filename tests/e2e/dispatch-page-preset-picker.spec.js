/**
 * E2E tests for the Dispatch page preset picker (LIN-1391 S9).
 *
 * A sibling of dispatch-page.spec.js's "Model/Harness Exec Controls" block:
 * proves the picker actually puts `presetId` on the wire when dispatching a
 * custom prompt — the one thing only a browser proves. Routing/precedence
 * (what a selected preset resolves model/harness TO) is LIN-1390's job, not
 * re-verified here; see dispatch-route-presets.test.js / dispatch-factory.test.js.
 *
 * Mirrors the fixture/setup shape of dispatch-page.spec.js exactly (same
 * per-worker WS/DISPATCH_URL binding, same REPO_SEED) so it composes cleanly
 * as a sibling spec rather than duplicating unrelated page-access coverage.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';

let WS, DISPATCH_URL, API_PREFIX;

const REPO_SEED = {
  projects: [
    { id: 'local-proj-1', name: 'Project Alpha', content: 'repo=test-repo', sortOrder: 1 },
  ],
  issues: [],
};

test.describe('Dispatch page preset picker (LIN-1391 S9)', () => {
  test.beforeEach(async ({ localWorkerUrlKey, request }) => {
    WS = localWorkerUrlKey;
    DISPATCH_URL = `/workspace/${WS}/dispatch`;
    API_PREFIX = `/workspace/${WS}`;
    await request.get(`/test/clear-dispatch-presets?urlKey=${WS}`);
    // The reflection test (LIN-2719 S4) asserts the exec controls stay on
    // their own claude-code default — reset dispatchDefaults too, or a
    // workspace-wide default persisted by another spec sharing this
    // per-worker urlKey (e.g. dispatch-page.spec.js's HARD RULE 4 test)
    // leaks in here.
    await request.get(`/test/set-workspace-model?urlKey=${WS}`);
  });

  test.afterEach(async ({ request }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${WS}`);
    await request.get(`/test/set-workspace-model?urlKey=${WS}`);
  });

  test('the picker renders "— none —" plus one option per saved preset', async ({ page, request }) => {
    await request.post(`/test/seed-dispatch-preset?urlKey=${WS}`, { data: { name: 'Alpha preset', config: { harness: 'claude-code' } } });
    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    const select = page.locator('.dispatch-preset-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.locator('option[value=""]')).toHaveCount(1);
    const presetOption = select.locator('option', { hasText: 'Alpha preset' });
    await expect(presetOption).toHaveCount(1);
  });

  // LIN-2719 S3: nothing on this page said where a preset comes from — an
  // empty picker links to Settings. loadDispatchPresetPicker's fetch is
  // on401:false and non-fatal (`tests/helpers` precedent), so an empty list
  // and a failed fetch collapse to the SAME `presets = []` branch — both
  // cases are exercised here.
  test('an empty preset list links to Settings to create one', async ({ page }) => {
    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    const select = page.locator('.dispatch-preset-select');
    await expect(select.locator('option')).toHaveCount(1);
    const createLink = page.getByTestId('dispatch-preset-create-link');
    await expect(createLink).toBeVisible();
    await expect(createLink).toHaveAttribute('href', `/workspace/${WS}/settings#dispatch-presets`);
  });

  test('a failed presets fetch degrades to the same empty-picker "create a preset" link', async ({ page }) => {
    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.route(`**/workspace/${WS}/api/dispatch/presets`, route => route.abort());
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    const select = page.locator('.dispatch-preset-select');
    await expect(select.locator('option')).toHaveCount(1);
    await expect(page.getByTestId('dispatch-preset-create-link')).toBeVisible();
  });

  // LIN-2719 S4: a chosen preset shows a read-only reflection of what will
  // run, WITHOUT filling the authorable exec-controls inputs (the deviation
  // note — filling them would post explicit values that outrank the preset).
  test('selecting a preset shows a read-only reflection without filling the exec controls', async ({ page, request }) => {
    const createRes = await request.post(`/test/seed-dispatch-preset?urlKey=${WS}`, {
      data: { name: 'Reflection preset', config: { harness: 'opencode', model: 'anthropic/claude-opus-4.8', effort: 'high' } }
    });
    const preset = await createRes.json();

    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    const reflection = page.getByTestId('dispatch-preset-reflection');
    await expect(reflection).toHaveText('');

    await page.locator('.dispatch-preset-select').selectOption(preset.id ?? preset._id);
    await expect(reflection).toContainText('opencode');
    await expect(reflection).toContainText('anthropic/claude-opus-4.8');
    await expect(reflection).toContainText('high');

    // The reflection is read-only — the exec-controls model/harness selects
    // stay on their own blank defaults, never filled from the preset.
    const controls = page.locator('.dispatch-exec-controls');
    await expect(controls.locator('.dispatch-exec-harness-select')).toHaveValue('claude-code');
    await expect(controls.locator('.dispatch-exec-model')).toHaveValue('');

    // Switching back to "— none —" clears the reflection.
    await page.locator('.dispatch-preset-select').selectOption('');
    await expect(reflection).toHaveText('');
  });

  // Deep link from Settings' "use on Dispatch" affordance (LIN-2719 S3):
  // ?preset=<id> pre-selects the picker (and its reflection), never the
  // authorable exec-controls inputs.
  test('?preset=<id> pre-selects the picker from a deep link', async ({ page, request }) => {
    const createRes = await request.post(`/test/seed-dispatch-preset?urlKey=${WS}`, {
      data: { name: 'Deep link preset', config: { harness: 'opencode' } }
    });
    const preset = await createRes.json();
    const presetId = preset.id ?? preset._id;

    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(`${DISPATCH_URL}?preset=${presetId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    await expect(page.locator('.dispatch-preset-select')).toHaveValue(presetId);
    await expect(page.getByTestId('dispatch-preset-reflection')).toContainText('opencode');
  });

  test('leaving the picker on "— none —" sends no presetId at all', async ({ page }) => {
    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    await page.locator('.dispatch-prompt-input').fill('No preset selected test');
    const [request] = await Promise.all([
      page.waitForRequest(req => req.method() === 'POST' && req.url().includes(`${API_PREFIX}/api/dispatch`)),
      page.locator('.dispatch-prompt-send[data-target="cli"]').click()
    ]);
    const body = request.postDataJSON();
    expect(body.presetId).toBeUndefined();
  });

  test('selecting a saved preset puts its id on the wire as presetId', async ({ page, request }) => {
    const createRes = await request.post(`/test/seed-dispatch-preset?urlKey=${WS}`, {
      data: { name: 'Wire test preset', config: { model: 'anthropic/claude-opus-4.8' } }
    });
    const preset = await createRes.json();

    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    await page.locator('.dispatch-prompt-input').fill('Preset picker wire test')
    await page.locator('.dispatch-preset-select').selectOption(preset.id ?? preset._id)

    const [request2] = await Promise.all([
      page.waitForRequest(req => req.method() === 'POST' && req.url().includes(`${API_PREFIX}/api/dispatch`)),
      page.locator('.dispatch-prompt-send[data-target="cli"]').click()
    ]);
    const body = request2.postDataJSON();
    expect(body.presetId).toBe(preset.id ?? preset._id);
    expect(body.prompt).toBe('Preset picker wire test');
  });

  test('switching the picker back to "— none —" after selecting a preset omits presetId again', async ({ page, request }) => {
    const createRes = await request.post(`/test/seed-dispatch-preset?urlKey=${WS}`, {
      data: { name: 'Toggle back preset', config: { harness: 'opencode' } }
    });
    const preset = await createRes.json();

    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey: WS });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    await page.locator('.dispatch-preset-select').selectOption(preset.id ?? preset._id)
    await page.locator('.dispatch-preset-select').selectOption('')
    await page.locator('.dispatch-prompt-input').fill('Toggled back to none test')

    const [request2] = await Promise.all([
      page.waitForRequest(req => req.method() === 'POST' && req.url().includes(`${API_PREFIX}/api/dispatch`)),
      page.locator('.dispatch-prompt-send[data-target="cli"]').click()
    ]);
    const body = request2.postDataJSON();
    expect(body.presetId).toBeUndefined();
  });
});

// LIN-2719 S5 — the acceptance journey at phone width: choose a free model,
// save a preset, dispatch with it. Two thirds of this already pass at desktop
// width (presetId-on-wire above); this extends to 375px and the free-model
// step, which S1's widened MOCK_CATALOG_MODELS fixture is what makes
// observable under test at all.
test.describe('375px acceptance journey (LIN-2719 S5)', () => {
  test('choose a free model, save a preset, dispatch with it — presetId on the wire and the resolved model match', async ({ page, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    await page.setViewportSize({ width: 375, height: 812 });
    await seedLocalWorkspace(page, REPO_SEED, { features: { dispatch: true }, urlKey });
    await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
    await page.request.get(`/test/clear-dispatch-presets?urlKey=${urlKey}`);

    // 1. Choose a free model on Settings, at 375px, and save it as a preset —
    // the datalist this ticket was filed against had no usable dropdown here.
    await page.goto(`/workspace/${urlKey}/settings`);
    await page.waitForLoadState('networkidle');
    const createForm = page.locator('[data-testid="dispatch-preset-create-form"]');
    await createForm.locator('.dispatch-preset-name-input').fill('375px free preset');
    await createForm.locator('.dispatch-preset-toplevel-config select.harness-select').selectOption('opencode');
    const modelSelect = createForm.locator('.dispatch-preset-toplevel-config select.dispatch-model-input');
    await expect(modelSelect.locator('option[value="mock-provider/catalog-model-one"][data-free="true"]')).toHaveCount(1);
    await modelSelect.selectOption('mock-provider/catalog-model-one');
    await page.locator('.dispatch-preset-create-btn').click();
    await page.waitForLoadState('networkidle');

    const item = page.locator('.dispatch-preset-item', { has: page.locator('.dispatch-preset-name-input[value="375px free preset"]') });
    await expect(item).toBeVisible();

    // 2. Dispatch with it, on the Dispatch page, still at 375px.
    await page.goto(`/workspace/${urlKey}/dispatch`);
    await page.waitForLoadState('networkidle');
    await page.locator('.dispatch-toggle').click();

    const presetSelect = page.locator('.dispatch-preset-select');
    await expect(presetSelect).toBeVisible();
    const presetOption = presetSelect.locator('option', { hasText: '375px free preset' });
    const presetId = await presetOption.getAttribute('value');
    await page.locator('.dispatch-prompt-input').fill('375px acceptance journey');
    // The exec-controls harness pre-selects claude-code by default (LIN-1111);
    // this preset's config is scoped to opencode, and dispatch-factory.js's
    // row-atomic eligibility (LIN-1694) skips a config row scoped to a
    // different harness than the one in force. Blank it explicitly so the
    // preset's harness+model both apply — the deviation note's point exactly:
    // the exec controls stay authorable and the user, not this reflection,
    // decides whether they align with the chosen preset.
    await page.locator('.dispatch-exec-harness-select').selectOption('');
    await presetSelect.selectOption(presetId);
    // S4: the read-only reflection shows what will run before dispatching.
    await expect(page.getByTestId('dispatch-preset-reflection')).toContainText('mock-provider/catalog-model-one');

    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    const [response] = await Promise.all([
      page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith(`/workspace/${urlKey}/api/dispatch`)),
      dispatchBtn.click()
    ]);
    const body = response.request().postDataJSON();
    expect(body.presetId).toBe(presetId);
    // The POST has fully round-tripped (response received) before querying
    // the list below — waitForRequest alone only proves the request fired,
    // not that the write landed.
    await expect(dispatchBtn).toHaveText('dispatched!');

    // 3. The queued item's RESOLVED model is the one chosen — assert `model`,
    // never `presetName` (LIN-2719 S5: presetName is stamped only on
    // kind:'autopilot' rows, so a custom-prompt dispatch's queued row never
    // names its preset).
    const listResponse = await page.request.get(`/workspace/${urlKey}/api/dispatch`);
    const { items } = await listResponse.json();
    const queued = items.find(i => i.prompt === '375px acceptance journey');
    expect(queued).toBeDefined();
    expect(queued.model).toBe('mock-provider/catalog-model-one');

    await page.request.get(`/test/clear-dispatch-presets?urlKey=${urlKey}`);
  });
});
