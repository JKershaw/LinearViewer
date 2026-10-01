/**
 * LIN-3136 — an enqueue-capable proxy writer for E2E specs, minted the
 * production way.
 *
 * Once `requireGrant('dispatch')` gates the enqueue mounts, a
 * `/test/create-proxy-token?scope=readWrite` writer is refused (it is
 * grant-less by construction). This helper takes the path a real owner's copy
 * takes instead, with no test-only mint route:
 *   1. seed the session account as the workspace owner (order-independent,
 *      see ./workspace-ownership.js);
 *   2. `POST /workspace/:urlKey/api/proxy/tokens { purpose: 'driver' }` with
 *      the session cookie (the owner-checked driver row: `['dispatch']`, the
 *      48h `worker` profile);
 *   3. exchange the bootstrap at `POST /api/proxy/token`.
 *
 * The page's session must already exist with the `proxy` feature flag on (the
 * tokens route refuses without it). Uses the page's cookie-sharing
 * `page.request`, so it does not navigate the page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} urlKey
 * @returns {Promise<{token: string, scope: string, grants: string[], expiresAt: string}>}
 *   the exchanged working token
 */
import { seedWorkspaceOwnership } from './workspace-ownership.js';

export async function mintDriverWriter(page, urlKey) {
  await seedWorkspaceOwnership(page, urlKey, 'owner');

  const minted = await page.request.post(`/workspace/${encodeURIComponent(urlKey)}/api/proxy/tokens`, {
    data: { purpose: 'driver' }
  });
  if (minted.status() !== 201) {
    throw new Error(`mintDriverWriter: driver mint failed for ${urlKey}: ${minted.status()} ${await minted.text()}`);
  }
  const { token: bootstrap } = await minted.json();

  const exchanged = await page.request.post('/api/proxy/token', {
    headers: { Authorization: `Bearer ${bootstrap}` }
  });
  if (!exchanged.ok()) {
    throw new Error(`mintDriverWriter: exchange failed for ${urlKey}: ${exchanged.status()} ${await exchanged.text()}`);
  }
  return exchanged.json();
}
