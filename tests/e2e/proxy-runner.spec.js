import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';

/**
 * LIN-3131 S2b.3 — the Settings "Runner credentials" surface, end to end.
 *
 * Lives in its own local-harness spec (not proxy.spec.js, whose Linear-token
 * boundary the fixture doc pins) because the owner flow needs a workspace whose
 * FIRST membership edge is created NOW: `/test/set-local-session` with
 * `append: true` mints a fresh `crypto.randomUUID()` workspace id, so the
 * session's account becomes its OWNER (LIN-1892 S1). The shared fixed test
 * UUIDs (1111…/3333…) were bound before ownership tracking and stay owner-less.
 */
const RUNNER_LOCAL_KEY = 'proxy-runner-local';

test.describe('Proxy page - Runner credentials (LIN-3131 S2b.3)', () => {
  let urlKey;
  let apiPrefix;
  let proxyUrl;

  test.beforeEach(async ({ page }) => {
    const seeded = await seedLocalWorkspace(page, null, {
      urlKey: RUNNER_LOCAL_KEY,
      append: true,
      features: { proxy: true }
    });
    urlKey = seeded.urlKey;
    apiPrefix = `/workspace/${urlKey}/api/proxy`;
    proxyUrl = `/workspace/${urlKey}/proxy`;
    await page.goto(`/test/clear-proxy-tokens?urlKey=${urlKey}`);
  });

  async function cookieHeader(page) {
    const cookies = await page.context().cookies();
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  test('owner mint → list (waiting+active) → revoke → next poll 401', async ({ page, request }) => {
    const header = await cookieHeader(page);

    // 1. Owner-checked runner copy mint through the real S2b.2 route.
    const mintResp = await request.post(`${apiPrefix}/tokens`, {
      headers: { Cookie: header, 'Content-Type': 'application/json' },
      data: { runner: true }
    });
    expect(mintResp.status()).toBe(201);
    const mint = await mintResp.json();
    expect(mint.kind).toBe('bootstrap');
    expect(mint.scope).toBe('readWrite');
    expect(mint.grants).toEqual(['take', 'dispatch']);
    expect(mint.lifetimeProfile).toBe('runner');

    // 2. Exchange the bootstrap for the working runner credential.
    const exchangeResp = await request.post('/api/proxy/token', {
      headers: { Authorization: `Bearer ${mint.token}` }
    });
    expect(exchangeResp.status()).toBe(200);
    const working = await exchangeResp.json();
    expect(working.grants).toEqual(['take', 'dispatch']);

    // 3. The working credential can poll the runner surface.
    const pollOk = await request.get('/api/proxy/runner/poll', {
      headers: { Authorization: `Bearer ${working.token}` }
    });
    expect(pollOk.status()).toBe(200);

    // 4. The Settings surface lists the active row with hour/minute expiry.
    await page.goto(proxyUrl);
    await page.waitForLoadState('networkidle');
    const runnerGroup = page.locator('#proxy-runner-credentials');
    await expect(runnerGroup.locator('.runner-credential-item')).toHaveCount(1);
    await expect(runnerGroup).toContainText('active');
    await expect(runnerGroup).toContainText(/expires in \d+h \d+m/);

    // 5. Revoke via the UI (lineage revoke by the live row's own id).
    page.on('dialog', dialog => dialog.accept());
    await runnerGroup.locator('.runner-credential-revoke').click();
    await expect(runnerGroup).toContainText('No runner credentials yet');

    // 6. The revoked working credential is dead: the next poll is a 401.
    const pollRevoked = await request.get('/api/proxy/runner/poll', {
      headers: { Authorization: `Bearer ${working.token}` }
    });
    expect(pollRevoked.status()).toBe(401);
  });

  test('an unconsumed bootstrap is listed as waiting, with minute expiry', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const mintResp = await request.post(`${apiPrefix}/tokens`, {
      headers: { Cookie: header, 'Content-Type': 'application/json' },
      data: { runner: true }
    });
    expect(mintResp.status()).toBe(201);

    await page.goto(proxyUrl);
    await page.waitForLoadState('networkidle');
    const row = page.locator('#proxy-runner-credentials .runner-credential-item').first();
    await expect(row).toContainText('waiting for exchange');
    await expect(row).toContainText(/expires in (\d+m|\d+h \d+m)/);
  });
});
