/**
 * E2E for the session-auth comments API served by a GENUINE `provider: 'local'`
 * session (LIN-582, Phase A2).
 *
 * Sibling to workspace-api-recap-brief-local.spec.js: it extends the direct
 * session-auth workspace-API coverage past recap/brief into the comments surface
 * (`GET /workspace/:urlKey/api/comments/:issueId`), the one consumer flow in the
 * Phase A list that had no API-level local coverage (recommend/streaming live in
 * streaming.spec, prompts in prompts.spec, dispatch in dispatch-page.spec).
 *
 * The data is provider-sourced: `local-issue-1` carries its two seeded comments
 * (Alice, Bob) ONLY in defaultLocalSeed, never in testMockData, and the route's
 * old `testMockData` comments mock was removed (LIN-413) — so a non-empty result
 * here can only come from LocalProvider.fetchIssueComments through the real
 * getProviderForWorkspace + getWorkspaceToken read seam.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js';

const URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const API_PREFIX = `/workspace/${URL_KEY}`;
// defaultLocalSeed: local-issue-1 has two comments; local-issue-2 has none.
const ISSUE_WITH_COMMENTS = 'local-issue-1';
const ISSUE_WITHOUT_COMMENTS = 'local-issue-2';

test.describe('Comments API — local provider session (LIN-582)', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page);
  });

  test('GET returns the seeded comments oldest-first with author + body', async ({ page }) => {
    const res = await page.request.get(`${API_PREFIX}/api/comments/${ISSUE_WITH_COMMENTS}`);
    expect(res.status()).toBe(200);
    const { comments } = await res.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(2);

    // Provider sorts oldest-first (Alice 2024-01-15 before Bob 2024-01-16).
    expect(comments.map(c => c.user)).toEqual(['Alice', 'Bob']);
    expect(comments[0].body).toContain('**markdown**');
    expect(comments[1].body).toContain('`code`');
    // Each comment carries the flat {id, body, createdAt, user} shape.
    for (const c of comments) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.createdAt).toBe('string');
    }
  });

  test('GET returns an empty array for an issue with no comments', async ({ page }) => {
    const res = await page.request.get(`${API_PREFIX}/api/comments/${ISSUE_WITHOUT_COMMENTS}`);
    expect(res.status()).toBe(200);
    const { comments } = await res.json();
    expect(comments).toEqual([]);
  });

  test('GET returns 404 for an issue absent from the local store', async ({ page }) => {
    // Valid id format, but no such issue → provider throws "Issue not found" → 404.
    const res = await page.request.get(`${API_PREFIX}/api/comments/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });

  test('GET returns 400 for an invalid issue ID format', async ({ page }) => {
    const res = await page.request.get(`${API_PREFIX}/api/comments/INVALID!!!`);
    expect(res.status()).toBe(400);
  });
});
