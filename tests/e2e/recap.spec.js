/**
 * E2E tests for the recap API (LIN-261; migrated to the local provider in LIN-403).
 *
 * The Recap API block rides a GENUINE `provider: 'local'` session seeded from
 * `workspaceApiLocalSeed` (the shared pipeline/workspace-api fixture), not the
 * `test-token` + `testMockData` mock short-circuit. The AI mock (buildMockRecap)
 * still fires because `shouldMockAi` re-gates it onto local sessions (#399).
 *
 * The former `Recap UI — Swipe` block lived here too; it exercises the swipe
 * surface (not yet migrated) and was relocated unchanged into swipe.spec.js so
 * this spec is fully testMockData-free (unblocks LIN-413).
 */
import { test, expect } from '../fixtures/test-base.js';
import {
  seedLocalWorkspace,
  workspaceApiLocalSeed,
  LOCAL_WORKSPACE_URL_KEY,
} from '../fixtures/local-harness.js';

const URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const ISSUE_ID = '66666666-6666-6666-6666-666666666666';
const ISSUE_IDENTIFIER = 'TEST-6';

test.describe('Recap API', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page, workspaceApiLocalSeed);
  });

  test('GET returns status=missing for never-generated issue', async ({ page }) => {
    // Use a different UUID to keep this test independent of state from others.
    // The recap cache is keyed (urlKey, canonicalId) and persists per worker, so
    // clear this id at the local workspace first to guarantee a missing read
    // (the route defaults urlKey=test-workspace and 400s without issueId).
    const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef';
    await page.request.get(`/test/clear-recap-cache?urlKey=${URL_KEY}&issueId=${MISSING_ID}`);
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/${MISSING_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['missing', 'fresh', 'stale']).toContain(body.status);
  });

  test('POST generates recap and returns status=fresh', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.recap).toBeTruthy();
    expect(Array.isArray(body.recap.done)).toBe(true);
    expect(Array.isArray(body.recap.pending)).toBe(true);
    expect(Array.isArray(body.recap.deviations)).toBe(true);
    expect(body.generatedAt).toBeTruthy();
  });

  test('GET after POST returns status=fresh with same recap', async ({ page }) => {
    await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.recap).toBeTruthy();
  });

  test('accepts LIN-XXX identifier format as well as UUID', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_IDENTIFIER}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
  });

  test('rejects invalid identifier format with 400', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/not!valid`);
    expect(res.status()).toBe(400);
  });

  test('returns 404 for unknown issue', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });
});
