import { test, expect } from '../fixtures/test-base.js';
import {
  seedLocalWorkspace,
  workspaceApiLocalSeed,
  LOCAL_WORKSPACE_URL_KEY,
} from '../fixtures/local-harness.js';

// Migrated onto the local-provider harness (LIN-412). Audit is NOT
// provider-routed (runAudit goes straight to GraphQL), so the surface stays on
// the deterministic audit mock — the route gate is widened to fire for local
// sessions (provider === 'local') as well as the legacy `test-token` path. The
// local seed only changes session/workspace resolution; the mocked audit report
// (computeAuditFromData over testMockTeams/testMockData) is unchanged, so every
// deterministic assertion below holds byte-for-byte.
const TEST_WORKSPACE_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const AUDIT_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/audit`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}`;

test.describe('Operator Dashboard', () => {
  test.describe('Unauthenticated', () => {
    test('redirects to home when not authenticated', async ({ page }) => {
      // Clear any existing session
      await page.goto('/test/clear-session');

      // Try to access /audit (legacy route redirects to home for unauthenticated)
      await page.goto('/audit');

      // Should redirect to home
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('Authenticated', () => {
    test.beforeEach(async ({ page }) => {
      // Seed the local workspace and establish a provider: 'local' session.
      await seedLocalWorkspace(page, workspaceApiLocalSeed);
    });

    test('renders dashboard page', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Should show dashboard header
      await expect(page.locator('h1')).toContainText('Operator Dashboard');

      // Should show subtitle
      await expect(page.locator('.dashboard-subtitle')).toContainText('audit');

      // Should show Run Audit button
      await expect(page.locator('#run-audit')).toBeVisible();
      await expect(page.locator('#run-audit')).toContainText('Run Audit');
    });

    test('shows workspace dropdown in navigation', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Should show workspace dropdown with workspace name
      const workspaceToggle = page.locator('#workspace-toggle');
      await expect(workspaceToggle).toBeVisible();
      await expect(workspaceToggle).toContainText('Local Workspace');
    });

    test('has back link to projects', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Should have link back to workspace projects page
      const projectsLink = page.locator(`.nav-action[href="${WORKSPACE_URL}"]`);
      await expect(projectsLink).toBeVisible();
      await expect(projectsLink).toContainText('projects');
    });

    test('does not have logout link in navbar', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Logout moved to settings page
      await expect(page.locator('.nav-action[href="/logout"]')).not.toBeVisible();
    });

    test('runs audit and displays report', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Click Run Audit button
      await page.locator('#run-audit').click();

      // Wait for report to appear (audit may complete too fast to catch "Running" state)
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Should show summary stats
      await expect(page.locator('.report-summary')).toBeVisible();
      await expect(page.locator('.stat-label')).toContainText(['Total Tasks']);

      // Should show sections (5 total: workspace, queues, health, labels, projects)
      // Note: prompts section was moved to dedicated /prompts page
      await expect(page.locator('.report-section')).toHaveCount(5);

      // Should show timestamp
      await expect(page.locator('.report-timestamp')).toBeVisible();
    });

    test('displays queue readiness section', async ({ page }) => {
      await page.goto(AUDIT_URL);

      // Run audit
      await page.locator('#run-audit').click();
      await expect(page.locator('.audit-report')).toBeVisible({ timeout: 10000 });

      // Find queue readiness section
      const queueSection = page.locator('.report-section:has(.section-header:has-text("Queue Readiness"))');
      await expect(queueSection).toBeVisible();

      // Should show queue items (3 queues: Ready, In-Progress, Review)
      await expect(queueSection.locator('.queue-item')).toHaveCount(3);
    });

    test('sections are collapsible', async ({ page }) => {
      await page.goto(AUDIT_URL);

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
      await page.goto(AUDIT_URL);

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
    // No session: workspaceFromUrl validates the urlKey format (local-workspace
    // is valid), then rejects the missing session with 401 before any workspace
    // lookup — so this case stays reachable under the local prefix.
    const response = await request.get(`${API_PREFIX}/api/audit`);
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data.error).toBe('Not authenticated');
  });

  test('returns valid audit report when authenticated', async ({ page, request }) => {
    // Seed the local workspace and establish a provider: 'local' session before
    // harvesting cookies.
    await seedLocalWorkspace(page, workspaceApiLocalSeed);

    // Get cookies from page context
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Call API with session cookie
    const response = await request.get(`${API_PREFIX}/api/audit`, {
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

    // Verify labels structure with workflow labels (simplified 3-label system)
    expect(report.labels).toHaveProperty('workflow');
    expect(report.labels.workflow).toHaveProperty('labels');
    expect(report.labels.workflow).toHaveProperty('presentCount');
    expect(report.labels.workflow).toHaveProperty('missingCount');
    expect(report.labels.workflow).toHaveProperty('totalCount');
    expect(report.labels.workflow.labels).toHaveLength(2);
    expect(report.labels.workflow.totalCount).toBe(2);
    expect(report.labels).toHaveProperty('other');
    expect(report.labels).toHaveProperty('otherCount');

    // Verify health structure
    expect(report.health).toHaveProperty('totalTasks');
    expect(report.health).toHaveProperty('orphans');
    expect(report.health).toHaveProperty('unlabeled');

    // Verify prompts structure (14 templates: code-review consolidated into review — LIN-523)
    expect(report).toHaveProperty('prompts');
    expect(report.prompts).toHaveProperty('templates');
    expect(report.prompts).toHaveProperty('templateCount');
    expect(report.prompts).toHaveProperty('metaPrompt');
    expect(report.prompts).toHaveProperty('metaPromptCharCount');
    expect(report.prompts).toHaveProperty('totalCharCount');
    expect(report.prompts.templateCount).toBe(14);
    expect(report.prompts.templates).toHaveLength(14);

    // Verify template structure
    const firstTemplate = report.prompts.templates[0];
    expect(firstTemplate).toHaveProperty('key');
    expect(firstTemplate).toHaveProperty('name');
    expect(firstTemplate).toHaveProperty('category');
    expect(firstTemplate).toHaveProperty('description');
    expect(firstTemplate).toHaveProperty('generatedPrompt');
    expect(firstTemplate).toHaveProperty('charCount');
    expect(firstTemplate.charCount).toBeGreaterThan(0);

    // Verify meta-prompt exists and has content
    expect(report.prompts.metaPrompt.length).toBeGreaterThan(1000);
    expect(report.prompts.metaPromptCharCount).toBeGreaterThan(1000);
  });
});
