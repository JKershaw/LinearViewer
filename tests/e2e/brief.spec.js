/**
 * E2E tests for the brief API (migrated to the local provider in LIN-404).
 *
 * The Brief API block rides a GENUINE `provider: 'local'` session seeded from
 * `workspaceApiLocalSeed` (the shared pipeline/workspace-api fixture), not the
 * `test-token` + `testMockData` mock short-circuit. The AI mock (buildMockBrief)
 * still fires because `shouldMockAi` re-gates it onto local sessions (#399).
 *
 * The former `Brief UI — Swipe` block lived here too; it exercises the swipe
 * surface (not yet migrated) and was relocated unchanged into swipe.spec.js so
 * this spec is fully testMockData-free (unblocks LIN-413).
 */
import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

const ISSUE_ID = '66666666-6666-6666-6666-666666666666';
const ISSUE_IDENTIFIER = 'TEST-6';

test.describe('Brief API', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(workspaceApiLocalSeed);
  });

  test('GET returns status=missing for never-generated issue', async ({ page, localWorkerUrlKey }) => {
    // TEST-14 exists in the seed (so the route reaches the cache, not a 404),
    // but its brief is never generated here. The brief cache is keyed
    // (urlKey, canonicalId) and persists per worker, so clear this id at the
    // local workspace first to guarantee a missing read (the route defaults its
    // urlKey to the test-token workspace and 400s without issueId).
    const MISSING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef';
    await page.request.get(`/test/clear-brief-cache?urlKey=${localWorkerUrlKey}&issueId=${MISSING_ID}`);
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/brief/${MISSING_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('missing');
  });

  test('POST generates brief and returns status=fresh', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.post(`/workspace/${localWorkerUrlKey}/api/brief/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(typeof body.brief).toBe('string');
    expect(body.brief).toContain('## Current');
    expect(body.generatedAt).toBeTruthy();
  });

  test('GET after POST returns status=fresh with the same brief', async ({ page, localWorkerUrlKey }) => {
    await page.request.post(`/workspace/${localWorkerUrlKey}/api/brief/${ISSUE_ID}`);
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/brief/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.brief).toContain('## Current');
  });

  test('accepts LIN-XXX identifier format as well as UUID', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.post(`/workspace/${localWorkerUrlKey}/api/brief/${ISSUE_IDENTIFIER}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
  });

  test('rejects invalid identifier format with 400', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/brief/not!valid`);
    expect(res.status()).toBe(400);
  });

  test('returns 404 for unknown issue', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.get(`/workspace/${localWorkerUrlKey}/api/brief/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });
});
