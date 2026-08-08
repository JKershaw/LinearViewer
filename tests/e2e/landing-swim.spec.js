import { test, expect } from '../fixtures/test-base.js';

test.describe('Landing Swim Page (/swim)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/swim');
    await page.waitForLoadState('networkidle');
  });

  test('renders swim page for unauthenticated users', async ({ page }) => {
    await expect(page.locator('.swim-settings-toggle')).toBeVisible();
    await expect(page.locator('#swim-lanes')).toBeVisible();
    // Flow is the default layout — the landing preview renders the flow grid
    await expect(page.locator('.swim-flow')).toBeVisible();
    await expect(page.locator('.swim-box').first()).toBeVisible();
  });

  test('shows landing nav with Sign in link', async ({ page }) => {
    // LIN-1890 N4: `nav a.login` is shared by every landing sign-in CTA (Linear,
    // GitHub, and now Jira), so it is ambiguous under Playwright strict mode as
    // soon as a second one renders. Name the Linear CTA by its own testid.
    await expect(page.locator('[data-testid="nav-login-linear"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-login-linear"]')).toHaveAttribute('href', '/auth/linear');
    await expect(page.locator('nav a[href="/"]')).toBeVisible();
  });

  test('does not show workspace selector in nav', async ({ page }) => {
    await expect(page.locator('.nav-item[data-selector="workspace"]')).not.toBeVisible();
  });

  test('displays boxes with LV identifiers from landing data', async ({ page }) => {
    const box = page.locator('.swim-box').first();
    await expect(box).toBeVisible();
    const id = await box.locator('.swim-box-id').textContent();
    expect(id).toMatch(/^LV-\d+$/);
  });

  test('settings panel toggles open and closed', async ({ page }) => {
    const body = page.locator('.swim-settings-body');
    const toggle = page.locator('.swim-settings-toggle');

    await expect(body).toHaveClass(/hidden/);
    await toggle.click();
    await expect(body).not.toHaveClass(/hidden/);
    await toggle.click();
    await expect(body).toHaveClass(/hidden/);
  });

  test('grouping select has expected options', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    const options = await page.locator('#swim-grouping option').allTextContents();
    expect(options).toContain('Dependency chains');
    expect(options).toContain('By project');
    expect(options).toContain('By assignee');
    expect(options).toContain('By status');
  });

  test('footer shows cross-view navigation links', async ({ page }) => {
    await expect(page.locator('.page-footer')).toBeVisible();
    await expect(page.locator('.footer-actions')).toBeVisible();
    // swim is current page — shown in bold, not a link
    await expect(page.locator('.footer-actions strong.footer-current')).toHaveText('swim');
    // projects and swipe are links
    await expect(page.locator('.footer-actions a[href="/"]')).toBeVisible();
    await expect(page.locator('.footer-actions a[href="/swipe"]')).toBeVisible();
  });

  test('popover appears when clicking a swim box', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);
    await expect(page.locator('#swim-popover-id')).toBeVisible();
    await expect(page.locator('#swim-popover-title')).toBeVisible();
  });

  test('popover closes when close button is clicked', async ({ page }) => {
    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);
    await page.locator('#swim-popover-close').click();
    await expect(page.locator('#swim-popover')).toHaveClass(/hidden/);
  });

  test('authenticated users are redirected to workspace swim', async ({ page, seedLocal }) => {
    await seedLocal();
    await page.goto('/swim');
    await expect(page).toHaveURL(/\/workspace\/.+\/swim/);
  });
});
