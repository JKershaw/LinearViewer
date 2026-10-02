import { test, expect } from '../fixtures/test-base.js';
import {
  workspaceApiLocalSeed,
} from '../fixtures/local-harness.js';

// Migrated onto a GENUINE `provider: 'local'` session (LIN-425, parent S3),
// consume-only against the LIN-405 harness surface. `freeTierEnabled` rides the
// third `options` arg of the `seedLocal` fixture (NOT the seed object) — CI sets no
// OPENROUTER_FREE_TIER_KEY, so charging goes through the session-flag path. The
// recommend AI response stays mocked (`shouldMockAi` covers local). The free-tier
// store is urlKey-partitioned and recommend charges `workspace.urlKey`, so every
// `/test/clear-free-tier` and `/test/add-free-tier-usage` MUST pass
// `?urlKey=${localWorkerUrlKey}` (the per-worker key produced by the test-base fixtures).

// UUID for TEST-11 ("Blocked on external API access", In Progress) — a leaf task,
// preserved by workspaceApiLocalSeed so existing locators/ids survive.
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Set up session with free tier enabled (no OAuth, no env key)
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    // Clear any previous usage
    await page.goto(`/test/clear-free-tier?urlKey=${localWorkerUrlKey}`);
  });

  test('recommend status returns free tier info', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.enabled).toBe(true);
    expect(body.source).toBe('free');
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.remaining).toBe(5);
    expect(body.freeTier.limit).toBe(5);
    expect(body.freeTier.resetsAt).toBeDefined();
  });

  test('recommend returns result with free tier metadata', async ({ page, localWorkerUrlKey }) => {
    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.reasoning).toBeDefined();
    expect(body.prompt).toBeDefined();
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.used).toBe(true);
    expect(body.freeTier.remaining).toBe(4);
    expect(body.freeTier.limit).toBe(5);
  });

  test('usage decrements with each request', async ({ page, localWorkerUrlKey }) => {
    // First request
    const res1 = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();
    expect(body1.freeTier.remaining).toBe(4);

    // Second request
    const res2 = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.freeTier.remaining).toBe(3);
  });

  test('returns 429 when daily limit is exceeded', async ({ page, localWorkerUrlKey }) => {
    // Pre-fill usage to the limit
    await page.goto(`/test/add-free-tier-usage?count=5&urlKey=${localWorkerUrlKey}`);

    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(429);

    const body = await response.json();
    expect(body.error).toContain('Daily limit reached');
    expect(body.freeTier).toBeDefined();
    expect(body.freeTier.remaining).toBe(0);
    expect(body.freeTier.limit).toBe(5);
  });

  test('status endpoint shows 0 remaining when limit exceeded', async ({ page, localWorkerUrlKey }) => {
    // Pre-fill usage to the limit
    await page.goto(`/test/add-free-tier-usage?count=5&urlKey=${localWorkerUrlKey}`);

    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.freeTier.remaining).toBe(0);
  });

  test('users with OAuth keys do not get free tier metadata', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Set up session with OAuth (overrides free tier)
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });

    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.freeTier).toBeUndefined();
  });

  test('recommend status shows oauth source when user has key', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });

    const response = await page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/status`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.source).toBe('oauth');
    expect(body.freeTier).toBeUndefined();
  });

  test('concurrent requests respect rate limits', async ({ page, localWorkerUrlKey }) => {
    // Pre-fill usage to 3 of 5 (leaving 2 remaining)
    await page.goto(`/test/add-free-tier-usage?count=3&urlKey=${localWorkerUrlKey}`);

    // Fire 4 concurrent requests — only 2 should succeed
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        page.request.get(`/workspace/${localWorkerUrlKey}/api/recommend/${BLOCKED_ISSUE_ID}`)
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
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Set up free tier session and clear usage
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    await page.goto(`/test/clear-free-tier?urlKey=${localWorkerUrlKey}`);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
  });

  test('shows the ✦ primary enabled for free tier users', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Free tier acts like having a key: the ✦ primary is runnable.
    const go = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] [data-testid="opened-task-go"]`);
    await expect(go).toBeVisible();
    await expect(go).toBeEnabled();
  });

  test('footer shows free tier AI status', async ({ page }) => {
    const footerStatus = page.locator('.footer-ai-status.free');
    await expect(footerStatus).toBeVisible();
    await expect(footerStatus).toContainText('ai:');
    await expect(footerStatus).toContainText('free');
  });

  test('a free-tier user can recommend and the footer shows the allowance', async ({ page }) => {
    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // Run the ✦ primary (free tier spends the mock, no real AI).
    const component = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .prompt-section`);
    await component.locator('[data-testid="opened-task-go"]').click();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 15000 });
    await expect(component.locator('[data-prompt-body]')).not.toBeEmpty();

    // The free-tier allowance is disclosed in the footer with its real count.
    // The recommend consumed one of the fixture's 5, so a reload (which re-reads
    // /api/recommend/status) shows 4/5.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const footerStatus = page.locator('.footer-ai-status.free');
    await expect(footerStatus).toBeVisible();
    await expect(footerStatus).toHaveText('ai: \u25cf free (4/5)');
  });

  test('disables the ✦ primary with the quota message when the limit is exhausted', async ({ page, localWorkerUrlKey }) => {
    // Pre-fill usage to the limit
    await page.goto(`/test/add-free-tier-usage?count=5&urlKey=${localWorkerUrlKey}`);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Expand an issue
    const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
    await taskLine.click();

    // Expand Prompts section
    await expandPromptsSection(page, '.in-progress-items', BLOCKED_ISSUE_ID);

    // The load-time quota signal disables the primary with the quota reason
    // (addendum 5) instead of letting a request 429.
    const component = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"] .prompt-section`);
    await expect(component.locator('[data-testid="opened-task-go"]')).toBeDisabled();
    await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/daily free-tier limit reached/i);
  });
});

// =============================================================================
// Free Tier Settings Page Tests
// =============================================================================

test.describe('Free Tier Settings', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
    await page.goto(`/test/clear-free-tier?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows free tier status', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Should show free tier status
    const freeTierStatus = page.locator('[data-free-tier-status]');
    await expect(freeTierStatus).toBeVisible();
    await expect(freeTierStatus).toContainText('free tier');

    // Should show connect for unlimited link
    await expect(page.locator('.action-btn.connect')).toContainText('connect for unlimited');
  });

  test('settings page shows usage info', async ({ page, localWorkerUrlKey }) => {
    // Use 2 prompts first
    await page.goto(`/test/add-free-tier-usage?count=2&urlKey=${localWorkerUrlKey}`);

    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Should show usage info (populated via JS)
    const usageEl = page.locator('[data-free-tier-usage]');
    await expect(usageEl).toBeVisible();
    // Wait for JS to populate the usage
    await expect(usageEl).toContainText('3 of 5 daily prompts remaining', { timeout: 5000 });
  });
});
