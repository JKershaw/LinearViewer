import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

/**
 * LIN-3421 — workspace removal revokes the removing account's runner lineage
 * ONLY when that account owns the workspace (the real `role:'owner'` edge read
 * by `workspaceOwnerCheck`, keyed by the session workspace id). The unit tests
 * use a fake owner check that ignores the workspace id, so this drives the real
 * route, stores and ownership edge over HTTP.
 */
const KEY_X = 'lin3421-runner-x';
const KEY_Y = 'lin3421-runner-y';

async function cookieHeader(page) {
  const cookies = await page.context().cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function setup(page, request) {
  // Two workspaces in one session so removing X takes the multi-workspace branch.
  await seedLocalWorkspace(page, null, { urlKey: KEY_X, append: true });
  await seedLocalWorkspace(page, null, { urlKey: KEY_Y, append: true });
  await seedWorkspaceOwnership(page, KEY_X, 'owner');
  await page.goto(`/test/clear-proxy-tokens?urlKey=${KEY_X}`);
  const header = await cookieHeader(page);
  const mint = await request.post(`/workspace/${KEY_X}/api/proxy/tokens`, {
    headers: { Cookie: header, 'Content-Type': 'application/json' },
    data: { runner: true }
  });
  expect(mint.status()).toBe(201);
  const boot = await mint.json();
  const exchange = await request.post('/api/proxy/token', { headers: { Authorization: `Bearer ${boot.token}` } });
  expect(exchange.status()).toBe(200);
  const working = (await exchange.json()).token;
  const poll = () => request.get('/api/proxy/runner/poll', { headers: { Authorization: `Bearer ${working}` } });
  expect((await poll()).status()).toBe(200);
  return { header, poll };
}

test.describe('LIN-3421 — runner lineage on workspace removal (real owner edge)', () => {
  test('the workspace owner removing it revokes the runner working token', async ({ page, request }) => {
    const { header, poll } = await setup(page, request);
    const removed = await request.post(`/workspace/${KEY_X}/remove`, { headers: { Cookie: header }, maxRedirects: 0 });
    expect(removed.status()).toBe(302);
    expect((await poll()).status()).toBe(401);
  });

  test('a non-owner removing it leaves the runner working token valid', async ({ page, request }) => {
    const { header, poll } = await setup(page, request);
    await seedWorkspaceOwnership(page, KEY_X, 'foreign');
    const removed = await request.post(`/workspace/${KEY_X}/remove`, { headers: { Cookie: header }, maxRedirects: 0 });
    expect(removed.status()).toBe(302);
    expect((await poll()).status()).toBe(200);
  });
});
