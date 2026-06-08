/**
 * E2E tests for workspace-scoped AI model selection (LIN-283).
 *
 * Covers both the UI (dashboard) and proxy paths to confirm that the
 * workspace preference flows through to every LLM call.
 */
import { test, expect } from '../fixtures/test-base.js';

const URL_KEY = 'test-workspace';
const NON_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const ISSUE_ID = '66666666-6666-6666-6666-666666666666';

test.describe('Workspace AI model selection', () => {
  test.beforeEach(async ({ request }) => {
    // Each test starts with a clean slate: no workspace prefs and no
    // cached recap (the cache stores the model used at generation time).
    await request.get(`/test/set-workspace-model?urlKey=${URL_KEY}`);
    await request.get(`/test/clear-recap-cache?urlKey=${URL_KEY}&issueId=${ISSUE_ID}`);
  });

  test.afterEach(async ({ request }) => {
    await request.get(`/test/set-workspace-model?urlKey=${URL_KEY}`);
    await request.get(`/test/clear-recap-cache?urlKey=${URL_KEY}&issueId=${ISSUE_ID}`);
  });

  test('UI path: dashboard recap uses the seeded workspace model', async ({ page, request }) => {
    const seed = await request.get(`/test/set-workspace-model?urlKey=${URL_KEY}&modelId=${encodeURIComponent(NON_DEFAULT_MODEL)}`);
    expect(seed.ok()).toBe(true);

    await page.goto('/test/set-session');

    // POST forces a fresh LLM call, exercising the workspace-model lookup
    // at the dashboard recap call site (E3).
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
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
    await page.goto('/test/set-session');
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(DEFAULT_MODEL);
  });
});
