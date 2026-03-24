import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const ROADMAP_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/roadmap`;
const FEATURES = encodeURIComponent(JSON.stringify({ roadmap: true }));

test.describe('Roadmap Page', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test session with roadmap feature enabled
    await page.goto(`/test/set-session?features=${FEATURES}`);
  });

  test('loads roadmap page with deterministic data', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Page should have roadmap-page class
    await expect(page.locator('.roadmap-page')).toBeVisible();
  });

  test('shows velocity panel', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Velocity panel should be visible
    await expect(page.locator('.roadmap-velocity-panel')).toBeVisible();
  });

  test('shows milestone cards from mock projects', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Should have milestone section
    await expect(page.locator('.roadmap-milestones')).toBeVisible();
  });

  test('redirects to projects when feature flag is off', async ({ page }) => {
    // Set session with roadmap explicitly disabled
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await page.goto(`/test/set-session?features=${noRoadmap}`);
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Should be redirected to projects page (not on roadmap)
    expect(page.url()).not.toContain('/roadmap');
  });

  test('narrative section hidden without AI', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Without OpenRouter, narrative section should be hidden
    const narrativeSection = page.locator('.roadmap-narrative');
    if (await narrativeSection.count() > 0) {
      await expect(narrativeSection).toHaveClass(/hidden/);
    }
  });

  test('chat section hidden without AI', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Without OpenRouter, chat section should be hidden
    const chatSection = page.locator('.roadmap-chat');
    if (await chatSection.count() > 0) {
      await expect(chatSection).toHaveClass(/hidden/);
    }
  });

  test('page has correct title', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/Roadmap/);
  });

  test('back to projects link is present', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Should have a link back to projects
    const projectsLink = page.locator('a:has-text("projects")');
    await expect(projectsLink).toBeVisible();
  });
});
