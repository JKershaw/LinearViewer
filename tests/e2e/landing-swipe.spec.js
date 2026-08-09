import { test, expect } from '../fixtures/test-base.js';

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
    // LIN-1890 N4: `nav a.login` is shared by every landing sign-in CTA (Linear,
    // GitHub, and now Jira), so it is ambiguous under Playwright strict mode as
    // soon as a second one renders. Name the Linear CTA by its own testid.
    await expect(page.locator('[data-testid="nav-login-linear"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-linear"]')).toHaveAttribute('href', '/auth/linear');

    // LIN-1890 close-out, ledger item 3 (E4's approved assertion, in its
    // CORRECT polarity). E4 named an absence check here — count 0 — on the
    // premise that this server is Jira-unconfigured. It is not: the webServer
    // sets the three JIRA_* placeholders, so the gate is open and the Jira CTA
    // is what a Jira-only human uses to sign in from this preview. Asserting
    // presence is what actually guards the gate; the absence version would have
    // failed, which is why it was dropped rather than landed.
    await expect(page.locator('[data-testid="nav-login-jira"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-jira"]')).toHaveAttribute('href', '/auth/jira/oauth?mode=new');

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
    // landing.md has 16 issues; 2 are completed, so the default "All" filter
    // shows 14 non-completed issues
    const positionText = await page.locator('.swipe-card-position').textContent();
    expect(positionText).toMatch(/\/\s*14$/);
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

  test('footer shows cross-view navigation links', async ({ page }) => {
    await expect(page.locator('.page-footer')).toBeVisible();
    await expect(page.locator('.footer-actions')).toBeVisible();
    // swipe is current page — shown in bold, not a link
    await expect(page.locator('.footer-actions strong.footer-current')).toHaveText('swipe');
    // projects and swim are links
    await expect(page.locator('.footer-actions a[href="/"]')).toBeVisible();
    await expect(page.locator('.footer-actions a[href="/swim"]')).toBeVisible();
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

  test('authenticated users visiting /swipe/:identifier are redirected to workspace swipe', async ({ page, seedLocal }) => {
    await seedLocal();
    await page.goto('/swipe/LV-8');

    // Server redirects to workspace swipe (identifier passed through,
    // but client JS may update URL once it resolves against workspace data)
    await expect(page).toHaveURL(/\/workspace\/.+\/swipe/);
  });

  test('authenticated users are redirected to workspace swipe', async ({ page, seedLocal }) => {
    await seedLocal();
    await page.goto('/swipe');

    await expect(page).toHaveURL(/\/workspace\/.+\/swipe/);
  });
});
