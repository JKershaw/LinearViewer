import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

/**
 * LIN-3137 J5 — the owner-only mint gate on the legacy dispatch token, end to
 * end through the real app.
 *
 * Drives `POST /workspace/:urlKey/api/dispatch/tokens` over HTTP with explicit
 * `/test/set-workspace-ownership` seeding for every state, so the owner verdict
 * is stated rather than inherited from first-binder order. After each refusal,
 * the list endpoint must show no new token.
 *
 * Mirrors tests/e2e/proxy-runner.spec.js's local-session + ownership seeding.
 */
const OWNER_GATE_KEY = 'dispatch-token-owner-gate';

let urlKey;
let mintUrl;

test.beforeEach(async ({ page }) => {
  const seeded = await seedLocalWorkspace(page, null, {
    urlKey: OWNER_GATE_KEY,
    append: true,
    features: { dispatch: true }
  });
  urlKey = seeded.urlKey;
  mintUrl = `/workspace/${urlKey}/api/dispatch/tokens`;
  await page.goto(`/test/clear-dispatch-tokens?urlKey=${urlKey}`);
  await seedWorkspaceOwnership(page, urlKey, 'owner');
});

async function tokenCount(page) {
  const res = await page.request.get(mintUrl);
  expect(res.status()).toBe(200);
  return (await res.json()).tokens.length;
}

async function mint(page, data = {}) {
  return page.request.post(mintUrl, {
    headers: { 'Content-Type': 'application/json' },
    data
  });
}

test.describe('LIN-3137 — owner-only dispatch-token mint gate (e2e)', () => {
  test('owner → 201, and the minted token authenticates on /api/dispatch/poll', async ({ page }) => {
    const res = await mint(page, { label: 'owner-token' });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.tokenId).toBeTruthy();
    expect(body.token).toBeTruthy();
    expect(body.label).toBe('owner-token');

    const poll = await page.request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    expect(poll.status()).toBe(200);
    expect(Array.isArray((await poll.json()).items)).toBe(true);
  });

  test('ownerless → 409 WORKSPACE_OWNER_UNSET, and no token is minted', async ({ page }) => {
    const before = await tokenCount(page);
    await seedWorkspaceOwnership(page, urlKey, 'ownerless');

    const res = await mint(page, {});
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('WORKSPACE_OWNER_UNSET');
    expect(body.retryable).toBe(false);
    expect(await tokenCount(page)).toBe(before);
  });

  test('foreign → 403 GRANT_OWNER_ONLY, never names the owner, no token is minted', async ({ page }) => {
    const before = await tokenCount(page);
    await seedWorkspaceOwnership(page, urlKey, 'foreign');

    const res = await mint(page, {});
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('GRANT_OWNER_ONLY');
    expect(body.retryable).toBe(false);
    expect(JSON.stringify(body)).not.toContain('account-');
    expect(await tokenCount(page)).toBe(before);
  });

  test('corrupt → 503 OWNER_CHECK_UNAVAILABLE (retryable), no token is minted', async ({ page }) => {
    const before = await tokenCount(page);
    await seedWorkspaceOwnership(page, urlKey, 'corrupt');

    const res = await mint(page, {});
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('OWNER_CHECK_UNAVAILABLE');
    expect(body.retryable).toBe(true);
    expect(await tokenCount(page)).toBe(before);
  });

  test('a session with no accountId → 503 GRANT_OWNERLESS, no token is minted', async ({ page }) => {
    const before = await tokenCount(page);
    await page.goto(
      `/test/set-session?features=${encodeURIComponent(JSON.stringify({ dispatch: true }))}&noLinearUser=1&urlKey=${urlKey}`
    );

    const res = await mint(page, {});
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('GRANT_OWNERLESS');
    expect(body.retryable).toBe(false);
    expect(await tokenCount(page)).toBe(before);
  });
});
