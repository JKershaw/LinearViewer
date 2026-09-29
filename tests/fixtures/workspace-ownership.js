/**
 * LIN-3137 J5 — explicit workspace-owner seeding for E2E specs.
 *
 * The owner edge (LIN-1892 S1) is otherwise written only by the FIRST
 * membership binder, which made an owner-gated mint order-dependent: a sibling
 * spec that mutates the edge (tests/e2e/proxy-runner.spec.js sets it to
 * ownerless / foreign / corrupt) could leave a shared account non-owner and
 * 403 an unrelated mint. This helper drives the test-only
 * `/test/set-workspace-ownership` route so each spec states the ownership it
 * needs rather than relying on binder order. Additive: it changes no assertion.
 *
 * Accepts a Playwright `Page` (uses its cookie-sharing `page.request`, so it
 * does NOT navigate the page) or an `APIRequestContext`.
 *
 * @param {import('@playwright/test').Page|import('@playwright/test').APIRequestContext} client
 * @param {string} urlKey - the session workspace to seed
 * @param {'owner'|'ownerless'|'foreign'|'corrupt'} [state='owner']
 * @returns {Promise<import('@playwright/test').APIResponse>}
 */
export async function seedWorkspaceOwnership(client, urlKey, state = 'owner') {
  const api = client.request ?? client;
  const response = await api.get(
    `/test/set-workspace-ownership?urlKey=${encodeURIComponent(urlKey)}&state=${encodeURIComponent(state)}`
  );
  if (!response.ok()) {
    throw new Error(
      `seedWorkspaceOwnership(${state}) failed for ${urlKey}: ${response.status()} ${await response.text()}`
    );
  }
  return response;
}
