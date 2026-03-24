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

  test('shows velocity panel with stats', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Velocity panel should be visible with expected structure
    await expect(page.locator('.roadmap-velocity-panel')).toBeVisible();
    await expect(page.locator('.roadmap-velocity-stats')).toBeVisible();
    // Should show tasks/week and points/week labels
    await expect(page.locator('text=tasks/week')).toBeVisible();
    await expect(page.locator('text=points/week')).toBeVisible();
  });

  test('shows milestone cards with progress bars', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Should have milestone section
    await expect(page.locator('.roadmap-milestones')).toBeVisible();
    // Should have at least one milestone card
    const cards = page.locator('.roadmap-milestone-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Each card should have a progress bar
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator('.roadmap-progress-bar')).toBeVisible();
    }
  });

  test('milestone cards show remaining tasks and points', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const firstCard = page.locator('.roadmap-milestone-card').first();
    const statsText = await firstCard.locator('.roadmap-milestone-stats').textContent();
    // Should contain task and point info
    expect(statsText).toContain('remaining:');
    expect(statsText).toContain('points:');
    expect(statsText).toContain('projected:');
    expect(statsText).toContain('confidence:');
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

  test('embeds __ROADMAP_DATA__ in page', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Verify the embedded data is parseable and has expected structure
    const roadmapData = await page.evaluate(() => window.__ROADMAP_DATA__);
    expect(roadmapData).toBeTruthy();
    expect(roadmapData).toHaveProperty('velocity');
    expect(roadmapData).toHaveProperty('milestones');
    expect(roadmapData).toHaveProperty('hasAI');
    expect(roadmapData).toHaveProperty('urlKey');
    expect(roadmapData.velocity).toHaveProperty('tasksPerWeek');
    expect(roadmapData.velocity).toHaveProperty('pointsPerWeek');
    expect(roadmapData.velocity).toHaveProperty('trend');
  });
});

test.describe('Roadmap API Endpoints', () => {
  test('narrative endpoint returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);

    const response = await request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative`, {
      data: { roadmapModel: { velocity: {}, milestones: [] } }
    });
    expect(response.status()).toBe(403);
  });

  test('narrative endpoint returns 503 when no AI configured', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    // Without OPENROUTER_API_KEY, should get 503
    const response = await request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative`, {
      data: { roadmapModel: { velocity: {}, milestones: [] } }
    });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('AI not configured');
  });

  test('chat endpoint returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);

    const response = await request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/chat`, {
      data: { question: 'test', roadmapModel: {} }
    });
    expect(response.status()).toBe(403);
  });

  test('chat endpoint returns 503 when no AI configured', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    // Without OPENROUTER_API_KEY, should get 503 before body validation
    const response = await request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/chat`, {
      data: { question: 'test', roadmapModel: {} }
    });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('AI not configured');
  });
});
