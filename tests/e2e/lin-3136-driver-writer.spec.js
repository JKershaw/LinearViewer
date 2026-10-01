import { test, expect } from '../fixtures/test-base.js';
import { mintDriverWriter } from '../fixtures/driver-writer.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

// LIN-3136 (M5, acceptance 14 through the running server): the owner's driver
// copy, minted the production way by the `mintDriverWriter` fixture, exchanges
// to a readWrite + ['dispatch'] working token on the 48h worker profile. It can
// enqueue, it cannot reach a runner (`take`) route, and a non-owner session is
// refused before any token is written.

let URL_KEY;
const FEATS = encodeURIComponent(JSON.stringify({ proxy: true, dispatch: true }));

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

test.describe('LIN-3136 driver copy — the production writer path', () => {
  test('owner: readWrite + [dispatch] ≈48h; POST /api/proxy/dispatch 201; runner poll 403', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
    const writer = await mintDriverWriter(page, URL_KEY);

    expect(writer.scope).toBe('readWrite');
    expect(writer.grants).toEqual(['dispatch']);
    const hours = (new Date(writer.expiresAt).getTime() - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48.01);

    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    const auth = { Authorization: `Bearer ${writer.token}` };
    const dispatched = await page.request.post('/api/proxy/dispatch', {
      headers: auth,
      data: { prompt: 'LIN-3136 driver writer', target: 'cli', kind: 'implementation' }
    });
    expect(dispatched.status(), await dispatched.text()).toBe(201);

    const poll = await page.request.get('/api/proxy/runner/poll', { headers: auth });
    expect(poll.status()).toBe(403);
    expect((await poll.json()).code).toBe('TAKE_GRANT_REQUIRED');
  });

  test('non-owner: 403 GRANT_OWNER_ONLY with the driver subject', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
    await seedWorkspaceOwnership(page, URL_KEY, 'foreign');
    try {
      const res = await page.request.post(`/workspace/${URL_KEY}/api/proxy/tokens`, { data: { purpose: 'driver' } });
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('GRANT_OWNER_ONLY');
      expect(body.error).toBe("Only this workspace's owner can mint a driver credential");
    } finally {
      await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    }
  });
});
