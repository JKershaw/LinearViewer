/**
 * E2E tests for workspace-scoped AI model selection (LIN-283).
 *
 * Covers both the UI (dashboard) and proxy paths to confirm that the
 * workspace preference flows through to every LLM call.
 *
 * The two UI-path POST recap tests ride a GENUINE `provider: 'local'` session
 * (LIN-411) seeded from `workspaceApiLocalSeed`, exercising the real
 * workspace-model lookup at `LOCAL_WORKSPACE_URL_KEY`. The proxy-path test is
 * intentionally left on the `test-token` + `test-workspace` proxy contract —
 * that surface migrates separately. beforeEach/afterEach therefore reset model
 * prefs and recap cache for BOTH urlKeys so the two workspaces stay isolated.
 */
import { test, expect } from '../fixtures/test-base.js';
import {
  seedLocalWorkspace,
  workspaceApiLocalSeed,
  LOCAL_WORKSPACE_URL_KEY,
} from '../fixtures/local-harness.js';

const URL_KEY = 'test-workspace';             // proxy-path test (proxy-token contract)
const LOCAL_URL_KEY = LOCAL_WORKSPACE_URL_KEY; // UI-path tests (genuine local session)
const NON_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const ISSUE_ID = '66666666-6666-6666-6666-666666666666'; // TEST-6 in workspaceApiLocalSeed

test.describe('Workspace AI model selection', () => {
  test.beforeEach(async ({ request }) => {
    // Each test starts with a clean slate: no workspace prefs and no
    // cached recap (the cache stores the model used at generation time).
    // Both urlKeys are reset because this file mixes a local UI-path workspace
    // with the proxy-path test-workspace; neither must leak into the other.
    for (const key of [URL_KEY, LOCAL_URL_KEY]) {
      await request.get(`/test/set-workspace-model?urlKey=${key}`);
      await request.get(`/test/clear-recap-cache?urlKey=${key}&issueId=${ISSUE_ID}`);
    }
  });

  test.afterEach(async ({ request }) => {
    for (const key of [URL_KEY, LOCAL_URL_KEY]) {
      await request.get(`/test/set-workspace-model?urlKey=${key}`);
      await request.get(`/test/clear-recap-cache?urlKey=${key}&issueId=${ISSUE_ID}`);
    }
  });

  test('UI path: dashboard recap uses the seeded workspace model', async ({ page, request }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    const seed = await request.get(`/test/set-workspace-model?urlKey=${LOCAL_URL_KEY}&modelId=${encodeURIComponent(NON_DEFAULT_MODEL)}`);
    expect(seed.ok()).toBe(true);

    // POST forces a fresh LLM call, exercising the workspace-model lookup
    // at the dashboard recap call site (E3) on a genuine local session.
    const res = await page.request.post(`/workspace/${LOCAL_URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.model).toBe(NON_DEFAULT_MODEL);
  });

  test('Proxy path: GET /api/proxy/recap reflects the seeded workspace model', async ({ page, request }) => {
    const seed = await request.get(`/test/set-workspace-model?urlKey=${URL_KEY}&modelId=${encodeURIComponent(NON_DEFAULT_MODEL)}`);
    expect(seed.ok()).toBe(true);

    await page.goto('/test/set-session');
    const tokenRes = await page.request.get('/test/create-proxy-token?label=workspace-model-test&scope=readWrite');
    expect(tokenRes.ok()).toBe(true);
    const { token } = await tokenRes.json();

    // With no cached entry, GET takes the auto-regen branch (E7) and resolves
    // the workspace model just like a real proxy consumer would.
    const recap = await page.request.get(`/api/proxy/recap/${ISSUE_ID}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(recap.status()).toBe(200);
    const body = await recap.json();
    expect(body.status).toBe('fresh');
    expect(body.model).toBe(NON_DEFAULT_MODEL);
  });

  test('Without a seeded model, recap falls back to the default', async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
    const res = await page.request.post(`/workspace/${LOCAL_URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(DEFAULT_MODEL);
  });
});
