import { test, expect } from '../fixtures/test-base.js';

// Bound per-test from the per-worker key (LIN-628) so the session, the proxy
// page / API URLs, and every /test/* seam query param all address this worker's
// partition. Playwright workers are separate processes, so these module-scoped
// lets are per-worker state.
let URL_KEY;
let PROXY_PAGE_URL;
let API_PREFIX;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PROXY_PAGE_URL = `/workspace/${URL_KEY}/proxy`;
  API_PREFIX = `/workspace/${URL_KEY}/api/proxy`;
});

test.describe('Proxy Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
  });

  test('proxy page loads with all sections', async ({ page }) => {
    await page.goto(PROXY_PAGE_URL);
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page.locator('h1')).toHaveText('Proxy');

    // All sections present
    await expect(page.locator('text=Agent Prompt')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tokens' })).toBeVisible();
    await expect(page.locator('text=Examples')).toBeVisible();
    await expect(page.locator('text=Event Log')).toBeVisible();
  });

  test('proxy page redirects to settings when feature is disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}&urlKey=${URL_KEY}`);
    await page.goto(PROXY_PAGE_URL);
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('token list and event log are collapsed by default', async ({ page }) => {
    await page.goto(PROXY_PAGE_URL);
    await page.waitForLoadState('networkidle');

    // Both collapsibles should be present but closed
    await expect(page.locator('#proxy-tokens-collapsible')).not.toHaveAttribute('open', '');
    await expect(page.locator('#proxy-events-collapsible')).not.toHaveAttribute('open', '');

    // Token list content is not visible while collapsed
    await expect(page.locator('.proxy-token-list')).not.toBeVisible();
    await expect(page.locator('.proxy-events-list')).not.toBeVisible();
  });

  test('can create and revoke proxy tokens via UI', async ({ page }) => {
    await page.goto(PROXY_PAGE_URL);
    await page.waitForLoadState('networkidle');

    // Create a token (auto-expands the tokens section)
    await page.fill('#proxy-create-token-form input[name="label"]', 'test-ui-token');
    await page.click('#proxy-create-token-form button[type="submit"]');

    // Modal should appear with token
    await expect(page.locator('.token-modal')).toBeVisible();
    await expect(page.locator('.token-value')).not.toBeEmpty();

    // Close modal
    await page.click('.token-modal-close');
    await expect(page.locator('.token-modal')).not.toBeVisible();

    // Tokens collapsible auto-opens and token appears in list
    await expect(page.locator('#proxy-tokens-collapsible')).toHaveAttribute('open', '');
    await expect(page.locator('.proxy-token-list')).toContainText('test-ui-token');

    // Revoke the token
    page.on('dialog', dialog => dialog.accept());
    await page.click('.token-revoke');

    // Should be empty again (list stays open)
    await expect(page.locator('.proxy-token-list')).toContainText('No proxy tokens yet');
  });

  test('tokens section shows show-more when more than 5 tokens exist', async ({ page }) => {
    // Seed 7 tokens via the test endpoint
    for (let i = 0; i < 7; i++) {
      await page.goto(`/test/create-proxy-token?label=seed-${i}&urlKey=${URL_KEY}`);
    }
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);

    await page.goto(PROXY_PAGE_URL);
    await page.waitForLoadState('networkidle');

    // Expand tokens section
    await page.locator('#proxy-tokens-collapsible summary').click();

    // Wait for tokens to render
    await page.waitForSelector('.token-item');

    // Only 5 tokens visible initially + show-more button
    const visibleItemsCount = await page.locator('.token-item:visible').count();
    expect(visibleItemsCount).toBe(5);

    const showMore = page.locator('.token-show-more');
    await expect(showMore).toBeVisible();
    await expect(showMore).toContainText('show 2 more');

    await showMore.click();

    // All 7 tokens now visible, button gone
    await expect(page.locator('.token-show-more')).toHaveCount(0);
    expect(await page.locator('.token-item:visible').count()).toBe(7);
  });
});

test.describe('Proxy API - Token Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
  });

  test('create, list, and revoke tokens via API', async ({ request, page }) => {
    // Need session first
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Create token
    const createResp = await request.post(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      data: { label: 'api-test', scope: 'read' }
    });
    expect(createResp.status()).toBe(201);
    const createData = await createResp.json();
    expect(createData.token).toBeTruthy();
    expect(createData.scope).toBe('read');

    // List tokens
    const listResp = await request.get(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader }
    });
    expect(listResp.status()).toBe(200);
    const listData = await listResp.json();
    expect(listData.tokens).toHaveLength(1);
    expect(listData.tokens[0].label).toBe('api-test');

    // Revoke token
    const revokeResp = await request.delete(`${API_PREFIX}/tokens/${createData.tokenId}`, {
      headers: { Cookie: cookieHeader }
    });
    expect(revokeResp.status()).toBe(200);

    // Verify gone
    const listResp2 = await request.get(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader }
    });
    const listData2 = await listResp2.json();
    expect(listData2.tokens).toHaveLength(0);
  });

  test('created tokens get a default expiry', async ({ request, page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const createResp = await request.post(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      data: { label: 'ttl-default', scope: 'read' }
    });
    expect(createResp.status()).toBe(201);

    const listResp = await request.get(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader }
    });
    const listData = await listResp.json();
    const token = listData.tokens.find(t => t.label === 'ttl-default');
    expect(token).toBeTruthy();
    expect(token.expiresAt).toBeTruthy();

    const days = (new Date(token.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(80);
    expect(days).toBeLessThan(95);
  });

  test('tokens list is sorted newest-first', async ({ request, page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    for (const label of ['first', 'second', 'third']) {
      await request.post(`${API_PREFIX}/tokens`, {
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        data: { label, scope: 'read' }
      });
      // Small delay so createdAt timestamps differ
      await new Promise(r => setTimeout(r, 15));
    }

    const listResp = await request.get(`${API_PREFIX}/tokens`, {
      headers: { Cookie: cookieHeader }
    });
    const listData = await listResp.json();
    expect(listData.tokens.map(t => t.label)).toEqual(['third', 'second', 'first']);
  });
});

test.describe('Proxy API - Consumer Endpoints', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-proxy-events?urlKey=${URL_KEY}`);

    // Create read-only token
    const readResp = await page.goto(`/test/create-proxy-token?scope=read&label=read-test&urlKey=${URL_KEY}`);
    const readData = await readResp.json();
    readToken = readData.token;

    // Create read-write token
    const writeResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=write-test&urlKey=${URL_KEY}`);
    const writeData = await writeResp.json();
    writeToken = writeData.token;
  });

  test('unauthenticated requests get 401', async ({ request }) => {
    const resp = await request.get('/api/proxy/me');
    expect(resp.status()).toBe(401);
  });

  test('invalid token gets 401', async ({ request }) => {
    const resp = await request.get('/api/proxy/me', {
      headers: { Authorization: 'Bearer invalid-token-here' }
    });
    expect(resp.status()).toBe(401);
  });

  test('GET /api/proxy/instructions returns agent instructions', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('Workspace API Proxy');
    expect(text).toContain('/api/proxy/me');
    expect(text).toContain('/api/proxy/teams');
    expect(text).toContain('read');
    // the compact orientation projection is documented
    expect(text).toContain('view=digest');
  });

  test('GET /api/proxy/stack?view=digest returns compact rows without full descriptions', async ({ request }) => {
    const digest = await request.get('/api/proxy/stack?limit=5&view=digest', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(digest.status()).toBe(200);
    const data = await digest.json();
    expect(data.view).toBe('digest');
    expect(Array.isArray(data.tasks)).toBe(true);
    if (data.tasks.length > 0) {
      const t = data.tasks[0];
      expect(t).toHaveProperty('identifier');
      expect(t).toHaveProperty('headline');
      expect(t).toHaveProperty('state');
      // digest drops the heavy full description and the array fields (counts instead)
      expect(t).not.toHaveProperty('description');
      expect(typeof t.blocks).toBe('number');
      expect(typeof t.children).toBe('number');
      // LIN-391 explainability fields
      expect(typeof t.downstreamUnblocks).toBe('number');
      expect(typeof t.criticalPathLen).toBe('number');
      expect(Array.isArray(t.why)).toBe(true);
      // heldBy is present only when an off-page blocker forced the position
      if ('heldBy' in t) expect(Array.isArray(t.heldBy)).toBe(true);
    }
  });

  test('GET /api/proxy/stack (default/full) keeps descriptions and arrays', async ({ request }) => {
    const full = await request.get('/api/proxy/stack?limit=5', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(full.status()).toBe(200);
    const data = await full.json();
    expect(data.view).toBe('full');
    expect(Array.isArray(data.tasks)).toBe(true);
    if (data.tasks.length > 0) {
      const t = data.tasks[0];
      expect(t).toHaveProperty('description');
      expect(Array.isArray(t.children)).toBe(true);
      expect(Array.isArray(t.blocksIds)).toBe(true);
      // LIN-391: full view carries the same computed scalars as digest
      expect(typeof t.downstreamUnblocks).toBe('number');
      expect(typeof t.criticalPathLen).toBe('number');
    }
  });

  test('GET /api/proxy/stack full and digest agree on computed feature scalars', async ({ request }) => {
    const headers = { Authorization: `Bearer ${readToken}` };
    const [fullResp, digestResp] = await Promise.all([
      request.get('/api/proxy/stack?limit=10', { headers }),
      request.get('/api/proxy/stack?limit=10&view=digest', { headers })
    ]);
    const full = await fullResp.json();
    const digest = await digestResp.json();
    const digestById = new Map(digest.tasks.map(t => [t.id, t]));
    for (const f of full.tasks) {
      const d = digestById.get(f.id);
      if (!d) continue;
      expect(d.downstreamUnblocks).toBe(f.downstreamUnblocks);
      expect(d.criticalPathLen).toBe(f.criticalPathLen);
    }
  });

  test('read-write token instructions include write endpoints', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    const text = await resp.text();
    expect(text).toContain('Write Endpoints');
    expect(text).toContain('POST');
    expect(text).toContain('PATCH');
  });

  test('GET /api/proxy/me returns user info', async ({ request }) => {
    // In test mode with mock data, the Linear API won't actually be called,
    // but we verify the auth flow works. The endpoint will likely fail since
    // there's no real Linear API in test mode, but proxy token auth should pass.
    const resp = await request.get('/api/proxy/me', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    // Proxy token auth itself should succeed — we should not get our own
    // 401 response (which has 'Invalid or missing proxy token' error).
    // A 401 from upstream Linear (with 'Failed to fetch' error) is expected
    // since test-token isn't a real Linear token.
    if (resp.status() === 401) {
      const data = await resp.json();
      expect(data.error).not.toContain('Invalid or missing proxy token');
    }
  });

  test('read-only token gets 403 on write endpoints', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json'
      },
      data: { teamId: '11111111-1111-1111-1111-111111111111', title: 'Test' }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('read-write token passes scope check on write endpoints', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { teamId: '11111111-1111-1111-1111-111111111111', title: 'Test issue' }
    });
    // Proxy token auth and scope check should pass — we should not get
    // our own 403 (scope error). A 401 from upstream Linear is expected
    // since test-token isn't a real Linear token.
    expect(resp.status()).not.toBe(403);
    if (resp.status() === 401) {
      const data = await resp.json();
      expect(data.error).not.toContain('Invalid or missing proxy token');
    }
  });

  test('write endpoint validates required fields', async ({ request }) => {
    // Missing title
    const resp = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { teamId: '11111111-1111-1111-1111-111111111111' }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('title');
  });

  test('write endpoint requires teamId but accepts symbolic refs (LIN-556)', async ({ request }) => {
    // Presence is still enforced: a missing teamId fails fast with 400.
    const missing = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { title: 'Test' }
    });
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error).toContain('teamId');

    // A non-UUID teamId is no longer a format rejection (LIN-556): it is treated
    // as a symbolic team ref (key/name) and resolved against the provider. The
    // test token can't reach Linear, so the resolution read fails upstream — we
    // only assert it is NOT the old 400 format rejection and not our own token
    // error (mirrors the read-write scope test above).
    const symbolic = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { teamId: 'LIN', title: 'Test' }
    });
    expect(symbolic.status()).not.toBe(400);
    if (symbolic.status() === 401) {
      expect((await symbolic.json()).error).not.toContain('Invalid or missing proxy token');
    }
  });

  test('search endpoint validates query parameter', async ({ request }) => {
    const resp = await request.get('/api/proxy/search', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('q');
  });

  test('issue detail validates ID format', async ({ request }) => {
    const resp = await request.get('/api/proxy/issues/not-valid!!!', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
  });

  test('states endpoint validates team ID format', async ({ request }) => {
    const resp = await request.get('/api/proxy/states/not-a-uuid', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
  });

  test('comment endpoint validates body', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/comments', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {}
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('body');
  });

  test('description/append requires write scope', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/description/append', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { block: 'note' }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('description/append validates block', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/description/append', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: {}
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('block');
  });

  test('description/replace requires write scope', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/description/replace', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { oldString: 'a', newString: 'b' }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('description/replace validates oldString and newString', async ({ request }) => {
    const missingOld = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/description/replace', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { newString: 'b' }
    });
    expect(missingOld.status()).toBe(400);
    expect((await missingOld.json()).error).toContain('oldString');

    const missingNew = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/description/replace', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { oldString: 'a' }
    });
    expect(missingNew.status()).toBe(400);
    expect((await missingNew.json()).error).toContain('newString');
  });

  test('relation endpoint validates type', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/relations', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { type: 'invalid', relatedIssueId: '22222222-2222-2222-2222-222222222222' }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('type');
  });

  test('delete relation endpoint validates relationId format', async ({ request }) => {
    const resp = await request.delete('/api/proxy/issues/11111111-1111-1111-1111-111111111111/relations/not-a-uuid', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('relation ID');
  });

  test('delete relation endpoint requires write scope', async ({ request }) => {
    const resp = await request.delete('/api/proxy/issues/11111111-1111-1111-1111-111111111111/relations/22222222-2222-2222-2222-222222222222', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('label add requires labelId but accepts a label name (LIN-556)', async ({ request }) => {
    // Presence is still enforced: a missing labelId fails fast with 400.
    const missing = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/labels', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {}
    });
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error).toContain('labelId');

    // A non-UUID labelId is no longer a format rejection (LIN-556): it is treated
    // as a label name and resolved against the provider. The test token can't
    // reach Linear, so we only assert it is NOT the old 400 format rejection.
    const named = await request.post('/api/proxy/issues/11111111-1111-1111-1111-111111111111/labels', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { labelId: 'bug' }
    });
    expect(named.status()).not.toBe(400);
  });

  test('update endpoint requires valid fields', async ({ request }) => {
    const resp = await request.patch('/api/proxy/issues/11111111-1111-1111-1111-111111111111', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {}
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('No valid fields');
  });

  test('cycles endpoint validates teamId format', async ({ request }) => {
    const resp = await request.get('/api/proxy/cycles?teamId=not-a-uuid', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('team ID');
  });

  test('cycle detail validates cycle ID format', async ({ request }) => {
    const resp = await request.get('/api/proxy/cycle/not-a-uuid', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('cycle ID');
  });

  test('instructions include cycles endpoints', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const text = await resp.text();
    // Canonical forms: the plural list and the plural by-id detail (LIN-528).
    // The singular /cycle/{id} still resolves as a forgiving alias but is no
    // longer documented in /instructions.
    expect(text).toContain('/api/proxy/cycles?');
    expect(text).toContain('/api/proxy/cycles/{cycleId}');
  });

  test('instructions include enhanced label info', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const text = await resp.text();
    // Label info is now surfaced via a sample JSON payload showing id/name/color fields.
    expect(text).toMatch(/labels.*\{.*id.*name.*color/s);
  });
});

// LIN-528 — Canonical nested issue-scoped routes plus forgiving flat aliases.
// Exercised over real HTTP through the full app so route-ordering collisions
// (a nested path shadowed by /issues/:issueId, or vice versa) would surface here
// where the isolated-router unit test cannot see them. Each pair is driven down a
// deterministic, network-free path so the assertion is stable: invalid-id 400s
// for the GraphQL-backed endpoints, test-mode "not found" 404s for the LLM ones.
test.describe('Proxy API - Route Aliases (LIN-528)', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    const readResp = await page.goto(`/test/create-proxy-token?scope=read&label=read-test&urlKey=${URL_KEY}`);
    readToken = (await readResp.json()).token;
    const writeResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=write-test&urlKey=${URL_KEY}`);
    writeToken = (await writeResp.json()).token;
  });

  // [canonical, alias] pairs with a probe URL each that short-circuits before any
  // upstream call, plus the expected shared status.
  const PAIRS = [
    { name: 'relations (read)', method: 'get', token: () => readToken, status: 400,
      canonical: '/api/proxy/issues/bad%20id/relations', alias: '/api/proxy/relations/bad%20id' },
    { name: 'comments (write)', method: 'post', token: () => writeToken, status: 400, body: { body: 'hi' },
      canonical: '/api/proxy/issues/bad%20id/comments', alias: '/api/proxy/comments/bad%20id' },
    { name: 'cycle detail', method: 'get', token: () => readToken, status: 400,
      canonical: '/api/proxy/cycles/not-a-uuid', alias: '/api/proxy/cycle/not-a-uuid' },
    { name: 'recommend', method: 'get', token: () => readToken, status: 404,
      canonical: '/api/proxy/issues/LIN-999999/recommend', alias: '/api/proxy/recommend/LIN-999999' },
    { name: 'recap', method: 'get', token: () => readToken, status: 404,
      canonical: '/api/proxy/issues/LIN-999999/recap', alias: '/api/proxy/recap/LIN-999999' },
    { name: 'brief', method: 'get', token: () => readToken, status: 404,
      canonical: '/api/proxy/issues/LIN-999999/brief', alias: '/api/proxy/brief/LIN-999999' },
    { name: 'prompt', method: 'get', token: () => readToken, status: 404,
      canonical: '/api/proxy/issues/LIN-999999/prompt/implement', alias: '/api/proxy/prompt/LIN-999999/implement' }
  ];

  for (const pair of PAIRS) {
    test(`${pair.name}: canonical + alias resolve to the same handler`, async ({ request }) => {
      const opts = { headers: { Authorization: `Bearer ${pair.token()}` } };
      if (pair.body) opts.data = pair.body;
      const canonical = await request[pair.method](pair.canonical, opts);
      const alias = await request[pair.method](pair.alias, opts);

      // Neither form may 404 at the routing layer — that would mean the path
      // didn't register (the canonical 404s below are handler-level, with a body).
      expect(canonical.status(), `canonical ${pair.canonical}`).toBe(pair.status);
      expect(alias.status(), `alias ${pair.alias}`).toBe(canonical.status());
      expect(await alias.json()).toEqual(await canonical.json());
    });
  }
});

test.describe('Proxy API - Single-Use Tokens', () => {
  test('single-use token is consumed after first use', async ({ page, request }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    const resp = await page.goto(`/test/create-proxy-token?scope=read&singleUse=true&label=single&urlKey=${URL_KEY}`);
    const data = await resp.json();
    const token = data.token;

    // First use should succeed
    const first = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(first.status()).toBe(200);

    // Second use should fail (consumed)
    const second = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(second.status()).toBe(401);
  });
});

test.describe('Proxy API - Event Logging', () => {
  test('proxy calls create events visible in event log', async ({ page, request }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-proxy-events?urlKey=${URL_KEY}`);

    // Create token
    const tokenResp = await page.goto(`/test/create-proxy-token?scope=read&label=events-test&urlKey=${URL_KEY}`);
    const { token } = await tokenResp.json();

    // Make a proxy call to generate an event
    await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Set session and check events API
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const eventsResp = await request.get(`${API_PREFIX}/events`, {
      headers: { Cookie: cookieHeader }
    });
    expect(eventsResp.status()).toBe(200);
    const eventsData = await eventsResp.json();
    expect(eventsData.items.length).toBeGreaterThan(0);
    expect(eventsData.items[0].endpoint).toBe('/api/proxy/instructions');
    expect(eventsData.items[0].tokenLabel).toBe('events-test');
  });
});

test.describe('Proxy API - Session Token Lookup', () => {
  test('getWorkspaceAccessToken finds token from session store', async ({ page, secondWorkerUrlKey }) => {
    // Set up a multi-workspace session so the per-worker second workspace exists.
    // This bypasses the test-mode shortcut (which only handles the first workspace)
    // and exercises the real session-scanning code path in getWorkspaceAccessToken
    await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}`);

    // Look up the token for the second workspace via the real session scan
    const resp = await page.goto(`/test/workspace-token/${secondWorkerUrlKey}`);
    const data = await resp.json();

    // Should find the access token stored by set-session
    expect(data.found).toBe(true);
  });

  test('getWorkspaceAccessToken returns null for unknown workspace', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);

    const resp = await page.goto('/test/workspace-token/nonexistent-workspace');
    const data = await resp.json();

    expect(data.found).toBe(false);
  });
});

test.describe('Proxy API - Dispatch', () => {
  let readToken;
  let writeToken;
  let consumerToken;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);

    const readResp = await page.goto(`/test/create-proxy-token?scope=read&label=dispatch-read&urlKey=${URL_KEY}`);
    readToken = (await readResp.json()).token;

    const writeResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=dispatch-write&urlKey=${URL_KEY}`);
    writeToken = (await writeResp.json()).token;

    // A consumer dispatch token lets the test play the runner (take + feedback).
    const consumerResp = await page.goto(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
    consumerToken = (await consumerResp.json()).token;
  });

  test('read-only token cannot enqueue (403)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'do the thing' }
    });
    expect(resp.status()).toBe(403);
  });

  test('enqueue requires a prompt (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { promptName: 'no prompt here' }
    });
    expect(resp.status()).toBe(400);
  });

  test('enqueue rejects invalid target (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'x', target: 'local' }
    });
    expect(resp.status()).toBe(400);
  });

  test('enqueue rejects a non-UUID followUpTo (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'resume please', followUpTo: 'nope' }
    });
    expect(resp.status()).toBe(400);
  });

  test('enqueue rejects followUpTo for a dash target (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'resume please', target: 'dash', followUpTo: '11111111-1111-4111-8111-111111111111' }
    });
    expect(resp.status()).toBe(400);
  });

  test('follow-up: enqueue, then enqueue a second referencing it; watch surfaces followUpTo', async ({ request }) => {
    // 1. Dispatch the original item.
    const original = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'implement the thing', target: 'cli' }
    });
    expect(original.status()).toBe(201);
    const originalId = (await original.json()).id;

    // 2. Dispatch a follow-up pointing at the original's id.
    const followUp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'now confirm CI is green', target: 'cli', followUpTo: originalId }
    });
    expect(followUp.status()).toBe(201);
    const followUpId = (await followUp.json()).id;

    // The watch endpoint surfaces the linkage for observability.
    const watch = await request.get(`/api/proxy/dispatch/${followUpId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    expect((await watch.json()).followUpTo).toBe(originalId);
  });

  // Force-resume flag (LIN-559): a follow-up may carry force:true to override the
  // runner's active-session guard. Only meaningful with followUpTo.
  test('force: a follow-up with force:true surfaces force on the watched item', async ({ request }) => {
    // 1. Dispatch the original item.
    const original = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'implement the thing', target: 'cli' }
    });
    expect(original.status()).toBe(201);
    const originalId = (await original.json()).id;

    // 2. Dispatch a force follow-up pointing at the original's id.
    const followUp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'pick this back up', target: 'cli', followUpTo: originalId, force: true }
    });
    expect(followUp.status()).toBe(201);
    const followUpId = (await followUp.json()).id;

    // The watch endpoint surfaces force for observability; the original reads false.
    const watch = await request.get(`/api/proxy/dispatch/${followUpId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    expect((await watch.json()).force).toBe(true);

    const watchOriginal = await request.get(`/api/proxy/dispatch/${originalId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect((await watchOriginal.json()).force).toBe(false);
  });

  test('force requires followUpTo (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'resume please', force: true }
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('force requires followUpTo');
  });

  test('force rejects a non-boolean value (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'resume please', followUpTo: '11111111-1111-4111-8111-111111111111', force: 'yes' }
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('force must be a boolean');
  });

  // Abort verb (LIN-743): an abort item carries abort:true + abortTo and no prompt.
  test('abort: enqueue without a prompt, then watch surfaces abort/abortTo', async ({ request }) => {
    // 1. Dispatch an original item on dash.
    const original = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'implement the thing', target: 'dash' }
    });
    expect(original.status()).toBe(201);
    const originalId = (await original.json()).id;

    // 2. Abort it with a cli abort item (no prompt) — eligibility is the abort
    //    item's own target, independent of the aborted session's substrate.
    const abortResp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { abort: true, abortTo: originalId, target: 'cli' }
    });
    expect(abortResp.status()).toBe(201);
    const abortBody = await abortResp.json();
    expect(abortBody.abort).toBe(true);
    expect(abortBody.abortTo).toBe(originalId);
    const abortId = abortBody.id;

    // The watch endpoint surfaces the verb for observability.
    const watch = await request.get(`/api/proxy/dispatch/${abortId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.abort).toBe(true);
    expect(watched.abortTo).toBe(originalId);
  });

  test('abort requires abortTo (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { abort: true }
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('abortTo');
  });

  test('abort rejects a non-UUID abortTo (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { abort: true, abortTo: 'nope' }
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('abortTo');
  });

  test('abort rejects being combined with followUpTo (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: {
        abort: true,
        abortTo: '11111111-1111-4111-8111-111111111111',
        followUpTo: '22222222-2222-4222-8222-222222222222'
      }
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('mutually exclusive');
  });

  test('enqueue then watch reports queued with no feedback', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'review the README', promptName: 'review', issueIdentifier: 'LIN-1', target: 'cli' }
    });
    expect(enqueue.status()).toBe(201);
    const created = await enqueue.json();
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('queued');
    expect(created.target).toBe('cli');

    const watch = await request.get(`/api/proxy/dispatch/${created.id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.id).toBe(created.id);
    expect(watched.status).toBe('queued');
    expect(watched.issueIdentifier).toBe('LIN-1');
    expect(watched.feedback).toEqual([]);
  });

  test('watch reflects taken status and runner feedback', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'fix the typo' }
    });
    const { id } = await enqueue.json();

    // Runner claims the item, then posts feedback (the loop's return leg).
    const take = await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    expect(take.status()).toBe(200);

    const feedback = await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: 'Done — opened PR #42', url: 'https://github.com/x/y/pull/42', urlLabel: 'PR #42' }
    });
    expect(feedback.status()).toBe(200);

    const watch = await request.get(`/api/proxy/dispatch/${id}`, {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.status).toBe('taken');
    expect(watched.feedback).toHaveLength(1);
    expect(watched.feedback[0].message).toContain('opened PR #42');
    expect(watched.feedback[0].url).toContain('/pull/42');
  });

  test('watch surfaces a terminal status from the [done] feedback marker', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'run a retro', issueIdentifier: 'LIN-500' }
    });
    const { id } = await enqueue.json();
    await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });

    // Progress entry keeps the item 'taken' — only a bracketed terminal marker flips it.
    await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[working] Session launched' }
    });
    let watched = await (await request.get(`/api/proxy/dispatch/${id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.status).toBe('taken');
    // completedAt is null until a terminal marker exists (LIN-400).
    expect(watched.completedAt).toBeNull();

    // Runner posts the terminal event last.
    await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[done] Task completed in 45s' }
    });
    watched = await (await request.get(`/api/proxy/dispatch/${id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.status).toBe('done');
    // Feedback stream is untouched — the recap/detail is still all there.
    expect(watched.feedback).toHaveLength(2);
    // completedAt is the timestamp of the terminal feedback entry — the real
    // completion time, distinct from resolvedAt (take time).
    const terminalEntry = watched.feedback[watched.feedback.length - 1];
    expect(watched.completedAt).toBe(terminalEntry.timestamp);
    expect(watched.completedAt).not.toBeNull();

    // The derived status is filterable in the list endpoint too.
    const doneList = await (await request.get('/api/proxy/dispatch?status=done', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    const listed = doneList.items.find(i => i.id === id);
    expect(listed).toBeTruthy();
    expect(doneList.items.every(i => i.status === 'done')).toBe(true);
    // List endpoint surfaces completedAt too.
    expect(listed.completedAt).toBe(terminalEntry.timestamp);
  });

  // LIN-1461: a consumer that dispatched the ORIGINAL item and keeps watching
  // it by that id must not go "dark" the instant a follow-up repoints the
  // session onto a new item id — the runner's next feedback (including the
  // terminal marker) lands on the follow-up's own history doc, not the
  // original's, so the watch endpoint must resolve the whole session's
  // activity via the durable sessionGroupId rather than the queried item's
  // own frozen feedback[]. Every real feedback POST carries `rootItemId`
  // (simple-dispatcher reapers.js/hook.js/feedback.js tag every post with
  // `session.rootItemId || itemMetadata.itemId`) — set it here too, matching
  // production, since the merge is now SCOPED to the queried item's rootItemId
  // lineage rather than the whole sessionGroupId family (LIN-1461 rework; see
  // the sibling-isolation test below for why the wider scope regressed).
  test('watch on the ORIGINAL id sees feedback (and the terminal marker) posted to a REPOINTED follow-up', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'implement the thing', target: 'cli' }
    });
    const originalId = (await enqueue.json()).id;
    await request.post(`/api/dispatch/take/${originalId}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    await request.post(`/api/dispatch/feedback/${originalId}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[working] Session launched', rootItemId: originalId }
    });

    // A watcher polling the original id sees the pre-follow-up activity.
    let watched = await (await request.get(`/api/proxy/dispatch/${originalId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.status).toBe('taken');
    expect(watched.feedback).toHaveLength(1);

    // The session repoints: a follow-up dispatch references the original id,
    // gets taken, and the runner posts its terminal marker THERE — never
    // again touching the original item's own doc.
    const followUp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'now confirm CI is green', target: 'cli', followUpTo: originalId }
    });
    const followUpId = (await followUp.json()).id;
    await request.post(`/api/dispatch/take/${followUpId}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    await request.post(`/api/dispatch/feedback/${followUpId}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      // The runner's rootItemId ALWAYS carries the ORIGINAL dispatch id, even
      // on a repointed follow-up item — that's what keeps this lineage's
      // entries findable regardless of which item id they're filed under.
      data: { message: '[done] CI is green', rootItemId: originalId }
    });

    // The watcher never stopped polling the ORIGINAL id — it must see BOTH
    // the pre-repoint feedback and the follow-up's terminal marker, and
    // derive the session as done, not stuck reading 'taken' forever (the
    // LIN-1461 "gone dark" symptom).
    watched = await (await request.get(`/api/proxy/dispatch/${originalId}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.id).toBe(originalId);
    expect(watched.feedback).toHaveLength(2);
    expect(watched.feedback[0].message).toBe('[working] Session launched');
    expect(watched.feedback[1].message).toBe('[done] CI is green');
    expect(watched.status).toBe('done');
    expect(watched.completedAt).not.toBeNull();
  });

  // LIN-1461 rework: the class of regression the request-changes review
  // caught. `sessionGroupId` falls back to `sessionId` (dispatch-store.js),
  // and every worker an autopilot orchestrator spawns carries `sessionId` ==
  // the orchestrator's own id (docs/autopilot-kickoff.md) — so ALL sibling
  // workers in one run share ONE sessionGroupId, with NO followUpTo between
  // them. A merge scoped only to sessionGroupId pulls a finished sibling's
  // feedback (and terminal marker) into a still-running sibling's watch
  // response. rootItemId (distinct per runner session) must keep them apart.
  test('watch on one autopilot WORKER does not absorb a SIBLING worker\'s feedback or terminal marker', async ({ request }) => {
    const sessionId = (await (await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'orchestrate', target: 'cli', kind: 'autopilot' }
    })).json()).id;

    const dispatchWorker = async (prompt) => {
      const res = await request.post('/api/proxy/dispatch', {
        headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        data: { prompt, target: 'cli', sessionId }
      });
      const { id } = await res.json();
      await request.post(`/api/dispatch/take/${id}`, { headers: { Authorization: `Bearer ${consumerToken}` } });
      return id;
    };

    const workerA = await dispatchWorker('worker A: long task');
    const workerB = await dispatchWorker('worker B: short task');

    // Both workers post feedback tagged with THEIR OWN rootItemId (each is a
    // distinct runner session) — worker A is still going, worker B finishes.
    await request.post(`/api/dispatch/feedback/${workerA}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[heartbeat] worker A still working', rootItemId: workerA }
    });
    await request.post(`/api/dispatch/feedback/${workerB}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[done] worker B finished', rootItemId: workerB }
    });

    // Watching worker A must show ONLY worker A's own feedback, stay 'taken',
    // and must NOT report worker B's completedAt.
    const watchedA = await (await request.get(`/api/proxy/dispatch/${workerA}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watchedA.id).toBe(workerA);
    expect(watchedA.feedback).toHaveLength(1);
    expect(watchedA.feedback[0].message).toBe('[heartbeat] worker A still working');
    expect(watchedA.status).toBe('taken');
    expect(watchedA.completedAt).toBeNull();

    // Worker B independently shows as done, unaffected by worker A.
    const watchedB = await (await request.get(`/api/proxy/dispatch/${workerB}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watchedB.feedback).toHaveLength(1);
    expect(watchedB.feedback[0].message).toBe('[done] worker B finished');
    expect(watchedB.status).toBe('done');
  });

  test('list endpoint scopes by issueIdentifier (store pushdown, LIN-615)', async ({ request }) => {
    // Two queued items on different issues + one on the target with history.
    const targetIssue = 'LIN-6150';
    const otherIssue = 'LIN-6151';

    const a = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'work the target', promptName: 'plan', issueIdentifier: targetIssue, target: 'cli' }
    });
    expect(a.status()).toBe(201);

    const b = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'work elsewhere', promptName: 'plan', issueIdentifier: otherIssue, target: 'cli' }
    });
    expect(b.status()).toBe(201);

    // A third on the target, driven to terminal history so the history read is
    // exercised by the scope too (the queued + history merge both filter).
    const c = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'finish the target', promptName: 'implementation', issueIdentifier: targetIssue, target: 'cli' }
    });
    const cId = (await c.json()).id;
    await request.post(`/api/dispatch/take/${cId}`, { headers: { Authorization: `Bearer ${consumerToken}` } });
    await request.post(`/api/dispatch/feedback/${cId}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[done] shipped the target' }
    });

    // Scoped read: only the target issue's items come back.
    const scoped = await (await request.get(`/api/proxy/dispatch?issueIdentifier=${targetIssue}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(scoped.items.length).toBe(2);
    expect(scoped.items.every(i => i.issueIdentifier === targetIssue)).toBe(true);
    expect(scoped.items.some(i => i.issueIdentifier === otherIssue)).toBe(false);

    // The derived status filter still composes with the issue scope.
    const scopedDone = await (await request.get(`/api/proxy/dispatch?issueIdentifier=${targetIssue}&status=done`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(scopedDone.items.length).toBe(1);
    expect(scopedDone.items[0].id).toBe(cId);
    expect(scopedDone.items[0].status).toBe('done');

    // Unscoped read still sees everything (no accidental global narrowing).
    const all = await (await request.get('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(all.items.some(i => i.issueIdentifier === otherIssue)).toBe(true);
    expect(all.items.length).toBeGreaterThanOrEqual(3);
  });

  test('watch surfaces a failed status from the [failed] feedback marker', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'dispatch to web' }
    });
    const { id } = await enqueue.json();
    await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[failed] remote-control never connected (command not accepted)' }
    });

    const watched = await (await request.get(`/api/proxy/dispatch/${id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.status).toBe('failed');
  });

  // ---- Long-poll (?wait=Ns), LIN-392 -------------------------------------

  test('?wait returns early the instant feedback arrives (no sleep/backoff)', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'long task', issueIdentifier: 'LIN-392' }
    });
    const { id } = await enqueue.json();
    await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });

    // Start a long-poll, then post a terminal marker shortly after. The held
    // request should return promptly (well under its cap), not wait it out.
    const started = Date.now();
    const watchPromise = request.get(`/api/proxy/dispatch/${id}?wait=10`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    // Give the handler time to do its first (non-terminal) read and arm the wait.
    await new Promise(r => setTimeout(r, 500));
    await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[done] landed in 3s' }
    });

    const watched = await (await watchPromise).json();
    const elapsed = Date.now() - started;
    expect(watched.status).toBe('done');
    expect(elapsed).toBeLessThan(8000); // returned on the change, not at the 10s cap
    // Legibility: the response says WHY it came back.
    expect(watched.reason).toBe('change');
    expect(watched.waitedMs).toBeGreaterThanOrEqual(0);
    expect(watched.waitedMs).toBeLessThan(10000); // well under the cap
  });

  test('?wait short-circuits immediately on an already-terminal item', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'already finished' }
    });
    const { id } = await enqueue.json();
    await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    await request.post(`/api/dispatch/feedback/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: '[done] finished before the watch started' }
    });

    // Even with a long cap, an already-terminal item returns at once — re-checking
    // a finished item never incurs the hold.
    const started = Date.now();
    const watched = await (await request.get(`/api/proxy/dispatch/${id}?wait=30`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    const elapsed = Date.now() - started;
    expect(watched.status).toBe('done');
    expect(elapsed).toBeLessThan(3000);
    // Short-circuit is legible too: terminal, no hold.
    expect(watched.reason).toBe('terminal');
    expect(watched.waitedMs).toBe(0);
  });

  test('?wait returns the current snapshot at the cap when nothing changes', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'quiet task', issueIdentifier: 'LIN-393' }
    });
    const { id } = await enqueue.json();

    // No transition during the window → resolves at the (short) cap with the
    // current snapshot so the caller simply loops again.
    const started = Date.now();
    const watched = await (await request.get(`/api/proxy/dispatch/${id}?wait=2`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    const elapsed = Date.now() - started;
    expect(watched.status).toBe('queued');
    expect(watched.issueIdentifier).toBe('LIN-393');
    expect(elapsed).toBeGreaterThanOrEqual(1500); // it actually held
    // The cap-elapsed return is now self-describing: held the full window, nothing new.
    expect(watched.reason).toBe('timeout');
    expect(watched.waitedMs).toBeGreaterThanOrEqual(1500);
  });

  test('invalid / absent ?wait falls back to the immediate short-poll', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'short poll please', issueIdentifier: 'LIN-394' }
    });
    const { id } = await enqueue.json();

    for (const qs of ['', '?wait=0', '?wait=abc', '?wait=-5']) {
      const started = Date.now();
      const watched = await (await request.get(`/api/proxy/dispatch/${id}${qs}`, {
        headers: { Authorization: `Bearer ${readToken}` }
      })).json();
      expect(watched.status).toBe('queued');
      expect(Date.now() - started).toBeLessThan(1500); // never held
      // Short-poll stays byte-identical to the pre-?wait contract: no legibility fields.
      expect(watched.reason).toBeUndefined();
      expect(watched.waitedMs).toBeUndefined();
    }
  });

  test('list finds items by issueIdentifier across queue and history', async ({ request }) => {
    // One item left queued, one taken — the list should surface both and
    // filtering by issueIdentifier should narrow to the right one.
    const a = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'queued task', issueIdentifier: 'LIN-288' }
    });
    const aId = (await a.json()).id;

    const b = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'taken task', issueIdentifier: 'LIN-999' }
    });
    const bId = (await b.json()).id;
    await request.post(`/api/dispatch/take/${bId}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    await request.post(`/api/dispatch/feedback/${bId}`, {
      headers: { Authorization: `Bearer ${consumerToken}`, 'Content-Type': 'application/json' },
      data: { message: 'done' }
    });

    // Unfiltered: both present.
    const all = await request.get('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const allData = await all.json();
    const ids = allData.items.map(i => i.id);
    expect(ids).toContain(aId);
    expect(ids).toContain(bId);

    // Filter by identifier resolves the id from just the issue.
    const filtered = await request.get('/api/proxy/dispatch?issueIdentifier=LIN-288', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const filteredData = await filtered.json();
    expect(filteredData.items).toHaveLength(1);
    expect(filteredData.items[0].id).toBe(aId);
    expect(filteredData.items[0].status).toBe('queued');

    // Status filter narrows to the taken item, with feedback counted.
    const taken = await request.get('/api/proxy/dispatch?status=taken', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const takenData = await taken.json();
    expect(takenData.items.every(i => i.status === 'taken')).toBe(true);
    const bRow = takenData.items.find(i => i.id === bId);
    expect(bRow).toBeTruthy();
    expect(bRow.feedbackCount).toBe(1);
  });

  test('appends proxy context to the dispatched prompt by default', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'fix the bug', issueIdentifier: 'LIN-288' }
    });
    const { id } = await enqueue.json();

    // The runner sees the augmented prompt when it takes the item.
    const take = await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    const { item } = await take.json();
    expect(item.prompt).toContain('fix the bug');
    expect(item.prompt).toContain('Workspace API access');
    expect(item.prompt).toContain('/api/proxy/instructions');
    // Starting context is the distilled brief, not the raw issue dump (LIN-260).
    expect(item.prompt).toContain('/api/proxy/brief/LIN-288');
    // LIN-1159: a no-harness dispatch now defaults to claude-code, so the common
    // path takes LIN-1155's MCP token-field flow — the bootstrap travels as the
    // `bootstrapToken` field and the prompt stays credential-free (no token, no
    // curl exchange, no /api/proxy/token prose).
    expect(item.harness).toBe('claude-code');
    expect(typeof item.bootstrapToken).toBe('string');
    expect(item.bootstrapToken.length).toBeGreaterThan(0);
    expect(item.bootstrapToken).not.toBe(writeToken);
    expect(item.prompt).toContain('HARBOUR_LOCAL_BASE');
    expect(item.prompt).not.toContain('curl -X POST');
    expect(item.prompt).not.toContain('/api/proxy/token');
    // LIN-376: the caller's own standing token is NEVER replayed into the prompt,
    // and neither is the minted bootstrap.
    expect(item.prompt).not.toContain(writeToken);
    expect(item.prompt).not.toContain(item.bootstrapToken);
    // Reporting is the runner's Stop hook, not the prompt — but the evidence
    // discipline for the final summary is still taught at source.
    expect(item.prompt).toContain('evidence');
    expect(item.prompt).not.toContain('/api/proxy/agent/status');
    expect(item.prompt).not.toContain('/api/proxy/foreman/status');
  });

  test('claude-code harness: token travels as a field, not in the prompt (LIN-1155)', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'fix the bug', issueIdentifier: 'LIN-288', harness: 'claude-code' }
    });
    const { id } = await enqueue.json();

    // The proxy WATCH endpoint must NOT expose the live credential (allowlist).
    const watch = await request.get(`/api/proxy/dispatch/${id}`, {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    const watchBody = await watch.json();
    expect(watchBody.bootstrapToken).toBeUndefined();

    // The runner claims the item and receives the token as a structured field.
    const take = await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    const { item } = await take.json();
    expect(item.harness).toBe('claude-code');
    // Structured field carries a real, non-empty bootstrap (not the caller's token).
    expect(typeof item.bootstrapToken).toBe('string');
    expect(item.bootstrapToken.length).toBeGreaterThan(0);
    expect(item.bootstrapToken).not.toBe(writeToken);
    // The prompt keeps the access guidance but carries NO token / curl exchange.
    expect(item.prompt).toContain('fix the bug');
    expect(item.prompt).toContain('Workspace API access');
    expect(item.prompt).toContain('HARBOUR_LOCAL_BASE');
    expect(item.prompt).not.toContain('curl -X POST');
    expect(item.prompt).not.toContain(item.bootstrapToken);
    expect(item.prompt).not.toContain(writeToken);
  });

  test('auto-append uses generic endpoints when there is no issueIdentifier', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'run a retro', promptName: 'Retro' } // no issueIdentifier
    });
    const { id } = await enqueue.json();
    const take = await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    const { item } = await take.json();
    expect(item.prompt).toContain('Workspace API access');
    // No malformed "/issues/your task" with a literal space.
    expect(item.prompt).not.toContain('your task');
    expect(item.prompt).not.toMatch(/issues\/\S+ \S+\)/);
    // Falls back to generic discovery endpoints instead.
    expect(item.prompt).toContain('/api/proxy/stack');
  });

  test('appendProxyContext:false leaves the prompt untouched', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'self-contained prompt', appendProxyContext: false }
    });
    const { id } = await enqueue.json();

    const take = await request.post(`/api/dispatch/take/${id}`, {
      headers: { Authorization: `Bearer ${consumerToken}` }
    });
    const { item } = await take.json();
    expect(item.prompt).toBe('self-contained prompt');
    expect(item.prompt).not.toContain('Workspace API access');
    // LIN-1429 (cell #5, the near-drift): no `harness` here defaults to
    // claude-code (LIN-1159), so an explicit opt-out must ALSO suppress
    // provisioning, not just the prose — a credential with no channel to
    // reach the worker would otherwise be minted and stranded.
    expect(item.bootstrapToken).toBeNull();
  });

  test('watch returns 404 for unknown id', async ({ request }) => {
    const resp = await request.get('/api/proxy/dispatch/00000000-0000-0000-0000-000000000000', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(404);
  });

  test('read-write instructions advertise the dispatch endpoints', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    const text = await resp.text();
    expect(text).toContain('Dispatch Endpoints');
    expect(text).toContain('/api/proxy/dispatch');
  });

  test('explicit kind round-trips through enqueue, watch, and list', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'plan it out', promptName: 'Custom', kind: 'research', issueIdentifier: 'LIN-319' }
    });
    expect(enqueue.status()).toBe(201);
    const created = await enqueue.json();
    // The explicit kind wins over what promptName would derive ('Custom' → 'custom').
    expect(created.kind).toBe('research');

    const watched = await (await request.get(`/api/proxy/dispatch/${created.id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.kind).toBe('research');

    const listed = await (await request.get('/api/proxy/dispatch?issueIdentifier=LIN-319', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].kind).toBe('research');
  });

  test('kind defaults from promptName when omitted', async ({ request }) => {
    // 'implement' is the display name of the 'implementation' template key.
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'do it', promptName: 'implement', issueIdentifier: 'LIN-700' }
    });
    const created = await enqueue.json();
    expect(created.kind).toBe('implementation');

    const watched = await (await request.get(`/api/proxy/dispatch/${created.id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(watched.kind).toBe('implementation');
  });

  test('kind falls back to custom for unrecognised promptName', async ({ request }) => {
    const enqueue = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'freeform task', promptName: 'Custom' }
    });
    const created = await enqueue.json();
    expect(created.kind).toBe('custom');
  });

  test('enqueue rejects an invalid kind (400)', async ({ request }) => {
    const resp = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { prompt: 'x', kind: 'not-a-real-kind' }
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('kind must be one of');
  });
});

test.describe('Proxy API - Recommend-and-Dispatch (fused verb, LIN-321)', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);

    const readResp = await page.goto(`/test/create-proxy-token?scope=read&label=fused-read&urlKey=${URL_KEY}`);
    readToken = (await readResp.json()).token;

    const writeResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=fused-write&urlKey=${URL_KEY}`);
    writeToken = (await writeResp.json()).token;
  });

  test('read-only token cannot trigger (403)', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14' }
    });
    expect(resp.status()).toBe(403);
  });

  test('missing issueIdentifier gets 400', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { target: 'cli' }
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('issueIdentifier');
  });

  test('invalid target gets 400', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', target: 'local' }
    });
    expect(resp.status()).toBe(400);
  });

  test('happy path returns the task header with NO prompt body, and the item is watchable', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', target: 'cli' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    expect(created.id).toBeTruthy();
    expect(created.status).toBe('queued');
    expect(created.promptName).toBeTruthy();
    expect(created.target).toBe('cli');
    expect(created.issueIdentifier).toBe('TEST-14');
    // The whole point of the verb: the prompt never reaches the caller.
    expect(created.prompt).toBeUndefined();

    // The dispatched item is watchable like any other dispatch.
    const watch = await request.get(`/api/proxy/dispatch/${created.id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.id).toBe(created.id);
    expect(watched.status).toBe('queued');
    expect(watched.issueIdentifier).toBe('TEST-14');
  });

  test('inherits the server-resolved repo when the caller omits repo (LIN-537)', async ({ request }) => {
    // TEST-14 lives in proj-alpha, whose description carries `repo=test-repo`.
    // The fused verb resolves that repo server-side (rec.repo) and must stamp it
    // on the dispatched item so the worker runs in the right folder.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    // Read the queued item back via the consumer poll, which surfaces repo.
    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('test-repo');
  });

  test('an explicit caller repo overrides the resolved repo (LIN-537)', async ({ request }) => {
    // Caller precedence must be preserved: an explicit repo wins over the
    // project-resolved repo (test-repo), it is not silently overwritten.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', repo: 'caller-override' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('caller-override');
  });

  // LIN-1210: repo context must switch to the descended CHILD's repo when the
  // caller's repo was merely INHERITED (an orchestrator forwarding a parent
  // project's repo onto a cross-project fan-out), while a genuinely user-explicit
  // caller repo still wins unchanged (the LIN-537 invariant).
  test('descent: an inherited caller repo yields to the descended child\'s repo (LIN-1210)', async ({ request }) => {
    // TEST-1 (proj-alpha) descends to its actionable child TEST-2, whose project
    // resolves repo=test-repo (rec.repo). The caller forwards a DIFFERENT repo it
    // merely inherited from the parent context and marks it repoInherited:true, so
    // the child's resolved repo must win — the worker runs in the child's codebase.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1', repo: 'inherited-parent-repo', repoInherited: true }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    // Sanity: this really is the cross-project descent path (dispatches the child).
    expect(created.issueIdentifier).toBe('TEST-2');

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    // Child's resolved repo wins; the inherited parent repo does NOT mask it.
    expect(queued.repo).toBe('test-repo');
    expect(queued.repo).not.toBe('inherited-parent-repo');
  });

  test('descent: a genuine cross-PROJECT child dispatches with the child project\'s repo, not the inherited parent repo (LIN-1210)', async ({ request }) => {
    // The literal reported scenario, end-to-end (not by composition): TEST-30 is a
    // container in proj-alpha (repo=test-repo); its actionable child TEST-31 lives in
    // a DIFFERENT project, proj-gamma (repo=gamma-repo). An orchestrator forwards the
    // PARENT project's repo (test-repo) it merely inherited and marks it
    // repoInherited:true. Because the descent crosses into proj-gamma, the terminal
    // rec.repo resolves to gamma-repo — from a project other than the parent's — and
    // must win. This is the case the same-project TEST-1→TEST-2 fixture could not prove.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-30', repo: 'test-repo', repoInherited: true }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    // The descent really crossed projects: it dispatched the gamma-project child.
    expect(created.issueIdentifier).toBe('TEST-31');

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    // The child's OWN project repo wins; the inherited parent-project repo does not
    // mask it — the worker runs in the child's codebase (gamma-repo), not the parent's.
    expect(queued.repo).toBe('gamma-repo');
    expect(queued.repo).not.toBe('test-repo');
  });

  test('descent: a user-explicit caller repo still wins over the child repo (LIN-1210 preserves LIN-537)', async ({ request }) => {
    // Same descent, but WITHOUT the inherited marker: the caller deliberately chose
    // this repo for this dispatch, so it must still override the child's rec.repo.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1', repo: 'explicit-caller-repo' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    expect(created.issueIdentifier).toBe('TEST-2');

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('explicit-caller-repo');
  });

  test('verb-override: an inherited caller repo yields to the node\'s own project repo (LIN-1210)', async ({ request }) => {
    // The verb-override branch (kind pinned, no descent) has the same precedence
    // seam. TEST-14 lives in proj-alpha (repo=test-repo); an inherited caller repo
    // marked repoInherited:true must yield to the node's own project repo.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', kind: 'implementation', repo: 'inherited-parent-repo', repoInherited: true }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('test-repo');
    expect(queued.repo).not.toBe('inherited-parent-repo');
  });

  test('verb-override: a repo-less node falls back to the inherited caller repo (LIN-1210)', async ({ request }) => {
    // TEST-4 lives in proj-beta, which has no `repo=` line (null derived repo). An
    // inherited caller repo is still used — a repo-less child stays unchanged.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-4', kind: 'implementation', repo: 'inherited-parent-repo', repoInherited: true }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('inherited-parent-repo');
  });

  test('rejects a non-boolean repoInherited with 400 (LIN-1210)', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', repoInherited: 'yes' }
    });
    expect(resp.status()).toBe(400);
  });

  test('kind reflects the recommendation action (started issue → implementation)', async ({ request }) => {
    // TEST-14 has no labels and is In Progress → mock recommendedAction 'implement'
    // → deriveDispatchKind('implement') === 'implementation'.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    expect(created.kind).toBe('implementation');
  });

  test('kind reflects the recommendation action (bug issue → bug)', async ({ request }) => {
    // TEST-13 carries the 'bug' label → mock recommendedAction 'bug' → kind 'bug'.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-13' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    expect(created.kind).toBe('bug');
  });

  test('descends a container to its actionable child (LIN-327)', async ({ request }) => {
    // TEST-1 is an in-progress parent whose child TEST-2 is the actionable work.
    // The recommender defers TEST-1 → TEST-2; the recursion resolves it server-side
    // and dispatches the TERMINAL node's prompt, never a `defer`.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    // The dispatched item references the terminal node, not the parent the caller named.
    expect(created.issueIdentifier).toBe('TEST-2');
    expect(created.kind).not.toBe('defer'); // defer never reaches dispatch
    // The descent breadcrumb is auditable from the structured header.
    expect(created.deferredVia).toEqual(['TEST-1', 'TEST-2']);
    expect(created.deferTruncated).toBe(false);
    expect(created.descent).toContain('descended to TEST-2');
    // Still no prompt body — the verb's whole point.
    expect(created.prompt).toBeUndefined();
  });

  test('noDescend recommends and dispatches the parent itself, not its open child (LIN-365)', async ({ request }) => {
    // TEST-1 is an in-progress parent whose only open child (TEST-2) would normally be
    // descended into. With noDescend the verb must recommend TEST-1's OWN work and
    // dispatch against TEST-1 — making a parent's own work reachable while a child stays open.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1', noDescend: true }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    // Dispatched against the PARENT the caller named — no descent into TEST-2.
    expect(created.issueIdentifier).toBe('TEST-1');
    expect(created.kind).not.toBe('defer');
    expect(created.deferredVia).toEqual(['TEST-1']);   // single node ⇒ no descent
    expect(created.deferTruncated).toBe(false);
    expect(created.descent).toBeUndefined();           // no descent breadcrumb
    expect(created.prompt).toBeUndefined();
  });

  test('GET /recommend?noDescend=1 returns the named node, not its child (LIN-365)', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/TEST-1?noDescend=1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const rec = await resp.json();
    expect(rec.identifier).toBe('TEST-1');             // the parent, not TEST-2
    expect(rec.recommendedAction).not.toBe('defer');   // resolved to the parent's own work
    expect(rec.deferredVia).toEqual(['TEST-1']);        // no descent
    expect(rec.prompt).toBeTruthy();                    // the parent carries a real prompt
  });

  test('recommend-and-dispatch rejects a non-boolean noDescend (LIN-365)', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1', noDescend: 'yes' }
    });
    expect(resp.status()).toBe(400);
  });

  test('GET /recommend returns the terminal node and the descent path (LIN-327)', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/TEST-1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const rec = await resp.json();
    expect(rec.identifier).toBe('TEST-2');               // terminal, not the parent
    expect(rec.recommendedAction).not.toBe('defer');     // resolved to real work
    expect(rec.deferredVia).toEqual(['TEST-1', 'TEST-2']);
    expect(rec.prompt).toBeTruthy();                     // terminal node carries a prompt
  });

  test('LIN-316: GET /recommend?format=md returns the bare prompt as a markdown download', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/TEST-1?format=md', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('text/markdown');
    // Filename keys off the terminal identifier the descent resolves to (TEST-2).
    expect(resp.headers()['content-disposition']).toContain('attachment');
    expect(resp.headers()['content-disposition']).toContain('test-2-recommend.md');
    const body = await resp.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body.trimStart().startsWith('{')).toBe(false); // not a JSON envelope
  });

  test('LIN-316: GET /recommend without ?format=md still returns JSON', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/TEST-1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('application/json');
    const rec = await resp.json();
    expect(rec.prompt).toBeTruthy();
  });

  test('nonexistent issue gets 404', async ({ request }) => {
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
    });
    expect(resp.status()).toBe(404);
  });

  test('read-write instructions advertise the fused verb', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    const text = await resp.text();
    expect(text).toContain('/api/proxy/recommend-and-dispatch');
  });

  // ── Verb override (LIN-573): caller pins `kind`, server still writes the body ──

  test('kind override pins the verb and dispatches a server-generated body (LIN-573)', async ({ request }) => {
    // TEST-14 is In Progress (the LLM-driven path picks 'implement' → kind
    // 'implementation', see above). With kind='review' the caller pins the verb;
    // the engine is bypassed and the dispatched item carries kind 'review'.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', target: 'cli', kind: 'review' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    expect(created.id).toBeTruthy();
    expect(created.status).toBe('queued');
    expect(created.kind).toBe('review');          // the override, not 'implementation'
    expect(created.override).toBe(true);          // signals the deterministic path
    expect(created.issueIdentifier).toBe('TEST-14');
    expect(created.prompt).toBeUndefined();       // body still never returns to the caller

    // The body is server-generated and matches the deterministic /prompt seam.
    const promptResp = await request.get('/api/proxy/issues/TEST-14/prompt/review', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(promptResp.status()).toBe(200);
    const { prompt: expectedBody } = await promptResp.json();
    expect(expectedBody).toBeTruthy();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    // The dispatched prompt is the /prompt body (with the proxy-context preamble
    // appended) — proving the override reused the server-side generation seam.
    expect(queued.prompt.startsWith(expectedBody)).toBe(true);
  });

  test('kind override rejects body-less meta-kinds with 400 (LIN-573)', async ({ request }) => {
    // hasPrompt(), NOT isValidDispatchKind(), gates the override — so meta-kinds
    // that have no template body (defer/custom/autopilot/periodical) are refused
    // rather than dispatching an empty prompt.
    for (const badKind of ['defer', 'custom', 'autopilot', 'periodical', 'not-a-real-kind']) {
      const resp = await request.post('/api/proxy/recommend-and-dispatch', {
        headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        data: { issueIdentifier: 'TEST-14', kind: badKind }
      });
      expect(resp.status(), `kind='${badKind}' must be rejected`).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('kind');
    }
  });

  test('kind override bypasses descent — pins the named container, not its child (LIN-573)', async ({ request }) => {
    // TEST-1 is the container that the LLM-driven path descends into TEST-2.
    // The override pins the NAMED issue with no descent: the dispatched item
    // references TEST-1 and carries no descent breadcrumb.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-1', kind: 'plan' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    expect(created.issueIdentifier).toBe('TEST-1');   // no descent into TEST-2
    expect(created.kind).toBe('plan');
    expect(created.override).toBe(true);
    expect(created.deferredVia).toBeUndefined();        // engine bypassed → no descent path
    expect(created.descent).toBeUndefined();
    expect(created.prompt).toBeUndefined();
  });

  test('kind override still requires write scope (403) and rejects unknown issues (404) (LIN-573)', async ({ request }) => {
    const forbidden = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', kind: 'review' }
    });
    expect(forbidden.status()).toBe(403);

    const missing = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kind: 'review' }
    });
    expect(missing.status()).toBe(404);
  });

  test('kind override honours explicit repo over the resolved project repo (LIN-573)', async ({ request }) => {
    // Caller precedence (LIN-537) must survive on the override path too.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', kind: 'review', repo: 'caller-override' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('caller-override');
  });

  test('omitting kind preserves the LLM-driven path unchanged (LIN-573)', async ({ request }) => {
    // The no-override path must remain byte-identical: TEST-14 → engine picks
    // 'implement' → kind 'implementation', with no `override` flag on the body.
    const resp = await request.post('/api/proxy/recommend-and-dispatch', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', target: 'cli' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    expect(created.kind).toBe('implementation');
    expect(created.override).toBeUndefined();
  });
});

test.describe('Proxy API - Autopilot kickoff (fused launch verb, LIN-569)', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);

    const readResp = await page.goto(`/test/create-proxy-token?scope=read&label=autopilot-read&urlKey=${URL_KEY}`);
    readToken = (await readResp.json()).token;

    const writeResp = await page.goto(`/test/create-proxy-token?scope=readWrite&label=autopilot-write&urlKey=${URL_KEY}`);
    writeToken = (await writeResp.json()).token;
  });

  test('read-only token cannot launch (403)', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { goal: 'ship the thing' }
    });
    expect(resp.status()).toBe(403);
  });

  test('invalid mode gets 400', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { mode: 'sideways' }
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain('mode');
  });

  test('invalid target gets 400', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { target: 'local' }
    });
    expect(resp.status()).toBe(400);
  });

  test('general run: launches, returns id===sessionId, kind autopilot, NO prompt body, and is watchable', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { goal: 'clear the bug backlog', target: 'cli' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    expect(created.id).toBeTruthy();
    expect(created.sessionId).toBe(created.id);   // the dispatch id IS the session id
    expect(created.status).toBe('queued');
    expect(created.kind).toBe('autopilot');
    expect(created.mode).toBe('write');
    expect(created.target).toBe('cli');
    expect(created.issueIdentifier).toBeNull();
    // The fused verb never hands the prompt body back to the caller.
    expect(created.prompt).toBeUndefined();

    // The launched run is watchable like any other dispatch.
    const watch = await request.get(`/api/proxy/dispatch/${created.id}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(watch.status()).toBe(200);
    const watched = await watch.json();
    expect(watched.id).toBe(created.id);
    expect(watched.status).toBe('queued');
  });

  test('the dispatched prompt embeds the goal AND the session-id self-ref block (LIN-599)', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { goal: 'UNIQUE-GOAL-MARKER-569' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.kind).toBe('autopilot');
    // Goal made it into the kickoff body.
    expect(queued.prompt).toContain('UNIQUE-GOAL-MARKER-569');
    // addItem appended the session-id self-ref block naming this run's own id.
    expect(queued.prompt).toContain('Your autopilot session id');
    expect(queued.prompt).toContain(created.id);
    // appendProxyContext defaults on → the worker inherits Workspace API access.
    expect(queued.prompt).toContain('Workspace API access (auto-appended)');
  });

  test('scoped run: names the issue and inherits the project repo (LIN-537)', async ({ request }) => {
    // TEST-14 lives in proj-alpha, whose description carries `repo=test-repo`.
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    expect(created.issueIdentifier).toBe('TEST-14');
    expect(created.promptName).toContain('TEST-14');

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('test-repo');
  });

  test('an explicit caller repo overrides the resolved project repo (LIN-537)', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'TEST-14', repo: 'caller-override' }
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();

    const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
    const { token: dispatchToken } = await tokenResponse.json();
    const pollResp = await request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${dispatchToken}` }
    });
    const { items } = await pollResp.json();
    const queued = items.find(i => i.id === created.id);
    expect(queued).toBeTruthy();
    expect(queued.repo).toBe('caller-override');
  });

  test('scoped run with a nonexistent issue gets 404', async ({ request }) => {
    const resp = await request.post('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { issueIdentifier: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
    });
    expect(resp.status()).toBe(404);
  });

  test('read-write instructions advertise the fused launch verb', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    const text = await resp.text();
    expect(text).toContain('POST');
    expect(text).toContain('/api/proxy/autopilot/kickoff');
  });
});

// LIN-525 #2 (mint route is feature-gated) and #5 (prompt-proxy tokens get a
// short TTL so they self-prune instead of accumulating as standing readWrite
// credentials). Exercises the real session-auth mint route via page.request,
// which shares the browser context's session cookie.
test.describe('Proxy token mint — feature gate + prompt-proxy TTL (LIN-525)', () => {
  // Computed at call time: API_PREFIX is bound per-worker by the file-level
  // beforeEach (LIN-628), so the mint URL must be read inside the test bodies,
  // not captured at describe-eval time.
  const mintUrl = () => `${API_PREFIX}/tokens`;

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-proxy-tokens?urlKey=${URL_KEY}`);
  });

  test('mint is rejected (403) when the proxy feature is disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}&urlKey=${URL_KEY}`);
    const resp = await page.request.post(mintUrl(), {
      data: { label: 'prompt-proxy', scope: 'readWrite', singleUse: false }
    });
    expect(resp.status()).toBe(403);
  });

  // expiresAt isn't echoed in the create response, so read it back from the
  // token list (which carries it) by label.
  async function expiresAtFor(page, label) {
    const listResp = await page.request.get(mintUrl());
    expect(listResp.status()).toBe(200);
    const { tokens } = await listResp.json();
    const match = tokens.find(t => t.label === label);
    expect(match, `token labelled ${label} should be listed`).toBeTruthy();
    return new Date(match.expiresAt).getTime();
  }

  test('prompt-proxy token is minted with a short (~48h) TTL', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const resp = await page.request.post(mintUrl(), {
      data: { label: 'prompt-proxy', scope: 'readWrite', singleUse: false }
    });
    expect(resp.status()).toBe(201);
    const hours = (await expiresAtFor(page, 'prompt-proxy') - Date.now()) / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThan(49);
  });

  test('a normal (non prompt-proxy) token keeps the long default TTL', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}&urlKey=${URL_KEY}`);
    const resp = await page.request.post(mintUrl(), {
      data: { label: 'manual-token', scope: 'readWrite' }
    });
    expect(resp.status()).toBe(201);
    const days = (await expiresAtFor(page, 'manual-token') - Date.now()) / (24 * 60 * 60 * 1000);
    // Default is 90 days; assert it is clearly far longer than the 2-day prompt-proxy TTL.
    expect(days).toBeGreaterThan(30);
  });
});
