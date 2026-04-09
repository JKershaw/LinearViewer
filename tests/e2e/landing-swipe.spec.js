import { test, expect } from '@playwright/test';

test.describe('Landing Swipe Page (/swipe)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/swipe');
    await page.waitForLoadState('networkidle');
  });

  test('renders swipe page for unauthenticated users', async ({ page }) => {
    await expect(page.locator('.swipe-card')).toBeVisible();
    await expect(page.locator('.swipe-filter-select')).toBeVisible();
    await expect(page.locator('.swipe-counter')).toBeVisible();
  });

  test('shows landing nav with Sign in link', async ({ page }) => {
    // Should have the Sign in link (landing navbar)
    await expect(page.locator('nav a.login')).toBeVisible();
    await expect(page.locator('nav a.login')).toHaveAttribute('href', '/auth/linear');

    // Should have a back-to-projects link
    await expect(page.locator('nav a[href="/"]')).toBeVisible();
  });

  test('does not show workspace selector in nav', async ({ page }) => {
    await expect(page.locator('.nav-item[data-selector="workspace"]')).not.toBeVisible();
  });

  test('displays cards with LV identifiers from landing data', async ({ page }) => {
    // landing.md issues use LV-N identifiers
    const identifier = await page.locator('.swipe-card-identifier').textContent();
    expect(identifier).toMatch(/^LV-\d+$/);
  });

  test('shows correct card count from landing data', async ({ page }) => {
    // landing.md has 19 issues; 4 are completed, so the default "All" filter
    // shows 15 non-completed issues
    const positionText = await page.locator('.swipe-card-position').textContent();
    expect(positionText).toMatch(/\/\s*15$/);
  });

  test('left arrow is disabled on first card', async ({ page }) => {
    await expect(page.locator('.swipe-arrow-left')).toBeDisabled();
  });

  test('arrow navigation moves between cards', async ({ page }) => {
    const rightArrow = page.locator('.swipe-arrow-right');
    await expect(rightArrow).not.toBeDisabled();

    await rightArrow.click();
    await expect(page.locator('.swipe-card-position')).toContainText('2 /');

    await page.locator('.swipe-arrow-left').click();
    await expect(page.locator('.swipe-card-position')).toContainText('1 /');
  });

  test('filter dropdown shows project filters', async ({ page }) => {
    const options = await page.locator('.swipe-filter-select option').allTextContents();
    // Should have at least "All" plus some project filters from landing.md
    expect(options.length).toBeGreaterThan(1);
    // All option always present
    expect(options[0]).toContain('All');
  });

  test('does not show Comments accordion (no auth)', async ({ page }) => {
    // Comments require API access — should not appear on landing swipe
    await expect(page.locator('.swipe-accordion-header[data-accordion="comments"]')).not.toBeVisible();
  });

  test('does not show prompt buttons (no auth)', async ({ page }) => {
    // Prompt buttons require API access — suppressed when no urlKey
    await expect(page.locator('.swipe-prompt-btn')).toHaveCount(0);
  });

  test('footer is visible without action links', async ({ page }) => {
    await expect(page.locator('.page-footer')).toBeVisible();
    await expect(page.locator('.footer-actions')).not.toBeVisible();
  });

  test('description accordion works when issue has description', async ({ page }) => {
    // Navigate through cards to find one with a description
    const maxCards = 10;
    let found = false;

    for (let i = 0; i < maxCards; i++) {
      const descHeader = page.locator('.swipe-accordion-header[data-accordion="description"]');
      if (await descHeader.count() > 0) {
        found = true;
        await descHeader.click();
        await expect(page.locator('.swipe-accordion-body[data-accordion-body="description"]')).toHaveClass(/open/);
        break;
      }
      const right = page.locator('.swipe-arrow-right');
      if (await right.isDisabled()) break;
      await right.click();
    }

    // Landing data has issues with descriptions — at least one should exist
    expect(found).toBe(true);
  });

  test('URL updates to /swipe/:identifier as cards are navigated', async ({ page }) => {
    // First card: URL should include its identifier
    const firstIdentifier = await page.locator('.swipe-card-identifier').textContent();
    expect(page.url()).toContain(`/swipe/${firstIdentifier}`);
    expect(page.url()).not.toContain('workspace');

    // Navigate to next card: URL should update to new identifier
    await page.locator('.swipe-arrow-right').click();
    const secondIdentifier = await page.locator('.swipe-card-identifier').textContent();
    expect(page.url()).toContain(`/swipe/${secondIdentifier}`);
    expect(secondIdentifier).not.toBe(firstIdentifier);
  });

  test('deep-link URL /swipe/:identifier loads specific card', async ({ page }) => {
    // Navigate directly to a specific landing issue
    await page.goto('/swipe/LV-8');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.swipe-card-identifier')).toHaveText('LV-8');
    expect(page.url()).toContain('/swipe/LV-8');
  });

  test('authenticated users visiting /swipe/:identifier are redirected to workspace swipe', async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/swipe/LV-8');

    // Server redirects to workspace swipe (identifier passed through,
    // but client JS may update URL once it resolves against workspace data)
    await expect(page).toHaveURL(/\/workspace\/.+\/swipe/);
  });

  test('authenticated users are redirected to workspace swipe', async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/swipe');

    await expect(page).toHaveURL(/\/workspace\/.+\/swipe/);
  });
});
