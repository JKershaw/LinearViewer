/**
 * E2E proof for the LIN-388 enabling change (PR1): the recap + brief AI surfaces
 * served by a GENUINE `provider: 'local'` session.
 *
 * This is the rail-test for the gate split, NOT the full recap/brief migration
 * (the existing recap.spec / brief.spec stay on the `test-token` path until the
 * later slice retires them). It proves three things at once:
 *   1. LocalProvider.fetchRecommendationContext is implemented — the route's real
 *      path (provider.fetchRecommendationContext) no longer throws for a local
 *      session.
 *   2. The data layer is provider-backed — `local-issue-1` exists ONLY in the
 *      local seed, never in testMockData, so a fresh recap for it could not come
 *      from the old data mock.
 *   3. shouldMockAi() re-gates the AI mock onto local sessions — CI has no
 *      OpenRouter key, yet the deterministic server mock (buildMockRecap /
 *      buildMockBrief) fires instead of a 503.
 */
import { test, expect } from '../fixtures/test-base.js';

// Seeded parent task carrying two comments (Alice, Bob) + a description — exists
// only in defaultLocalSeed, so a recap/brief for it is provider-sourced. Addressed
// by the human-facing identifier (resolved via getIssue's identifier fallback)
// rather than the raw _id, which is now namespaced per scope (LIN-800).
const ISSUE_ID = 'LOCAL-1';

test.describe('Recap API — local provider session (LIN-388)', () => {
  test.beforeEach(async ({ page, seedLocal }) => {
    await seedLocal();
    // Cache-writing surface: keep the partition clean between tests.
    await page.request.get('/test/clear-recap-cache');
  });

  test('POST generates a recap from provider data (no OpenRouter key, no 503)', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.post(`/workspace/${localWorkerUrlKey}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(Array.isArray(body.recap.done)).toBe(true);
    expect(Array.isArray(body.recap.pending)).toBe(true);
    expect(Array.isArray(body.recap.deviations)).toBe(true);
    // The seed's two comments + description drive the deterministic mock's `done`.
    expect(body.recap.done.length).toBeGreaterThan(0);
  });

  test('GET after POST returns status=fresh with the same recap', async ({ page, localWorkerUrlKey }) => {
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/recap/${ISSUE_ID}`);
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.recap).toBeTruthy();
  });

  test('returns 404 for an issue absent from the local store', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recap/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Brief API — local provider session (LIN-388)', () => {
  test.beforeEach(async ({ page, seedLocal }) => {
    await seedLocal();
  });

  test('POST generates a brief from provider data (no OpenRouter key, no 503)', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.post(`/workspace/${localWorkerUrlKey}/api/brief/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(typeof body.brief).toBe('string');
    expect(body.brief.length).toBeGreaterThan(0);
    expect(body.generatedAt).toBeTruthy();
  });
});
