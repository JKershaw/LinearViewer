/**
 * E2E tests for workspace-scoped AI model selection (LIN-283).
 *
 * The workspace's seeded model must be the model an AI operation resolves.
 * These tests rode the recap until LIN-4537 retired it (and with it every
 * route that echoed the model a generation used, dashboard and proxy alike).
 * The witness is now the recommend operation: GET
 * /workspace/:urlKey/api/recommend/status reports the model from the same
 * `resolveAiOperationModel({ opKind: 'recommend' })` call the recommend routes
 * make before their model call, and it makes no model call itself. The
 * recommend mock path (lib/workspace-api-mocks.js) does not echo a model, so
 * the status read is the surviving no-spend witness.
 *
 * The proxy-path test is gone: no surviving proxy route reports the model it
 * resolved (GET /api/proxy/recommend's live path resolves it but does not
 * return it, and its test-token mock path never resolves one).
 *
 * The tests ride a GENUINE `provider: 'local'` session (LIN-411) seeded from
 * `workspaceApiLocalSeed`, exercising the real workspace-model lookup at the
 * per-worker local urlKey. beforeEach/afterEach reset that workspace's model.
 */
import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

const NON_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';

test.describe('Workspace AI model selection', () => {
  test.beforeEach(async ({ request, localWorkerUrlKey }) => {
    // Each test starts with a clean slate: no workspace model.
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
  });

  test('the recommend operation resolves the seeded workspace model', async ({ page, request, seedLocal, localWorkerUrlKey }) => {
    // openRouterConnected: a paid key, so the free-tier clamp (which forces the default) does not apply.
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    const seed = await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}&modelId=${encodeURIComponent(NON_DEFAULT_MODEL)}`);
    expect(seed.ok()).toBe(true);

    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.model).toBe(NON_DEFAULT_MODEL);
  });

  test('without a seeded model, the recommend operation falls back to the default', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(DEFAULT_MODEL);
  });
});
