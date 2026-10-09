import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

/**
 * LIN-3131 — the runner credential surface, end to end (S2b.3 Settings +
 * S2b.5 local loop / refusal probes / LIN-2394 expiry witness).
 *
 * Lives in its own local-harness spec (not proxy.spec.js, whose Linear-token
 * boundary the fixture doc pins) because the owner flow needs a workspace whose
 * FIRST membership edge is created NOW: `/test/set-local-session` with
 * `append: true` mints a fresh `crypto.randomUUID()` workspace id, so the
 * session's account becomes its OWNER (LIN-1892 S1). The shared fixed test
 * UUIDs (1111…/3333…) were bound before ownership tracking and stay owner-less.
 *
 * Everything is driven over HTTP against the running Playwright server; no
 * non-loopback socket is opened.
 */
const RUNNER_LOCAL_KEY = 'proxy-runner-local';

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
  // LIN-3409: halt and runner-credential revoke are owner-only; state the ownership
  // this spec needs rather than relying on binder order (the probes below then
  // flip it to ownerless / foreign / corrupt on purpose).
  await seedWorkspaceOwnership(page, urlKey, 'owner');
  apiPrefix = `/workspace/${urlKey}/api/proxy`;
  proxyUrl = `/workspace/${urlKey}/proxy`;
  await page.goto(`/test/clear-proxy-tokens?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-tokens?urlKey=${urlKey}`);
});

async function cookieHeader(page) {
  const cookies = await page.context().cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/** Owner-checked runner copy mint (S2b.2), returning the bootstrap response. */
async function mintRunnerBootstrap(request, header) {
  const res = await request.post(`${apiPrefix}/tokens`, {
    headers: { Cookie: header, 'Content-Type': 'application/json' },
    data: { runner: true }
  });
  expect(res.status()).toBe(201);
  return res.json();
}

/** Mint + exchange: the working runner credential (grants take+dispatch). */
async function exchangeRunner(request, header) {
  const bootstrap = await mintRunnerBootstrap(request, header);
  const exchange = await request.post('/api/proxy/token', {
    headers: { Authorization: `Bearer ${bootstrap.token}` }
  });
  expect(exchange.status()).toBe(200);
  return { bootstrap, working: await exchange.json() };
}

test.describe('Proxy page - Runner credentials (LIN-3131 S2b.3)', () => {
  test('owner mint → list (waiting+active) → revoke → next poll 401', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const { bootstrap, working } = await exchangeRunner(request, header);
    expect(bootstrap.kind).toBe('bootstrap');
    expect(bootstrap.scope).toBe('readWrite');
    expect(bootstrap.grants).toEqual(['take', 'dispatch']);
    expect(bootstrap.lifetimeProfile).toBe('runner');
    expect(working.grants).toEqual(['take', 'dispatch']);

    // The working credential can poll the runner surface.
    const pollOk = await request.get('/api/proxy/runner/poll', {
      headers: { Authorization: `Bearer ${working.token}` }
    });
    expect(pollOk.status()).toBe(200);

    // The Settings surface lists the active row with hour/minute expiry.
    await page.goto(proxyUrl);
    await page.waitForLoadState('networkidle');
    const runnerGroup = page.locator('#proxy-runner-credentials');
    await expect(runnerGroup.locator('.runner-credential-item')).toHaveCount(1);
    await expect(runnerGroup).toContainText('active');
    await expect(runnerGroup).toContainText(/expires in \d+h \d+m/);

    // Revoke via the UI (lineage revoke by the live row's own id).
    page.on('dialog', dialog => dialog.accept());
    await runnerGroup.locator('.runner-credential-revoke').click();
    await expect(runnerGroup).toContainText('No runner credentials yet');

    // The revoked working credential is dead: the next poll is a 401.
    const pollRevoked = await request.get('/api/proxy/runner/poll', {
      headers: { Authorization: `Bearer ${working.token}` }
    });
    expect(pollRevoked.status()).toBe(401);
  });

  test('an unconsumed bootstrap is listed as waiting, with minute expiry', async ({ page, request }) => {
    const header = await cookieHeader(page);
    await mintRunnerBootstrap(request, header);

    await page.goto(proxyUrl);
    await page.waitForLoadState('networkidle');
    const row = page.locator('#proxy-runner-credentials .runner-credential-item').first();
    await expect(row).toContainText('waiting for exchange');
    await expect(row).toContainText(/expires in (\d+m|\d+h \d+m)/);
  });
});

test.describe('Runner loop - owner copy → exchange → poll → take → feedback → terminal + wake (LIN-3131 S2b.5)', () => {
  test('the whole loop drives a dispatch to terminal and wakes its parent', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const { working } = await exchangeRunner(request, header);
    const auth = { Authorization: `Bearer ${working.token}`, 'Content-Type': 'application/json' };

    // Enqueue a parent and a child that wakes the parent on terminal feedback.
    const parentRes = await request.post('/api/proxy/dispatch', {
      headers: auth,
      data: { prompt: 'parent work', harness: 'claude-code' }
    });
    expect(parentRes.status()).toBe(201);
    const parent = await parentRes.json();
    const childRes = await request.post('/api/proxy/dispatch', {
      headers: auth,
      data: { prompt: 'child work', harness: 'claude-code', sessionId: parent.id, subscription: 'terminal-only' }
    });
    expect(childRes.status()).toBe(201);
    const child = await childRes.json();

    // POLL: the runner sees both queued items.
    const poll = await request.get('/api/proxy/runner/poll', { headers: { Authorization: `Bearer ${working.token}` } });
    expect(poll.status()).toBe(200);
    const polled = await poll.json();
    const ids = polled.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([parent.id, child.id]));

    // TAKE: claim the child.
    const take = await request.post(`/api/proxy/runner/take/${child.id}`, { headers: { Authorization: `Bearer ${working.token}` } });
    expect(take.status()).toBe(200);
    const taken = await take.json();
    expect(taken.item.id).toBe(child.id);
    expect(taken.dispatchId).toBe(child.id);

    // FEEDBACK (terminal marker).
    const fb = await request.post(`/api/proxy/runner/feedback/${child.id}`, {
      headers: auth,
      data: { message: '[done] shipped' }
    });
    expect(fb.status()).toBe(200);

    // TERMINAL: the child's derived status is done with a completedAt.
    const watch = await request.get(`/api/proxy/dispatch/${child.id}`, { headers: { Authorization: `Bearer ${working.token}` } });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.status).toBe('done');
    expect(watched.completedAt).toBeTruthy();

    // WAKE: the terminal child feedback queued a `kind:'wake'` row for the parent.
    const poll2 = await request.get('/api/proxy/runner/poll', { headers: { Authorization: `Bearer ${working.token}` } });
    const polled2 = await poll2.json();
    expect(polled2.items.some(i => i.kind === 'wake')).toBe(true);
  });

  // L3 (review c50dfdd4): the `take`-gated runner section must be threaded end
  // to end from the token's grants through `routes/proxy.js` into
  // `buildInstructions` — a plain token's instructions must omit it.
  test('L3: /api/proxy/instructions shows the runner section to a runner token only', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const { working } = await exchangeRunner(request, header);

    const runnerInstructions = await (await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${working.token}` }
    })).text();
    expect(runnerInstructions).toContain('## Runner Endpoints');
    expect(runnerInstructions).toContain("Your token's grants: take, dispatch.");
    expect(runnerInstructions).toMatch(/GET https?:\/\/[^ ]+\/api\/proxy\/runner\/poll/);

    // A plain readWrite token gets the grants table but NOT the runner section.
    const plain = await (await request.get(`/test/create-proxy-token?urlKey=${urlKey}&label=plain-rw&scope=readWrite`)).json();
    const plainInstructions = await (await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${plain.token}` }
    })).text();
    expect(plainInstructions).toContain('## Grants');
    expect(plainInstructions).not.toContain('## Runner Endpoints');
  });
});

test.describe('Runner mint refusal probes - over HTTP on the running server (LIN-3131 S2b.5)', () => {
  const postRunner = (request, header) => request.post(`${apiPrefix}/tokens`, {
    headers: { Cookie: header, 'Content-Type': 'application/json' },
    data: { runner: true }
  });

  test('GRANTS_NOT_CLIENT_SETTABLE (400): a body carrying grants', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const res = await request.post(`${apiPrefix}/tokens`, {
      headers: { Cookie: header, 'Content-Type': 'application/json' },
      data: { runner: true, grants: ['take'] }
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('GRANTS_NOT_CLIENT_SETTABLE');
  });

  test('GRANT_OWNERLESS (503): a session with no accountId', async ({ page, request }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&noLinearUser=1&urlKey=${urlKey}`);
    const header = await cookieHeader(page);
    const res = await postRunner(request, header);
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('GRANT_OWNERLESS');
    expect(body.retryable).toBe(false);
  });

  test('WORKSPACE_OWNER_UNSET (409): the workspace has no owner edge', async ({ page, request }) => {
    await page.goto(`/test/set-workspace-ownership?urlKey=${urlKey}&state=ownerless`);
    const header = await cookieHeader(page);
    const res = await postRunner(request, header);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('WORKSPACE_OWNER_UNSET');
    expect(body.retryable).toBe(false);
  });

  test('GRANT_OWNER_ONLY (403): a different account owns the workspace', async ({ page, request }) => {
    await page.goto(`/test/set-workspace-ownership?urlKey=${urlKey}&state=foreign`);
    const header = await cookieHeader(page);
    const res = await postRunner(request, header);
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('GRANT_OWNER_ONLY');
    expect(body.retryable).toBe(false);
    expect(JSON.stringify(body)).not.toContain('account-');
  });

  test('OWNER_CHECK_UNAVAILABLE (503, retryable): a corrupt mergedInto chain', async ({ page, request }) => {
    await page.goto(`/test/set-workspace-ownership?urlKey=${urlKey}&state=corrupt`);
    const header = await cookieHeader(page);
    const res = await postRunner(request, header);
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('OWNER_CHECK_UNAVAILABLE');
    expect(body.retryable).toBe(true);
  });
});

test.describe('LIN-2394 expiry witness (LIN-3131 S2b.5)', () => {
  test('the runner exchange expiresAt minus the Date header ≈ the 24h working TTL', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const bootstrap = await mintRunnerBootstrap(request, header);
    const exchange = await request.post('/api/proxy/token', {
      headers: { Authorization: `Bearer ${bootstrap.token}` }
    });
    expect(exchange.status()).toBe(200);
    const dateHeader = exchange.headers()['date'];
    const body = await exchange.json();
    const skewSeconds = (new Date(body.expiresAt).getTime() - new Date(dateHeader).getTime()) / 1000;
    expect(Math.abs(skewSeconds - 24 * 3600)).toBeLessThan(5);
  });

  test('an expired document gives 401 with proxyTokenExpiredAt == expiresAt', async ({ page, request }) => {
    await cookieHeader(page); // ensure the session cookie exists
    const minted = await (await request.get(`/test/create-proxy-token?urlKey=${urlKey}&label=expiry-witness`)).json();
    expect(minted.expiresAt).toBeTruthy();
    const expired = await (await request.get(`/test/expire-proxy-token?urlKey=${urlKey}&tokenId=${minted.tokenId}`)).json();

    const res = await request.get('/api/proxy/me', {
      headers: { Authorization: `Bearer ${minted.token}` }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.proxyTokenState).toBe('expired');
    expect(body.proxyTokenExpiredAt).toBe(expired.expiresAt);
  });
});

test.describe('Owner-only proxy halt and runner-credential revoke - real server (LIN-3409)', () => {
  const HALT = '/api/proxy/dispatch/halt';
  const bearer = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  /** A Settings-minted (grant-less, readWrite) token: the session's own mint route stamps the workspace id. */
  async function mintSettingsToken(request, header) {
    const res = await request.post(`${apiPrefix}/tokens`, {
      headers: { Cookie: header, 'Content-Type': 'application/json' },
      data: { label: 'ops', scope: 'readWrite' }
    });
    expect(res.status()).toBe(201);
    return (await res.json()).token;
  }

  test("the owner's Settings token halts and resumes the runner", async ({ page, request }) => {
    const token = await mintSettingsToken(request, await cookieHeader(page));
    const set = await request.post(HALT, { headers: bearer(token), data: { mode: 'pause' } });
    expect(set.status()).toBe(200);
    expect((await (await request.get(HALT, { headers: bearer(token) })).json()).halt.mode).toBe('pause');
    const cleared = await request.delete(HALT, { headers: bearer(token) });
    expect(cleared.status()).toBe(200);
    expect((await (await request.get(HALT, { headers: bearer(token) })).json()).halt).toBeNull();
  });

  test("a member's Settings token is refused 403 RUNNER_OWNER_ONLY on halt and resume, and nothing is set", async ({ page, request }) => {
    const header = await cookieHeader(page);
    const ownerToken = await mintSettingsToken(request, header);
    await seedWorkspaceOwnership(page, urlKey, 'foreign');
    const memberToken = await mintSettingsToken(request, header); // a member may still mint a grant-less token

    for (const call of [
      () => request.post(HALT, { headers: bearer(memberToken), data: { mode: 'stop' } }),
      () => request.delete(HALT, { headers: bearer(memberToken) })
    ]) {
      const res = await call();
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('RUNNER_OWNER_ONLY');
      expect(body.error).toBe("Only this workspace's owner can act on its runner.");
    }
    // the halt read stays open to the member, and nothing was set
    expect((await (await request.get(HALT, { headers: bearer(memberToken) })).json()).halt).toBeNull();
    // the owner's earlier token is a creator-checked token too: owner ownership flipped, so it is refused as well
    expect((await request.post(HALT, { headers: bearer(ownerToken), data: { mode: 'pause' } })).status()).toBe(403);
  });

  test('a token with no workspace id gets 409 PROXY_TOKEN_UNBOUND with the true copy', async ({ page, request }) => {
    const header = await cookieHeader(page);
    const unbound = (await (await request.get(`/test/create-proxy-token?urlKey=${urlKey}&scope=readWrite&label=unbound`, { headers: { Cookie: header } })).json()).token;
    const res = await request.post(HALT, { headers: bearer(unbound), data: { mode: 'pause' } });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('PROXY_TOKEN_UNBOUND');
    expect(body.error).toContain('not bound to a workspace');
    expect(body.error).toContain('Mint a new token on the Proxy page, or use the Dispatch page.');
  });

  test("a member cannot revoke the owner's runner credential (403) but can revoke their own grant-less token", async ({ page, request }) => {
    const header = await cookieHeader(page);
    const { bootstrap, working } = await exchangeRunner(request, header);
    await seedWorkspaceOwnership(page, urlKey, 'foreign');

    const refused = await request.delete(`${apiPrefix}/tokens/${working.tokenId ?? bootstrap.tokenId}`, { headers: { Cookie: header } });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe('RUNNER_OWNER_ONLY');
    const alive = await request.get('/api/proxy/runner/poll', { headers: { Authorization: `Bearer ${working.token}` } });
    expect(alive.status()).toBe(200);

    const own = await mintSettingsToken(request, header);
    const list = await (await request.get(`${apiPrefix}/tokens`, { headers: { Cookie: header } })).json();
    const ownRow = list.tokens.find(t => t.grants.length === 0);
    expect(ownRow, own && 'a grant-less row is listed').toBeTruthy();
    expect((await request.delete(`${apiPrefix}/tokens/${ownRow.tokenId}`, { headers: { Cookie: header } })).status()).toBe(200);

    await seedWorkspaceOwnership(page, urlKey, 'owner');
    const ok = await request.delete(`${apiPrefix}/tokens/${bootstrap.tokenId}`, { headers: { Cookie: header } });
    expect(ok.status()).toBe(200);
  });
});
