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

  test('shows page header with delivery-cadence framing', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.roadmap-header')).toBeVisible();
    await expect(page.locator('.roadmap-page-title')).toContainText('Roadmap');
    // Time window anchor
    await expect(page.locator('.roadmap-header-meta')).toContainText('last 90 days');
    // Velocity panel (projection-flavored) was removed
    await expect(page.locator('.roadmap-velocity-panel')).toHaveCount(0);
  });

  test('shows recently shipped section', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.roadmap-ship-log')).toBeVisible();
    await expect(page.locator('.roadmap-ship-log .roadmap-section-heading'))
      .toContainText('Recently shipped');
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

  test('milestone cards show progress without projection fields', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const firstCard = page.locator('.roadmap-milestone-card').first();
    const cardText = await firstCard.textContent();
    // Progress is shown in the header (e.g. "50% · 6/12 done")
    expect(cardText).toMatch(/\d+%/);
    expect(cardText).toContain('done');
    // Projection-flavored fields should not appear
    expect(cardText).not.toContain('projected:');
    expect(cardText).not.toContain('confidence:');
    expect(cardText).not.toMatch(/points:\s*\d/);
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

// =============================================================================
// Pipeline layer endpoints (technical / product / trajectory / north-star / gap)
// =============================================================================

test.describe('Roadmap Pipeline Layer Endpoints', () => {
  const TECH_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative/technical`;
  const PRODUCT_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative/product`;
  const TRAJECTORY_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative/trajectory`;
  const NS_READING_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative/north-star`;
  const GAP_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/narrative/gap`;

  const SAMPLE_MODEL = { velocity: { tasksPerWeek: 4 }, milestones: [] };

  const endpoints = [
    { name: 'technical', url: TECH_URL, body: { roadmapModel: SAMPLE_MODEL } },
    { name: 'product',   url: PRODUCT_URL, body: { roadmapModel: SAMPLE_MODEL, tech: 'tech narrative text' } },
    { name: 'trajectory', url: TRAJECTORY_URL, body: { roadmapModel: SAMPLE_MODEL, tech: 'tech text', product: 'product text' } },
    { name: 'north-star reading', url: NS_READING_URL, body: { roadmapModel: SAMPLE_MODEL, northStar: 'be useful' } },
    { name: 'gap', url: GAP_URL, body: { northStar: 'be useful', trajectory: 'going there', nsReading: 'aligned' } },
  ];

  for (const ep of endpoints) {
    test(`${ep.name}: returns 403 when feature flag is off`, async ({ request }) => {
      const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
      await request.get(`/test/set-session?features=${noRoadmap}`);
      const response = await request.post(ep.url, { data: ep.body });
      expect(response.status()).toBe(403);
    });

    test(`${ep.name}: returns 503 when no AI configured`, async ({ request }) => {
      await request.get(`/test/set-session?features=${FEATURES}`);
      const response = await request.post(ep.url, { data: ep.body });
      expect(response.status()).toBe(503);
      const body = await response.json();
      expect(body.error).toContain('AI not configured');
    });
  }

  // Per-endpoint body validation
  test('technical: returns 400 when roadmapModel missing', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(TECH_URL, { data: {} });
    expect(response.status()).toBe(400);
  });

  test('product: returns 400 when tech missing', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(PRODUCT_URL, { data: { roadmapModel: SAMPLE_MODEL } });
    expect(response.status()).toBe(400);
  });

  test('trajectory: returns 400 when product missing', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(TRAJECTORY_URL, {
      data: { roadmapModel: SAMPLE_MODEL, tech: 'x' }
    });
    expect(response.status()).toBe(400);
  });

  test('north-star reading: returns 400 when northStar missing', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(NS_READING_URL, {
      data: { roadmapModel: SAMPLE_MODEL }
    });
    expect(response.status()).toBe(400);
  });

  test('north-star reading: returns 400 when northStar is empty string', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(NS_READING_URL, {
      data: { roadmapModel: SAMPLE_MODEL, northStar: '' }
    });
    expect(response.status()).toBe(400);
  });

  test('gap: returns 400 when any of northStar/trajectory/nsReading missing', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&openRouterConnected=true`);
    const response = await request.post(GAP_URL, {
      data: { northStar: 'x', trajectory: 'y' }
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('Roadmap North Star Storage', () => {
  const NORTH_STAR_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/north-star`;

  test('GET returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);

    const response = await request.get(NORTH_STAR_URL);
    expect(response.status()).toBe(403);
  });

  test('PUT returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);

    const response = await request.put(NORTH_STAR_URL, {
      data: { northStar: 'test' }
    });
    expect(response.status()).toBe(403);
  });

  test('GET returns empty string by default', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    const response = await request.get(NORTH_STAR_URL);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('northStar');
    expect(body.northStar).toBe('');
  });

  test('PUT then GET round-trips the value', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    const text = 'Become the simplest way for non-technical founders to ship a product.';
    const putRes = await request.put(NORTH_STAR_URL, {
      data: { northStar: text }
    });
    expect(putRes.status()).toBe(200);
    const putBody = await putRes.json();
    expect(putBody).toMatchObject({ ok: true });

    const getRes = await request.get(NORTH_STAR_URL);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.northStar).toBe(text);
  });

  test('PUT rejects non-string body', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    const response = await request.put(NORTH_STAR_URL, {
      data: { northStar: 123 }
    });
    expect(response.status()).toBe(400);
  });

  test('PUT rejects oversized input', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    const huge = 'x'.repeat(9000);
    const response = await request.put(NORTH_STAR_URL, {
      data: { northStar: huge }
    });
    expect(response.status()).toBe(400);
  });

  test('PUT accepts empty string (clearing the value)', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);

    // Set a value first
    await request.put(NORTH_STAR_URL, { data: { northStar: 'initial' } });

    // Now clear it
    const clearRes = await request.put(NORTH_STAR_URL, {
      data: { northStar: '' }
    });
    expect(clearRes.status()).toBe(200);

    const getRes = await request.get(NORTH_STAR_URL);
    const body = await getRes.json();
    expect(body.northStar).toBe('');
  });

  test('values are scoped per workspace', async ({ request }) => {
    // Set up two workspaces via the multiWorkspace test flag
    await request.get(`/test/set-session?features=${FEATURES}&multiWorkspace=true`);

    const url1 = `/workspace/test-workspace/api/roadmap/north-star`;
    const url2 = `/workspace/second-workspace/api/roadmap/north-star`;

    await request.put(url1, { data: { northStar: 'star one' } });
    await request.put(url2, { data: { northStar: 'star two' } });

    const get1 = await request.get(url1);
    const get2 = await request.get(url2);
    expect((await get1.json()).northStar).toBe('star one');
    expect((await get2.json()).northStar).toBe('star two');
  });
});
