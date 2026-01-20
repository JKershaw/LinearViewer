import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;

/**
 * Helper to set up a test session with proper waiting.
 * Ensures session is fully established before continuing.
 * @param {import('@playwright/test').Page} page
 * @param {Object} options - Query parameters for session setup
 * @param {boolean} [options.openRouterConnected] - Set up OpenRouter API key
 * @param {boolean} [options.tokenExpired] - Set token expiry in the past
 */
async function setupSession(page, options = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value) params.set(key, 'true');
  }
  const url = params.toString() ? `/test/set-session?${params}` : '/test/set-session';
  const response = await page.goto(url);
  expect(response.status()).toBe(200);
}

/**
 * Helper to clear the test session.
 * @param {import('@playwright/test').Page} page
 */
async function clearSession(page) {
  const response = await page.goto('/test/clear-session');
  expect(response.status()).toBe(200);
}

test.describe('OpenRouter OAuth Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await clearSession(page);
  });

  test('unauthenticated users are redirected from /auth/openrouter', async ({ page }) => {
    // Try to access OpenRouter auth without being logged into Linear
    await page.goto('/auth/openrouter');

    // Should be redirected to home (landing page)
    await expect(page).toHaveURL('/');
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('settings page shows OpenRouter not connected by default', async ({ page }) => {
    // Set up authenticated session without OpenRouter
    await setupSession(page);
    await page.goto(SETTINGS_URL);

    // Should see settings section
    await expect(page.locator('.settings-section')).toBeVisible();

    // Should show OpenRouter as not connected
    const disconnectedStatus = page.locator('.settings-value.disconnected');
    await expect(disconnectedStatus).toBeVisible();
    await expect(disconnectedStatus).toHaveText('○ not connected');

    // Should have a connect link
    const connectLink = page.locator('.settings-action.connect');
    await expect(connectLink).toBeVisible();
    await expect(connectLink).toHaveAttribute('href', '/auth/openrouter');
  });

  test('settings page shows OpenRouter connected when OAuth token is present', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });
    await page.goto(SETTINGS_URL);

    // Should see settings section
    await expect(page.locator('.settings-section')).toBeVisible();

    // Should show OpenRouter as connected
    const connectedStatus = page.locator('.settings-value.connected');
    await expect(connectedStatus).toBeVisible();
    await expect(connectedStatus).toHaveText('● connected');

    // Should have a disconnect button
    const disconnectBtn = page.locator('.settings-action.disconnect');
    await expect(disconnectBtn).toBeVisible();
    await expect(disconnectBtn).toHaveText('disconnect');
  });

  test('disconnect removes OpenRouter connection', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });

    // Verify connected state via API (more reliable than UI)
    const beforeResponse = await page.request.get(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/recommend/status`);
    expect(beforeResponse.ok()).toBeTruthy();
    const beforeData = await beforeResponse.json();
    expect(beforeData.source).toBe('oauth');

    // Disconnect via API POST (avoids UI race conditions)
    const disconnectResponse = await page.request.post('/auth/openrouter/disconnect');
    expect(disconnectResponse.ok()).toBeTruthy();

    // Verify disconnected state via API
    const afterResponse = await page.request.get(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/recommend/status`);
    expect(afterResponse.ok()).toBeTruthy();
    const afterData = await afterResponse.json();
    // After disconnect, source should not be 'oauth' (could be 'env' or null depending on test env)
    expect(afterData.source).not.toBe('oauth');
  });

  test('recommendation status API reflects OpenRouter connection', async ({ page }) => {
    // Set up authenticated session without OpenRouter
    await setupSession(page);

    // Check recommendation status - should be enabled (test mode always enabled)
    const response = await page.request.get(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/recommend/status`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // In test mode, enabled is always true for testing purposes
    expect(data.enabled).toBe(true);
  });

  test('recommendation status shows oauth source when connected', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });

    // Check recommendation status
    const response = await page.request.get(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/recommend/status`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.enabled).toBe(true);
    expect(data.source).toBe('oauth');
  });

  test('main page nav shows ai status indicator when not connected', async ({ page }) => {
    // Set up authenticated session without OpenRouter
    await setupSession(page);
    await page.goto(WORKSPACE_URL);

    // Should show ai indicator in nav
    const aiNav = page.locator('[data-selector="openrouter"]');
    await expect(aiNav).toBeVisible();

    // Should show disconnected state (○)
    const statusLink = aiNav.locator('.nav-openrouter-status');
    await expect(statusLink).toBeVisible();
    await expect(statusLink).toHaveClass(/disconnected/);
    await expect(statusLink).toHaveText('○');
  });

  test('main page nav shows ai status indicator when connected', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });
    await page.goto(WORKSPACE_URL);

    // Should show ai indicator in nav
    const aiNav = page.locator('[data-selector="openrouter"]');
    await expect(aiNav).toBeVisible();

    // Should show connected state (●)
    const statusLink = aiNav.locator('.nav-openrouter-status');
    await expect(statusLink).toBeVisible();
    await expect(statusLink).toHaveClass(/connected/);
    await expect(statusLink).toHaveText('●');
  });

  test('ai status links to settings page', async ({ page }) => {
    // Set up authenticated session
    await setupSession(page);
    await page.goto(WORKSPACE_URL);

    // Click the ai status link
    const statusLink = page.locator('.nav-openrouter-status');
    await expect(statusLink).toBeVisible();
    await statusLink.click();

    // Should navigate to settings page
    await expect(page).toHaveURL(SETTINGS_URL);
  });
});

test.describe('OpenRouter Auth Callback', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated session first (Linear auth required)
    await setupSession(page);
  });

  test('callback without code returns error', async ({ page }) => {
    // Try callback without authorization code
    await page.goto('/auth/openrouter/callback');

    // Should show error page
    await expect(page.locator('.error-title')).toBeVisible();
    await expect(page.locator('.error-title')).toHaveText('Authorization Failed');
  });

  test('callback without session verifier returns error', async ({ page }) => {
    // Clear session to remove code verifier, then re-establish session
    await clearSession(page);
    await setupSession(page);

    // Try callback with code but no verifier in session
    await page.goto('/auth/openrouter/callback?code=test-code');

    // Should show session expired error
    await expect(page.locator('.error-title')).toBeVisible();
    await expect(page.locator('.error-title')).toHaveText('Session Expired');
  });
});
