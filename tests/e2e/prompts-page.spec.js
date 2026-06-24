/**
 * E2E tests for the /prompts catalog page (migrated to the local provider in LIN-407).
 *
 * The prompts page is template-driven: its handler (server.js
 * `GET /workspace/:urlKey/prompts`) renders the 15-template catalog from
 * `lib/prompt-templates.js` and reads only workspace CONFIG — `workspace.name`,
 * `urlKey`, `req.session.workspaces`, and feature flags — never issue data, a
 * provider fetch, or `testMockData`. So this surface needs a plain
 * `provider: 'local'` session and nothing more: `seedLocalWorkspace(page)`
 * establishes it (workspace config only — no issue fixture, no AI mock, no
 * feature flags), replacing the old `/test/set-session` + `test-workspace`
 * mock harness.
 */
import { test, expect } from '../fixtures/test-base.js';

// Local-provider workspace seeded via /test/set-local-session (LIN-407).

test.describe('Prompts Page', () => {
  test.describe('Unauthenticated', () => {
    test('redirects to home when not authenticated', async ({ page }) => {
      // Clear any existing session
      await page.goto('/test/clear-session');

      // Try to access /prompts (legacy route redirects to home for unauthenticated)
      await page.goto('/prompts');

      // Should redirect to home
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('Authenticated', () => {
    test.beforeEach(async ({ seedLocal }) => {
      // Prompts page is template-driven and reads only workspace config, so a
      // plain local session suffices — no issue/AI/flag seeding (LIN-407).
      await seedLocal();
    });

    test('renders prompts page', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show prompts header
      await expect(page.locator('h1')).toContainText('Prompts');

      // Should show subtitle
      await expect(page.locator('.prompts-subtitle')).toContainText('Prompt templates');
    });

    test('shows workspace dropdown in navigation', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show workspace dropdown with workspace name
      const workspaceToggle = page.locator('#workspace-toggle');
      await expect(workspaceToggle).toBeVisible();
      await expect(workspaceToggle).toContainText('Local Workspace');
    });

    test('has back link to projects', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should have link back to workspace projects page
      const projectsLink = page.locator(`.nav-action[href="/workspace/${localWorkerUrlKey}/"]`);
      await expect(projectsLink).toBeVisible();
      await expect(projectsLink).toContainText('projects');
    });

    test('does not have logout link in navbar', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Logout moved to settings page
      await expect(page.locator('.nav-action[href="/logout"]')).not.toBeVisible();
    });

    test('shows summary stats', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show summary with template count and total chars
      const summaryStats = page.locator('.prompts-summary .stat');
      await expect(summaryStats).toHaveCount(2);

      // Should show templates count
      await expect(page.locator('.prompts-summary')).toContainText('templates');

      // Should show total chars
      await expect(page.locator('.prompts-summary')).toContainText('total chars');
    });

    test('shows template categories', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show category headers
      await expect(page.locator('.prompt-category')).not.toHaveCount(0);
      await expect(page.locator('.category-header')).not.toHaveCount(0);
    });

    test('shows template cards', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show prompt cards
      const promptCards = page.locator('.prompt-card');
      await expect(promptCards).not.toHaveCount(0);

      // Each card should have name, label, and char count
      const firstCard = promptCards.first();
      await expect(firstCard.locator('.prompt-name')).toBeVisible();
      await expect(firstCard.locator('.prompt-label')).toBeVisible();
      await expect(firstCard.locator('.prompt-chars')).toBeVisible();
    });

    test('can expand prompt details', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Find a prompt card with details
      const promptDetails = page.locator('.prompt-details').first();

      // Should be collapsed by default
      await expect(promptDetails).not.toHaveAttribute('open');

      // Click to expand
      await promptDetails.locator('summary').click();

      // Should show prompt text
      await expect(promptDetails.locator('.prompt-text')).toBeVisible();
    });

    test('shows meta-prompt section', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show meta-prompt section
      await expect(page.locator('.meta-prompt-section')).toBeVisible();
      await expect(page.locator('.meta-prompt-section .section-header')).toContainText('Meta-Prompt');
    });

    test('has footer with navigation links', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should have footer
      await expect(page.locator('.page-footer')).toBeVisible();

      // Should have settings link with workspace prefix
      const settingsLink = page.locator(`.footer-action[href="/workspace/${localWorkerUrlKey}/settings"]`);
      await expect(settingsLink).toBeVisible();
      await expect(settingsLink).toContainText('settings');

      // Should have swim link with workspace prefix
      const swimLink = page.locator(`.footer-action[href="/workspace/${localWorkerUrlKey}/swim"]`);
      await expect(swimLink).toBeVisible();
    });
  });
});
