import { test, expect } from '@playwright/test';

// Workspace URL key used in test session
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;
const PROMPTS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/prompts`;

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
    test.beforeEach(async ({ page }) => {
      // Set up test session
      await page.goto('/test/set-session');
    });

    test('renders prompts page', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show prompts header
      await expect(page.locator('h1')).toContainText('Prompts');

      // Should show subtitle
      await expect(page.locator('.prompts-subtitle')).toContainText('Prompt templates');
    });

    test('shows workspace dropdown in navigation', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show workspace dropdown with workspace name
      const workspaceToggle = page.locator('#workspace-toggle');
      await expect(workspaceToggle).toBeVisible();
      await expect(workspaceToggle).toContainText('Test Workspace');
    });

    test('has back link to projects', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should have link back to workspace projects page
      const projectsLink = page.locator(`.nav-action[href="${WORKSPACE_URL}"]`);
      await expect(projectsLink).toBeVisible();
      await expect(projectsLink).toContainText('projects');
    });

    test('does not have logout link in navbar', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Logout moved to settings page
      await expect(page.locator('.nav-action[href="/logout"]')).not.toBeVisible();
    });

    test('shows summary stats', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show summary with template count and total chars
      const summaryStats = page.locator('.prompts-summary .stat');
      await expect(summaryStats).toHaveCount(2);

      // Should show templates count
      await expect(page.locator('.prompts-summary')).toContainText('templates');

      // Should show total chars
      await expect(page.locator('.prompts-summary')).toContainText('total chars');
    });

    test('shows template categories', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show category headers
      await expect(page.locator('.prompt-category')).not.toHaveCount(0);
      await expect(page.locator('.category-header')).not.toHaveCount(0);
    });

    test('shows template cards', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show prompt cards
      const promptCards = page.locator('.prompt-card');
      await expect(promptCards).not.toHaveCount(0);

      // Each card should have name, label, and char count
      const firstCard = promptCards.first();
      await expect(firstCard.locator('.prompt-name')).toBeVisible();
      await expect(firstCard.locator('.prompt-label')).toBeVisible();
      await expect(firstCard.locator('.prompt-chars')).toBeVisible();
    });

    test('can expand prompt details', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Find a prompt card with details
      const promptDetails = page.locator('.prompt-details').first();

      // Should be collapsed by default
      await expect(promptDetails).not.toHaveAttribute('open');

      // Click to expand
      await promptDetails.locator('summary').click();

      // Should show prompt text
      await expect(promptDetails.locator('.prompt-text')).toBeVisible();
    });

    test('shows meta-prompt section', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should show meta-prompt section
      await expect(page.locator('.meta-prompt-section')).toBeVisible();
      await expect(page.locator('.meta-prompt-section .section-header')).toContainText('Meta-Prompt');
    });

    test('has footer with navigation links', async ({ page }) => {
      await page.goto(PROMPTS_URL);

      // Should have footer
      await expect(page.locator('.page-footer')).toBeVisible();

      // Current page (prompts) should be bold, not a link
      const currentPage = page.locator('.footer-current');
      await expect(currentPage).toBeVisible();
      await expect(currentPage).toContainText('prompts');

      // Should have settings link with workspace prefix (not current page)
      const settingsLink = page.locator(`.footer-action[href="/workspace/${TEST_WORKSPACE_URL_KEY}/settings"]`);
      await expect(settingsLink).toBeVisible();
      await expect(settingsLink).toContainText('settings');
    });
  });
});
