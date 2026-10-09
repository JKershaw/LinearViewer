import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

/**
 * LIN-3383 (S1.4 of LIN-2954) — only the workspace owner can queue work for
 * their runner, end to end through the real app.
 *
 * Drives `POST /workspace/:urlKey/api/dispatch` with explicit
 * `/test/set-workspace-ownership` seeding, so the verdict is stated rather than
 * inherited from first-binder order. After each refusal the queue (read back
 * through `GET .../api/dispatch/count`) must be unchanged.
 */
const KEY = 'runner-enqueue-owner-only';

let urlKey;
let dispatchUrl;

test.beforeEach(async ({ page }) => {
  const seeded = await seedLocalWorkspace(page, null, { urlKey: KEY, append: true, features: { dispatch: true } });
  urlKey = seeded.urlKey;
  dispatchUrl = `/workspace/${urlKey}/api/dispatch`;
  await seedWorkspaceOwnership(page, urlKey, 'owner');
});

async function queued(page) {
  const res = await page.request.get(`${dispatchUrl}/count`);
  expect(res.status()).toBe(200);
  return (await res.json()).count;
}

async function dispatch(page, data) {
  return page.request.post(dispatchUrl, { headers: { 'Content-Type': 'application/json' }, data });
}

test.describe('LIN-3383 — owner-only runner enqueue (e2e)', () => {
  test('owner → 201 and the queue grows by one', async ({ page }) => {
    const before = await queued(page);
    const res = await dispatch(page, { prompt: 'owner run', target: 'cli' });
    expect(res.status()).toBe(201);
    expect(await queued(page)).toBe(before + 1);
  });

  test('foreign owner → 403 RUNNER_OWNER_ONLY with the plain message, queue unchanged', async ({ page }) => {
    const before = await queued(page);
    await seedWorkspaceOwnership(page, urlKey, 'foreign');

    for (const data of [
      { prompt: 'member run' },
      { prompt: 'member web run', target: 'web' },
      { abort: true, abortTo: '11111111-2222-4333-8444-555555555555' },
      { abort: true, abortTo: '11111111-2222-4333-8444-555555555555', cascade: true }
    ]) {
      const res = await dispatch(page, data);
      expect(res.status(), JSON.stringify(data)).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('RUNNER_OWNER_ONLY');
      expect(body.error).toBe("Only this workspace's owner can act on its runner.");
      expect(body.retryable).toBe(false);
    }
    expect(await queued(page)).toBe(before);
  });

  test('foreign owner: a dash dispatch is unchanged (still queues)', async ({ page }) => {
    await seedWorkspaceOwnership(page, urlKey, 'foreign');
    const before = await queued(page);
    const res = await dispatch(page, { prompt: 'dash run', target: 'dash' });
    expect(res.status()).toBe(201);
    expect(await queued(page)).toBe(before + 1);
  });

  test('ownerless workspace → 409 WORKSPACE_OWNER_UNSET, queue unchanged', async ({ page }) => {
    const before = await queued(page);
    await seedWorkspaceOwnership(page, urlKey, 'ownerless');
    const res = await dispatch(page, { prompt: 'run' });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('WORKSPACE_OWNER_UNSET');
    expect(await queued(page)).toBe(before);
  });
});
