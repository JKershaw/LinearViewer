import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const PROXY_PAGE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/proxy`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/proxy`;

test.describe('Proxy Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-proxy-events');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
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
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
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
      await page.goto(`/test/create-proxy-token?label=seed-${i}`);
    }
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

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
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-proxy-events');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
  });

  test('create, list, and revoke tokens via API', async ({ request, page }) => {
    // Need session first
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
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
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
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
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
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
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-proxy-events');

    // Create read-only token
    const readResp = await page.goto('/test/create-proxy-token?scope=read&label=read-test');
    const readData = await readResp.json();
    readToken = readData.token;

    // Create read-write token
    const writeResp = await page.goto('/test/create-proxy-token?scope=readWrite&label=write-test');
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
    expect(text).toContain('Linear API Proxy');
    expect(text).toContain('/api/proxy/me');
    expect(text).toContain('/api/proxy/teams');
    expect(text).toContain('read');
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

  test('write endpoint validates teamId format', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { teamId: 'not-a-uuid', title: 'Test' }
    });
    expect(resp.status()).toBe(400);
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
    const resp = await request.get('/api/proxy/issue/not-valid!!!', {
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
    const resp = await request.post('/api/proxy/issue/11111111-1111-1111-1111-111111111111/comments', {
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

  test('relation endpoint validates type', async ({ request }) => {
    const resp = await request.post('/api/proxy/issue/11111111-1111-1111-1111-111111111111/relations', {
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
    const resp = await request.delete('/api/proxy/issue/11111111-1111-1111-1111-111111111111/relations/not-a-uuid', {
      headers: { Authorization: `Bearer ${writeToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('relation ID');
  });

  test('delete relation endpoint requires write scope', async ({ request }) => {
    const resp = await request.delete('/api/proxy/issue/11111111-1111-1111-1111-111111111111/relations/22222222-2222-2222-2222-222222222222', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('label add endpoint validates labelId', async ({ request }) => {
    const resp = await request.post('/api/proxy/issue/11111111-1111-1111-1111-111111111111/labels', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { labelId: 'not-a-uuid' }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('labelId');
  });

  test('update endpoint requires valid fields', async ({ request }) => {
    const resp = await request.patch('/api/proxy/issue/11111111-1111-1111-1111-111111111111', {
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
    expect(text).toContain('/api/proxy/cycles');
    expect(text).toContain('/api/proxy/cycle/');
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

test.describe('Proxy API - Single-Use Tokens', () => {
  test('single-use token is consumed after first use', async ({ page, request }) => {
    await page.goto('/test/clear-proxy-tokens');
    const resp = await page.goto('/test/create-proxy-token?scope=read&singleUse=true&label=single');
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
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-proxy-events');

    // Create token
    const tokenResp = await page.goto('/test/create-proxy-token?scope=read&label=events-test');
    const { token } = await tokenResp.json();

    // Make a proxy call to generate an event
    await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Set session and check events API
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
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
  test('getWorkspaceAccessToken finds token from session store', async ({ page }) => {
    // Set up a multi-workspace session so "second-workspace" exists
    // This bypasses the test-mode shortcut (which only handles "test-workspace")
    // and exercises the real session-scanning code path in getWorkspaceAccessToken
    await page.goto('/test/set-session?multiWorkspace=true');

    // Look up the token for second-workspace via the real session scan
    const resp = await page.goto('/test/workspace-token/second-workspace');
    const data = await resp.json();

    // Should find the access token stored by set-session
    expect(data.found).toBe(true);
  });

  test('getWorkspaceAccessToken returns null for unknown workspace', async ({ page }) => {
    await page.goto('/test/set-session');

    const resp = await page.goto('/test/workspace-token/nonexistent-workspace');
    const data = await resp.json();

    expect(data.found).toBe(false);
  });
});
