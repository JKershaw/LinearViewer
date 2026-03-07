import { test, expect } from '@playwright/test';

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

  test('can create and revoke proxy tokens via UI', async ({ page }) => {
    await page.goto(PROXY_PAGE_URL);
    await page.waitForLoadState('networkidle');

    // Should show empty state
    await expect(page.locator('.proxy-token-list')).toContainText('No proxy tokens yet');

    // Create a token
    await page.fill('#proxy-create-token-form input[name="label"]', 'test-ui-token');
    await page.click('#proxy-create-token-form button[type="submit"]');

    // Modal should appear with token
    await expect(page.locator('.token-modal')).toBeVisible();
    await expect(page.locator('.token-value')).not.toBeEmpty();

    // Close modal
    await page.click('.token-modal-close');
    await expect(page.locator('.token-modal')).not.toBeVisible();

    // Token should appear in list
    await expect(page.locator('.proxy-token-list')).toContainText('test-ui-token');

    // Revoke the token
    page.on('dialog', dialog => dialog.accept());
    await page.click('.token-revoke');

    // Should be empty again
    await expect(page.locator('.proxy-token-list')).toContainText('No proxy tokens yet');
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
    // but we verify the auth flow works. The endpoint will likely 500 since
    // there's no real Linear API in test mode, but auth should pass.
    const resp = await request.get('/api/proxy/me', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    // In test mode, the workspace token is 'test-token' which won't auth with Linear,
    // but the proxy token auth itself should succeed (not 401)
    expect(resp.status()).not.toBe(401);
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
    // Should not be 401 or 403 (auth passes, scope passes)
    // Will likely 500 since test-token isn't a real Linear token, but auth works
    expect(resp.status()).not.toBe(401);
    expect(resp.status()).not.toBe(403);
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
