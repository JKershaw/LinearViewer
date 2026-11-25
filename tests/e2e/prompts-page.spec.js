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
 * feature flags), replacing the old `/test/set-session` test-token mock
 * harness.
 */
import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';

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

    // LIN-4565 (LIN-4342 piece 4): the page sits in the frame as the place Prompts.
    test('renders prompts page', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      await expect(page.locator('h1')).toHaveText('Prompts');
      await expect(page).toHaveTitle(/^Prompts · /);
      await expect(page.locator(SELECTORS.nav.subtitle)).toContainText('Prompt templates');
    });

    test('shows the workspace on the rail', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      await expect(page.locator(SELECTORS.nav.workspaceToggle)).toBeVisible();
      await expect(page.locator(SELECTORS.nav.workspaceName)).toHaveText('Local Workspace');
    });

    test('the rail leads home', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      await expect(page.locator(SELECTORS.nav.place('home'))).toHaveAttribute('href', `/workspace/${localWorkerUrlKey}/`);
    });

    test('has no logout link in the rail', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Logout lives in Settings
      await expect(page.locator(`${SELECTORS.nav.rail} a[href="/logout"]`)).toHaveCount(0);
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

    test('shows the stage-router section', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      // Should show the stage-router section (class name kept as a stable hook)
      await expect(page.locator('.meta-prompt-section')).toBeVisible();
      await expect(page.locator('.meta-prompt-section .section-header')).toContainText('Stage Router');
    });

    test('sits in the frame: its footer, and the rail\'s places', async ({ page, localWorkerUrlKey }) => {
      await page.goto(`/workspace/${localWorkerUrlKey}/prompts`);

      await expect(page.locator(SELECTORS.nav.footer)).toBeVisible();
      await expect(page.locator('.page-footer')).toHaveCount(0);

      await expect(page.locator(`${SELECTORS.nav.place('settings')}[href="/workspace/${localWorkerUrlKey}/settings"]`)).toBeVisible();
      await expect(page.locator(`${SELECTORS.nav.place('swim')}[href="/workspace/${localWorkerUrlKey}/swim"]`)).toBeVisible();
    });
  });
});
