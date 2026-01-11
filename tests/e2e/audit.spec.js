import { test, expect } from '@playwright/test';

test.describe('Operator Dashboard', () => {
  test.describe('Unauthenticated', () => {
    test('redirects to home when not authenticated', async ({ page }) => {
      // Clear any existing session
      await page.goto('/test/clear-session');

      // Try to access /fancy
      await page.goto('/fancy');

      // Should redirect to home
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('Authenticated', () => {
    test.beforeEach(async ({ page }) => {
      // Set up test session
      await page.goto('/test/set-session');
    });

    test('renders dashboard page', async ({ page }) => {
      await page.goto('/fancy');

      // Should show dashboard header
      await expect(page.locator('h1')).toContainText('Operator Dashboard');

      // Should show subtitle
      await expect(page.locator('.dashboard-subtitle')).toContainText('audit');

      // Should show Run Audit button
      await expect(page.locator('#run-audit')).toBeVisible();
      await expect(page.locator('#run-audit')).toContainText('Run Audit');
    });

    test('shows workspace name in navigation', async ({ page }) => {
      await page.goto('/fancy');

      // Should show workspace name in nav
      await expect(page.locator('.nav-value-static')).toBeVisible();
    });

    test('has back link to projects', async ({ page }) => {
      await page.goto('/fancy');

      // Should have link back to projects
      const projectsLink = page.locator('.nav-action[href="/"]');
      await expect(projectsLink).toBeVisible();
      await expect(projectsLink).toContainText('projects');
    });

    test('has logout link', async ({ page }) => {
      await page.goto('/fancy');

      const logoutLink = page.locator('.nav-action[href="/logout"]');
      await expect(logoutLink).toBeVisible();
      await expect(logoutLink).toContainText('logout');
    });

    test('runs audit and displays report', async ({ page }) => {
      await page.goto('/fancy');

      // Click Run Audit button
      await page.locator('#run-audit').click();

      // Should show loading state
      await expect(page.locator('#audit-status')).toContainText('Running');

      // Wait for report to appear
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Should show summary stats
      await expect(page.locator('.report-summary')).toBeVisible();
      await expect(page.locator('.stat-label')).toContainText(['Total Tasks']);

      // Should show sections
      await expect(page.locator('.report-section')).toHaveCount(6);

      // Should show timestamp
      await expect(page.locator('.report-timestamp')).toBeVisible();
    });

    test('displays queue readiness section', async ({ page }) => {
      await page.goto('/fancy');

      // Run audit
      await page.locator('#run-audit').click();
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Find queue readiness section
      const queueSection = page.locator('.report-section:has(.section-header:has-text("Queue Readiness"))');
      await expect(queueSection).toBeVisible();

      // Should show queue items
      await expect(queueSection.locator('.queue-item')).toHaveCount(5);
    });

    test('sections are collapsible', async ({ page }) => {
      await page.goto('/fancy');

      // Run audit
      await page.locator('#run-audit').click();
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Get first section header and content
      const firstSection = page.locator('.report-section').first();
      const header = firstSection.locator('.section-header');
      const content = firstSection.locator('.section-content');

      // Content should be visible initially
      await expect(content).toBeVisible();

      // Click to collapse
      await header.click();
      await expect(content).toHaveClass(/hidden/);

      // Click to expand
      await header.click();
      await expect(content).not.toHaveClass(/hidden/);
    });

    test('shows completion status after audit', async ({ page }) => {
      await page.goto('/fancy');

      // Run audit
      await page.locator('#run-audit').click();
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Status should say complete
      await expect(page.locator('#audit-status')).toContainText('complete');
    });
  });
});

test.describe('Audit API', () => {
  test('returns 401 when not authenticated', async ({ request }) => {
    // Try to call API without session
    const response = await request.get('/api/audit');
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data.error).toBe('Not authenticated');
  });

  test('returns valid audit report when authenticated', async ({ page, request }) => {
    // Set up session
    await page.goto('/test/set-session');

    // Get cookies from page context
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Call API with session cookie
    const response = await request.get('/api/audit', {
      headers: {
        Cookie: cookieHeader
      }
    });

    expect(response.status()).toBe(200);

    const report = await response.json();

    // Verify report structure
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('workspace');
    expect(report).toHaveProperty('labels');
    expect(report).toHaveProperty('queues');
    expect(report).toHaveProperty('health');
    expect(report).toHaveProperty('fields');
    expect(report).toHaveProperty('projectTasks');

    // Verify timestamp is valid ISO date
    expect(() => new Date(report.timestamp)).not.toThrow();

    // Verify workspace structure
    expect(report.workspace).toHaveProperty('teams');
    expect(report.workspace).toHaveProperty('projects');
    expect(report.workspace).toHaveProperty('teamCount');
    expect(report.workspace).toHaveProperty('projectCount');

    // Verify queues structure
    expect(report.queues).toHaveProperty('queues');
    expect(report.queues).toHaveProperty('readinessScore');
    expect(report.queues).toHaveProperty('isReady');

    // Verify health structure
    expect(report.health).toHaveProperty('totalTasks');
    expect(report.health).toHaveProperty('orphans');
    expect(report.health).toHaveProperty('unlabeled');
  });
});
