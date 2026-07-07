import { test, expect } from '../fixtures/test-base.js';

// LIN-376 — end-to-end validation of the single-use bootstrap exchange through
// the REAL server + store + auth middleware. The unit tests prove the store and
// the exchange route in isolation (with a faked provider); this spec proves the
// wiring the units can't reach: that an exchanged working token actually
// authenticates a data endpoint, and — the containment guarantee — that a
// bootstrap token is REJECTED on a data endpoint.
//
// Bound per-worker (LIN-628), mirroring proxy.spec.js.
let URL_KEY;
let API_PREFIX;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  API_PREFIX = `/api/proxy`;
});

test.describe('Proxy API - Bootstrap exchange (LIN-376)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
  });

  async function mintBootstrap(page, scope = 'readWrite') {
    const resp = await page.goto(`/test/create-proxy-token?kind=bootstrap&scope=${scope}&label=bootstrap-test&urlKey=${URL_KEY}`);
    const data = await resp.json();
    expect(data.kind).toBe('bootstrap');
    return data.token;
  }

  test('exchange returns a working token that authenticates a data endpoint', async ({ page, request }) => {
    const bootstrap = await mintBootstrap(page);

    const exchange = await request.post(`${API_PREFIX}/token`, {
      headers: { Authorization: `Bearer ${bootstrap}` }
    });
    expect(exchange.status()).toBe(200);
    const body = await exchange.json();
    expect(body.token).toBeTruthy();
    expect(body.token).not.toBe(bootstrap);
    expect(body.scope).toBe('readWrite');
    expect(body.expiresAt).toBeTruthy();

    // The WORKING token flows through the real authenticateProxyToken middleware
    // and is accepted on a token-gated endpoint. (/instructions is the hermetic
    // auth boundary — it needs a valid token but no provider access, so it isolates
    // the credential check from workspace/provider resolution.)
    const authed = await request.get(`${API_PREFIX}/instructions`, {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    expect(authed.status()).toBe(200);
  });

  test('a bootstrap token is rejected on a data endpoint (containment), without being consumed', async ({ page, request }) => {
    const bootstrap = await mintBootstrap(page);

    // Containment: a bootstrap authenticates nothing but the exchange. Rejected
    // at the token-gated boundary (validateToken → null → 401), before any
    // provider resolution.
    const gated = await request.get(`${API_PREFIX}/instructions`, {
      headers: { Authorization: `Bearer ${bootstrap}` }
    });
    expect(gated.status()).toBe(401);

    // That rejected data call must NOT burn the bootstrap — it still exchanges.
    const exchange = await request.post(`${API_PREFIX}/token`, {
      headers: { Authorization: `Bearer ${bootstrap}` }
    });
    expect(exchange.status()).toBe(200);
  });

  test('the bootstrap is single-use — a second exchange fails', async ({ page, request }) => {
    const bootstrap = await mintBootstrap(page);

    const first = await request.post(`${API_PREFIX}/token`, {
      headers: { Authorization: `Bearer ${bootstrap}` }
    });
    expect(first.status()).toBe(200);

    const second = await request.post(`${API_PREFIX}/token`, {
      headers: { Authorization: `Bearer ${bootstrap}` }
    });
    expect(second.status()).toBe(401);
  });

  test('a standard (non-bootstrap) token cannot be exchanged', async ({ page, request }) => {
    const stdResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=std-test&urlKey=${URL_KEY}`);
    const std = (await stdResp.json()).token;

    const exchange = await request.post(`${API_PREFIX}/token`, {
      headers: { Authorization: `Bearer ${std}` }
    });
    expect(exchange.status()).toBe(401);

    // And it still authenticates a token-gated endpoint — it was never a bootstrap.
    const authed = await request.get(`${API_PREFIX}/instructions`, {
      headers: { Authorization: `Bearer ${std}` }
    });
    expect(authed.status()).toBe(200);
  });

  test('missing auth on the exchange endpoint 401s', async ({ request }) => {
    const resp = await request.post(`${API_PREFIX}/token`);
    expect(resp.status()).toBe(401);
  });
});
