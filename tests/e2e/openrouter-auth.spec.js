import { test, expect } from '../fixtures/test-base.js';

// Workspace URL key used in test session. Bound per-test from the per-worker key
// (LIN-628) so session + nav + API calls all address this worker's partition.
let WORKSPACE_KEY;
let WORKSPACE_URL;
let SETTINGS_URL;

test.beforeEach(({ workerUrlKey }) => {
  WORKSPACE_KEY = workerUrlKey;
  WORKSPACE_URL = `/workspace/${workerUrlKey}/`;
  SETTINGS_URL = `/workspace/${workerUrlKey}/settings`;
});

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
  params.set('urlKey', WORKSPACE_KEY);
  const response = await page.goto(`/test/set-session?${params}`);
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

    // Should see settings section (AI Configuration)
    await expect(page.locator('.settings-section').first()).toBeVisible();

    // Should show OpenRouter as not connected
    const disconnectedStatus = page.locator('.settings-value.disconnected');
    await expect(disconnectedStatus).toBeVisible();
    await expect(disconnectedStatus).toHaveText('○ not connected');

    // Should have a connect link
    const connectLink = page.locator('.action-btn.connect');
    await expect(connectLink).toBeVisible();
    await expect(connectLink).toHaveAttribute('href', '/auth/openrouter');
  });

  test('settings page shows OpenRouter connected when OAuth token is present', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });
    await page.goto(SETTINGS_URL);

    // Should see settings section (AI Configuration)
    await expect(page.locator('.settings-section').first()).toBeVisible();

    // Should show OpenRouter as connected
    const connectedStatus = page.locator('.settings-value.connected');
    await expect(connectedStatus).toBeVisible();
    await expect(connectedStatus).toHaveText('● connected');

    // Should have a disconnect button
    const disconnectBtn = page.locator('.action-btn.disconnect');
    await expect(disconnectBtn).toBeVisible();
    await expect(disconnectBtn).toHaveText('disconnect');
  });

  test('disconnect removes OpenRouter connection', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });

    // Verify connected state via API (more reliable than UI)
    const beforeResponse = await page.request.get(`/workspace/${WORKSPACE_KEY}/api/recommend/status`);
    expect(beforeResponse.ok()).toBeTruthy();
    const beforeData = await beforeResponse.json();
    expect(beforeData.source).toBe('oauth');

    // Disconnect via API POST (avoids UI race conditions)
    const disconnectResponse = await page.request.post('/auth/openrouter/disconnect');
    expect(disconnectResponse.ok()).toBeTruthy();

    // Verify disconnected state via API
    const afterResponse = await page.request.get(`/workspace/${WORKSPACE_KEY}/api/recommend/status`);
    expect(afterResponse.ok()).toBeTruthy();
    const afterData = await afterResponse.json();
    // After disconnect, source should not be 'oauth' (could be 'env' or null depending on test env)
    expect(afterData.source).not.toBe('oauth');
  });

  test('recommendation status API reflects OpenRouter connection', async ({ page }) => {
    // Set up authenticated session without OpenRouter
    await setupSession(page);

    // Check recommendation status - should be enabled (test mode always enabled)
    const response = await page.request.get(`/workspace/${WORKSPACE_KEY}/api/recommend/status`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // In test mode, enabled is always true for testing purposes
    expect(data.enabled).toBe(true);
  });

  test('recommendation status shows oauth source when connected', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });

    // Check recommendation status
    const response = await page.request.get(`/workspace/${WORKSPACE_KEY}/api/recommend/status`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.enabled).toBe(true);
    expect(data.source).toBe('oauth');
  });

  test('main page footer shows ai status indicator when not connected', async ({ page }) => {
    // Set up authenticated session without OpenRouter
    await setupSession(page);
    await page.goto(WORKSPACE_URL);

    // Should show ai indicator in footer
    const statusLink = page.locator('.footer-ai-status');
    await expect(statusLink).toBeVisible();

    // Should show disconnected state (○)
    await expect(statusLink).toHaveClass(/disconnected/);
    await expect(statusLink).toHaveText('ai: ○');
  });

  test('main page footer shows ai status indicator when connected', async ({ page }) => {
    // Set up authenticated session with OpenRouter connected
    await setupSession(page, { openRouterConnected: true });
    await page.goto(WORKSPACE_URL);

    // Should show ai indicator in footer
    const statusLink = page.locator('.footer-ai-status');
    await expect(statusLink).toBeVisible();

    // Should show connected state (●)
    await expect(statusLink).toHaveClass(/connected/);
    await expect(statusLink).toHaveText('ai: ●');
  });

  test('main page footer lists the workspace LLM model', async ({ page }) => {
    await setupSession(page);
    await page.goto(WORKSPACE_URL);

    // The model name is filled client-side from /api/recommend/status.
    // With no saved preference the workspace falls back to the default model.
    const modelEl = page.locator('[data-ai-model]');
    await expect(modelEl).toHaveText('GPT-5.4 Mini');

    // The AI status anchor text stays exactly "ai: ●"/"ai: ○" (model is a sibling).
    await expect(page.locator('.footer-ai-status')).toHaveText('ai: ○');
  });

  test('ai status links to settings page', async ({ page }) => {
    // Set up authenticated session
    await setupSession(page);
    await page.goto(WORKSPACE_URL);

    // Click the ai status link in footer
    const statusLink = page.locator('.footer-ai-status');
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

// LIN-2412 F1 correction: GET /auth/openrouter must render a real
// grant/decline choice rather than redirecting straight to OpenRouter. This
// drives the actual browser render (not just the unit-level fake-router
// tests in tests/unit/openrouter-auth.test.js), closing the review's noted
// gap that no E2E covered the consent affordance at all.
test.describe('OpenRouter consent interstitial (LIN-2412)', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
    await setupSession(page);
  });

  test('GET /auth/openrouter renders a real grant/decline choice, not an immediate redirect to OpenRouter', async ({ page }) => {
    const response = await page.goto('/auth/openrouter');

    // Must render Harbour's own interstitial page, never navigate off-site.
    expect(new URL(page.url()).hostname).not.toBe('openrouter.ai');
    expect(response.ok()).toBeTruthy();

    await expect(page.getByTestId('openrouter-consent-page')).toBeVisible();
    await expect(page.getByTestId('openrouter-consent-grant-submit')).toBeVisible();
    await expect(page.getByTestId('openrouter-consent-decline-submit')).toBeVisible();
  });

  // LIN-2497 — the LIN-2400 defect class, second instance. Both choices were
  // plain `.login-button`, so "Connect and enable unattended use" and "Connect
  // without unattended use" were pixel-identical apart from label length.
  // Introduced in 2392a537 (LIN-2412), i.e. AFTER LIN-2400 was filed.
  //
  // Consequence is lower than LIN-2400's — neither branch here is irreversible,
  // and declining still connects the key — so this is presentation hygiene, not
  // a safety fix. Covered the same way regardless: real browser-computed style
  // on the real page, in BOTH themes (the `theme` cookie drives the pre-paint
  // `.theme-dark` class from lib/components/page.js, so setting it before
  // navigation is enough — there is no toggle UI to drive here).
  test.describe('Consent actions are visually differentiated (LIN-2497)', () => {
    for (const theme of ['light', 'dark']) {
      test(`${theme} theme: grant and decline no longer read as the same button`, async ({ page }) => {
        if (theme === 'dark') {
          await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
        }
        await page.goto('/auth/openrouter');
        await expect(page.getByTestId('openrouter-consent-page')).toBeVisible();
        if (theme === 'dark') {
          await expect(page.locator('html')).toHaveClass(/theme-dark/);
        }

        const { grant, decline } = await page.evaluate(() => {
          const read = el => {
            const s = getComputedStyle(el);
            return {
              backgroundColor: s.backgroundColor,
              color: s.color,
              borderColor: s.borderColor,
              fontSize: s.fontSize,
              cursor: s.cursor,
            };
          };
          return {
            grant: read(document.querySelector('[data-testid="openrouter-consent-grant-submit"]')),
            decline: read(document.querySelector('[data-testid="openrouter-consent-decline-submit"]')),
          };
        });

        // They no longer share a look.
        expect(decline.backgroundColor).not.toBe(grant.backgroundColor);
        expect(decline.color).not.toBe(grant.color);
        expect(decline.borderColor).not.toBe(grant.borderColor);

        // DIRECTION, not mere difference (LIN-2400 review F1): the grant is the
        // filled primary and the decline the chromeless outline, so a future
        // change that merely swapped them would still fail here.
        expect(decline.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(grant.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

        // Both stay deliberately sized — not the UA default a bare <button> gets.
        expect(grant.fontSize).toBe('16px');
        expect(decline.fontSize).toBe('16px');
        expect(grant.cursor).toBe('pointer');
        expect(decline.cursor).toBe('pointer');
      });
    }
  });
});
