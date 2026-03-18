import { test, expect } from '../fixtures/test-base.js';

// UUIDs for test issues (from mock-data.js)
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}`;

/**
 * Helper to expand Prompts section for an issue
 */
async function expandPromptsSection(page, containerSelector, issueId) {
  const details = page.locator(`${containerSelector} .details[data-details-for="${issueId}"]`);
  const promptsToggle = details.locator('.detail-toggle[data-toggle="prompts"]');
  await promptsToggle.click();
}

// =============================================================================
// Free Tier API Tests
// =============================================================================

test.describe('Free Tier API', () => {
  test.beforeEach(async ({ page }) => {
    // Set up session with free tier enabled (no OAuth, no env key)
    await page.goto('/test/set-session?freeTierEnabled=true');
    // Clear any previous usage
    await page.goto('/test/clear-free-tier');
  });

  test('recommend status returns free tier info', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.enabled).toBe(true);
    expect(body.source).toBe('free');
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.remaining).toBe(5);
    expect(body.freeTier.limit).toBe(5);
    expect(body.freeTier.resetsAt).toBeDefined();
  });

  test('recommend returns result with free tier metadata', async ({ page }) => {
    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.reasoning).toBeDefined();
    expect(body.prompt).toBeDefined();
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.used).toBe(true);
    expect(body.freeTier.remaining).toBe(4);
    expect(body.freeTier.limit).toBe(5);
  });

  test('usage decrements with each request', async ({ page }) => {
    // First request
    const res1 = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();
    expect(body1.freeTier.remaining).toBe(4);

    // Second request
    const res2 = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.freeTier.remaining).toBe(3);
  });

  test('returns 429 when daily limit is exceeded', async ({ page }) => {
    // Pre-fill usage to the limit
    await page.goto('/test/add-free-tier-usage?count=5');

    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(429);

    const body = await response.json();
    expect(body.error).toContain('Daily limit reached');
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.remaining).toBe(0);
    expect(body.freeTier.limit).toBe(5);
  });

  test('status endpoint shows 0 remaining when limit exceeded', async ({ page }) => {
    // Pre-fill usage to the limit
    await page.goto('/test/add-free-tier-usage?count=5');

    const response = await page.request.get(`${API_PREFIX}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.freeTier.remaining).toBe(0);
  });

  test('users with OAuth keys do not get free tier metadata', async ({ page }) => {
    // Set up session with OAuth (overrides free tier)
    await page.goto('/test/set-session?openRouterConnected=true');

    const response = await page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.freeTier).toBeUndefined();
  });

  test('recommend status shows oauth source when user has key', async ({ page }) => {
    await page.goto('/test/set-session?openRouterConnected=true');

    const response = await page.request.get(`${API_PREFIX}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.source).toBe('oauth');
    expect(body.freeTier).toBeUndefined();
  });

  test('concurrent requests respect rate limits', async ({ page }) => {
    // Pre-fill usage to 3 of 5 (leaving 2 remaining)
    await page.goto('/test/add-free-tier-usage?count=3');

    // Fire 4 concurrent requests — only 2 should succeed
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        page.request.get(`${API_PREFIX}/api/recommend/${BLOCKED_ISSUE_ID}`)
      )
    );

    const successes = results.filter(r => r.status() === 200).length;
    const rateLimited = results.filter(r => r.status() === 429).length;

    // At most 2 should succeed (the remaining quota)
    expect(successes).toBeLessThanOrEqual(2);
    // At least 2 should be rate limited
    expect(rateLimited).toBeGreaterThanOrEqual(2);
    // Total should be 4
    expect(successes + rateLimited).toBe(4);
  });
});

// =============================================================================
// Free Tier UI Tests
// =============================================================================

test.describe('Free Tier UI', () => {
  test.beforeEach(async ({ page }) => {
    // Set up free tier session and clear usage
    await page.goto('/test/set-session?freeTierEnabled=true');
    await page.goto('/test/clear-free-tier');
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('shows AI suggest button for free tier users', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Should have AI suggest button (free tier acts like having a key)
    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await expect(suggestBtn).toBeVisible();
  });

  test('footer shows free tier AI status', async ({ page }) => {
    const footerStatus = page.locator('.footer-ai-status.free');
    await expect(footerStatus).toBeVisible();
    await expect(footerStatus).toContainText('ai:');
    await expect(footerStatus).toContainText('free');
  });

  test('shows free tier info after recommendation', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest
    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    // Wait for recommendation to load
    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    // Wait for prompt to appear
    const promptDiv = recommendContainer.locator('.recommend-prompt');
    await expect(promptDiv).toBeVisible({ timeout: 10000 });

    // Should show free tier info
    const freeTierInfo = recommendContainer.locator('[data-testid="free-tier-info"]');
    await expect(freeTierInfo).toBeVisible();
    await expect(freeTierInfo).toContainText('free tier');
    await expect(freeTierInfo).toContainText('daily prompts remaining');
  });

  test('shows error message when limit exceeded', async ({ page }) => {
    // Pre-fill usage to the limit
    await page.goto('/test/add-free-tier-usage?count=5');
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Click suggest
    const suggestBtn = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .suggest-btn`);
    await suggestBtn.click();

    // Should show rate limit error
    const recommendContainer = page.locator(`.in-progress-items .recommend-container[data-recommend-for="${BLOCKED_ISSUE_ID}"]`);
    await expect(recommendContainer).toBeVisible();

    const reasoning = recommendContainer.locator('.recommend-reasoning');
    await expect(reasoning).toBeVisible({ timeout: 10000 });
    await expect(reasoning).toContainText('Daily limit reached');
    await expect(reasoning).toContainText('Connect your OpenRouter account');
  });
});

// =============================================================================
// Free Tier Settings Page Tests
// =============================================================================

test.describe('Free Tier Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session?freeTierEnabled=true');
    await page.goto('/test/clear-free-tier');
  });

  test('settings page shows free tier status', async ({ page }) => {
    await page.goto(`${API_PREFIX}/settings`);
    await page.waitForLoadState('networkidle');

    // Should show free tier status
    const freeTierStatus = page.locator('[data-free-tier-status]');
    await expect(freeTierStatus).toBeVisible();
    await expect(freeTierStatus).toContainText('free tier');

    // Should show connect for unlimited link
    await expect(page.locator('.action-btn.connect')).toContainText('connect for unlimited');
  });

  test('settings page shows usage info', async ({ page }) => {
    // Use 2 prompts first
    await page.goto('/test/add-free-tier-usage?count=2');

    await page.goto(`${API_PREFIX}/settings`);
    await page.waitForLoadState('networkidle');

    // Should show usage info (populated via JS)
    const usageEl = page.locator('[data-free-tier-usage]');
    await expect(usageEl).toBeVisible();
    // Wait for JS to populate the usage
    await expect(usageEl).toContainText('3 of 5 daily prompts remaining', { timeout: 5000 });
  });
});
