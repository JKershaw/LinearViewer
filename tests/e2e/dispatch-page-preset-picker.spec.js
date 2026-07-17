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
  });

  test.afterEach(async ({ request }) => {
    await request.get(`/test/clear-dispatch-presets?urlKey=${WS}`);
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
