import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-409: the happy-path roadmap surface (page render, generate stream, pipeline
// UI, reload rehydration) runs on a GENUINE `provider: 'local'` session seeded
// from `workspaceApiLocalSeed` — the same TEST-1..27 fixture the old
// `test-token` + `testMockData` mock returned, so velocity/recently-shipped derive
// from identical data. The AI layer still mocks because `isRoadmapTestMode` now
// delegates to `shouldMockAi`, which re-gates onto local sessions; the local
// session provisions `openRouterConnected` so resolveRoadmapLLM's pre-test-mode
// 503 gate is cleared. The pre-test-mode negative paths (chat/generate 403/503)
// and the multiWorkspace store-isolation cases STAY on `test-token` — they assert
// gates that fire before any provider/AI seam and the local harness seeds one
// workspace.
const TEST_WORKSPACE_URL_KEY = 'test-workspace';
// Pure per-worker URL builders for the local (genuine `provider: 'local'`) blocks;
// the key is supplied per-test from the `localWorkerUrlKey` fixture (LIN-627).
const roadmapUrl = (key) => `/workspace/${key}/roadmap`;
const localGenerateUrl = (key) => `/workspace/${key}/api/roadmap/generate`;
const FEATURES = encodeURIComponent(JSON.stringify({ roadmap: true }));
// Seed options for a roadmap happy-path local session: the feature flag plus a
// mock OpenRouter key (the AI mock fires via shouldMockAi, not this key).
const ROADMAP_SEED_OPTS = { openRouterConnected: true, features: { roadmap: true } };

test.describe('Roadmap Page', () => {
  let ROADMAP_URL;
  test.beforeEach(async ({ seedLocal, localWorkerUrlKey }) => {
    ROADMAP_URL = roadmapUrl(localWorkerUrlKey);
    // Local session backs the page render; roadmap feature enabled.
    await seedLocal(workspaceApiLocalSeed, { features: { roadmap: true } });
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
    // By project is collapsed by default — expand it before inspecting cards.
    await page.locator('.roadmap-milestones > summary').click();
    // Should have at least one milestone card
    const cards = page.locator('.roadmap-milestone-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Each card should have a progress bar
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator('.roadmap-progress-bar')).toBeVisible();
    }
  });

  test('major sections start collapsed; the ship-log recap is open when AI is off', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const byProject = page.locator('.roadmap-milestones');
    // By project is a <details>, collapsed by default — its cards are hidden.
    expect(await byProject.evaluate(el => el.open)).toBe(false);
    await expect(page.locator('.roadmap-milestone-card').first()).toBeHidden();

    // Without AI there is no digest, so the ship log is the recap and starts open.
    expect(await page.locator('.roadmap-ship-log').evaluate(el => el.open)).toBe(true);

    // Clicking the summary expands the section.
    await byProject.locator('> summary').click();
    expect(await byProject.evaluate(el => el.open)).toBe(true);
    await expect(page.locator('.roadmap-milestone-card').first()).toBeVisible();
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

  test('redirects to projects when feature flag is off', async ({ page, seedLocal }) => {
    // Re-seed the local session with roadmap explicitly disabled.
    await seedLocal(workspaceApiLocalSeed, { features: { roadmap: false } });
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Should be redirected to projects page (not on roadmap)
    expect(page.url()).not.toContain('/roadmap');
  });

  test('pipeline section hidden without AI', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Without OpenRouter, pipeline section should be hidden
    const pipelineSection = page.locator('.roadmap-pipeline');
    if (await pipelineSection.count() > 0) {
      await expect(pipelineSection).toHaveClass(/hidden/);
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
// Server-orchestrated generate endpoint (LIN-317): one SSE stream, all layers.
// Replaces the old per-layer narrative endpoints that 413'd on large workspaces.
// =============================================================================

test.describe('Roadmap Generate Endpoint', () => {
  // Negative paths assert pre-test-mode gates (403 flag-off, 503 no-AI) that fire
  // before any provider/AI seam — they stay on `test-token`.
  const GENERATE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/generate`;
  // Happy paths drive the AI-mock layer off a local session — `localGenerateUrl`
  // builds the per-worker URL from the `localWorkerUrlKey` fixture per-test.

  test('returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);
    const response = await request.post(GENERATE_URL, { data: { northStar: 'be useful' } });
    expect(response.status()).toBe(403);
  });

  test('returns 503 when no AI configured', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);
    const response = await request.post(GENERATE_URL, { data: { northStar: 'be useful' } });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('AI not configured');
  });

  test('streams every layer tagged over one SSE connection (with north star)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), { data: { northStar: 'Be the simplest way to ship.' } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');

    const body = await response.text();
    // Every layer streams, tagged with its layer id, over the one connection.
    for (const layer of ['technical', 'product', 'trajectory', 'north-star-reading', 'gap', 'digest']) {
      expect(body).toContain(`"layer":"${layer}"`);
    }
    // Layer lifecycle events and the mock content are present.
    expect(body).toContain('event: layer-start');
    expect(body).toContain('event: layer-done');
    expect(body).toContain('Mock technical narrative');
    expect(body).toContain('Mock summary');
    // Terminal done event closes the stream.
    expect(body.trim().endsWith('event: done\ndata: {}')).toBe(true);
  });

  test('without a north star, skips north-star-reading and gap but still runs the digest', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), { data: { northStar: '' } });
    expect(response.status()).toBe(200);

    const body = await response.text();
    // Layers 1/2/3a and the digest run.
    expect(body).toContain('"layer":"technical"');
    expect(body).toContain('"layer":"product"');
    expect(body).toContain('"layer":"trajectory"');
    expect(body).toContain('"layer":"digest"');
    // The fork-right reading and the gap are skipped server-side.
    expect(body).not.toContain('"layer":"north-star-reading"');
    expect(body).not.toContain('"layer":"gap"');
  });

  // --- Orientation (LIN-300) -------------------------------------------------
  // The orientation step rides the same stream as a single structured
  // `orientation` event (not streamed prose). The route owns 8-point vocabulary
  // normalization; the store owns field shape.

  function parseOrientationEvent(body) {
    const m = body.match(/event: orientation\ndata: (.+)/);
    return m ? JSON.parse(m[1]).orientation : undefined;
  }

  test('emits a normalized orientation event when a north star is set', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), { data: { northStar: 'Be the simplest way to ship.' } });
    const body = await response.text();

    expect(body).toContain('event: orientation');
    const orientation = parseOrientationEvent(body);
    expect(Array.isArray(orientation)).toBe(true);

    // Every entry has the four-field shape and a valid (or empty, if archived)
    // 8-point bearing — the persisted contract LIN-301 depends on.
    const VALID = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (const b of orientation) {
      expect(Object.keys(b).sort()).toEqual(['archived', 'bearing', 'identifier', 'reason']);
      expect(b.bearing === '' ? b.archived : VALID.includes(b.bearing)).toBeTruthy();
    }

    const byId = Object.fromEntries(orientation.map(b => [b.identifier, b]));
    // Clean bearing kept as-is.
    expect(byId['TEST-2'].bearing).toBe('N');
    // Lowercase bearing clamped to upper-case.
    expect(byId['TEST-13'].bearing).toBe('SE');
    // Invalid bearing on a non-archived task is dropped entirely.
    expect(byId['TEST-99']).toBeUndefined();
    // Off-compass archived task kept with an empty bearing.
    expect(byId['TEST-14']).toEqual({
      identifier: 'TEST-14', bearing: '', reason: expect.any(String), archived: true
    });
  });

  // LIN-324 / Strategy E: drive the un-mocked serialize→parse→normalize→emit
  // chain at a realistic candidate count, in the line format that replaced JSON.
  // The ORIENTATION_TEST_BEARINGS short-circuit returns pre-parsed objects, so it
  // never exercises the parse path; the test-only `__testOrientationRaw` seam
  // injects the raw streamed text instead (honoured only in roadmap test mode).
  function parseOrientationEventFull(body) {
    const m = body.match(/event: orientation\ndata: (.+)/);
    return m ? JSON.parse(m[1]) : undefined;
  }

  // Build N candidates in the wire line format: IDENTIFIER | BEARING | reason.
  function orientationLines(n) {
    return Array.from({ length: n }, (_, i) => `BIG-${i} | N | Serves the stated intent.`).join('\n');
  }

  test('realistic-size COMPLETE line payload normalizes to a non-empty array', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), {
      data: { northStar: 'Be the simplest way to ship.', __testOrientationRaw: orientationLines(44) }
    });
    const event = parseOrientationEventFull(await response.text());
    expect(event.orientation.length).toBe(44);          // nothing dropped, nothing swallowed
    expect(event.notice).toBeUndefined();               // clean success carries no note
    expect(event.orientation[0]).toEqual({
      identifier: 'BIG-0', bearing: 'N', reason: 'Serves the stated intent.', archived: false
    });
  });

  test('realistic-size TRUNCATED line payload RECOVERS the complete lines (no silent loss)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const full = orientationLines(44);
    // Cut deep into the final line, as a token-cap overrun would. Unlike the old
    // JSON contract — where this discarded every bearing — the line format keeps
    // every complete line above the cut.
    const truncated = full.slice(0, full.length - 25);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), {
      data: { northStar: 'Be the simplest way to ship.', __testOrientationRaw: truncated }
    });
    const event = parseOrientationEventFull(await response.text());
    expect(event.orientation.length).toBeGreaterThanOrEqual(43); // complete lines survive truncation
    expect(event.notice).toBeUndefined();                         // recovery succeeded — no failure note
    expect(event.orientation.every(b => b.bearing === 'N')).toBe(true);
  });

  test('format drift (JSON instead of lines) surfaces a failure note (not a silent [])', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    // The parser commits to ONE format; a model that ignores it and emits JSON
    // parses to nothing usable. That drift must be SURFACED, not swallowed.
    const drift = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
      identifier: `BIG-${i}`, bearing: 'N', reason: 'x', archived: false
    })));
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), {
      data: { northStar: 'Be the simplest way to ship.', __testOrientationRaw: drift }
    });
    const event = parseOrientationEventFull(await response.text());
    expect(event.orientation).toEqual([]);              // gate stays correct (toggle stays off)
    expect(event.notice).toBeTruthy();                  // but the failure is SURFACED, not swallowed
    expect(event.notice).toMatch(/could not be generated|could not be parsed/i);
  });

  test('without a north star, emits an orientation notice (no bearings)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const response = await page.request.post(localGenerateUrl(localWorkerUrlKey), { data: { northStar: '' } });
    const body = await response.text();
    // D2: rather than emitting nothing (a silently-inert ship toggle), the route
    // now surfaces WHY orientation is unavailable.
    expect(body).toContain('event: orientation');
    const event = parseOrientationEventFull(body);
    expect(event.orientation).toEqual([]);
    expect(event.notice).toBeTruthy();
    expect(event.notice).toMatch(/north star/i);
  });

  test('orientation round-trips: generate → save → fetch persists the bearings', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    await page.request.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);

    // 1. Generate and pull the orientation array off the stream (as the client does).
    const gen = await page.request.post(localGenerateUrl(localWorkerUrlKey), { data: { northStar: 'Be the simplest way to ship.' } });
    const orientation = parseOrientationEvent(await gen.text());
    expect(orientation.length).toBeGreaterThan(0);

    // 2. Save the run with the orientation, exactly like saveReport's POST body.
    const save = await page.request.post(`/workspace/${localWorkerUrlKey}/api/roadmap/reports`, {
      data: { northStar: 'Be the simplest way to ship.', narrative: { digest: 'Mock summary' }, orientation }
    });
    expect(save.status()).toBe(201);
    const { report } = await save.json();

    // 3. Fetch the persisted record and confirm the bearings round-tripped intact.
    const got = await page.request.get(`/workspace/${localWorkerUrlKey}/api/roadmap/reports/${report.id}`);
    expect(got.status()).toBe(200);
    const persisted = (await got.json()).report;
    expect(persisted.orientation).toEqual(orientation);
  });
});

// =============================================================================
// Pipeline UI scaffolding (north star textarea, five section placeholders,
// generate-reading button). With AI configured via openRouterConnected=true.
// =============================================================================

test.describe('Roadmap Pipeline UI', () => {
  let ROADMAP_URL;
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    ROADMAP_URL = roadmapUrl(localWorkerUrlKey);
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    // Start from a clean report store so on-load rehydration (LIN-299) doesn't
    // pre-fill the layer placeholders these tests expect to be idle.
    await page.context().request.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);
  });

  test('renders north star textarea, the digest + five section placeholders, and generate button', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.roadmap-pipeline')).toBeVisible();
    await expect(page.locator('.roadmap-north-star-input')).toBeVisible();
    await expect(page.locator('.roadmap-generate-reading-btn')).toBeVisible();

    // Section placeholders, identified by layer attribute
    await expect(page.locator('[data-layer="digest"]')).toBeVisible();
    await expect(page.locator('[data-layer="technical"]')).toBeVisible();
    await expect(page.locator('[data-layer="product"]')).toBeVisible();
    await expect(page.locator('[data-layer="trajectory"]')).toBeVisible();
    await expect(page.locator('[data-layer="north-star-reading"]')).toBeVisible();
    await expect(page.locator('[data-layer="gap"]')).toBeVisible();
  });

  test('idle digest shows a placeholder hint before any reading exists', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const digest = page.locator('[data-layer="digest"]');
    expect(await digest.getAttribute('data-state')).toBe('idle');
    const hint = await digest.locator('.roadmap-layer-content').evaluate(
      el => getComputedStyle(el, '::before').content
    );
    expect(hint).toContain('Generate a reading');
  });

  test('digest stays open as the recap; the five detail layers fold and start collapsed', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // The digest recap is always-visible (a div, not a collapsible details).
    const digest = page.locator('[data-layer="digest"]');
    expect(await digest.evaluate(el => el.tagName)).toBe('DIV');
    await expect(digest.locator('.roadmap-layer-heading')).toBeVisible();

    // The five detail layers are <details>, collapsed, with content hidden.
    for (const layer of ['technical', 'product', 'trajectory', 'north-star-reading', 'gap']) {
      const el = page.locator(`[data-layer="${layer}"]`);
      expect(await el.evaluate(node => node.tagName)).toBe('DETAILS');
      expect(await el.evaluate(node => node.open)).toBe(false);
      await expect(el.locator('.roadmap-layer-content')).toBeHidden();
    }

    // Expanding one reveals its content area.
    await page.locator('[data-layer="technical"] > summary').click();
    await expect(page.locator('[data-layer="technical"] .roadmap-layer-content')).toBeVisible();
  });

  test('digest placeholder renders first (above the technical narrative)', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // The digest is the lede: its placeholder must precede every other layer
    // in document order, even though it generates last.
    const order = await page.evaluate(() => {
      const layers = Array.from(document.querySelectorAll('[data-layer]'));
      return layers.map(el => el.getAttribute('data-layer'));
    });
    expect(order[0]).toBe('digest');
    expect(order.indexOf('digest')).toBeLessThan(order.indexOf('technical'));
    // And it carries the emphasis modifier so it reads as the lede, not a peer.
    await expect(page.locator('[data-layer="digest"]')).toHaveClass(/roadmap-layer--digest/);
  });

  test('trajectory and north-star-reading render as siblings with identical structure', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // The two forked layers should share a parent container with the same
    // heading element so visual framing renders neither as primary.
    const trajectory = page.locator('[data-layer="trajectory"]');
    const nsReading = page.locator('[data-layer="north-star-reading"]');
    await expect(trajectory.locator('.roadmap-layer-heading')).toBeVisible();
    await expect(nsReading.locator('.roadmap-layer-heading')).toBeVisible();
  });

  test('north star textarea is hidden when AI is not configured', async ({ page, seedLocal }) => {
    // Override the beforeEach: local session WITHOUT openRouterConnected.
    await seedLocal(workspaceApiLocalSeed, { features: { roadmap: true } });
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const pipelineSection = page.locator('.roadmap-pipeline');
    if (await pipelineSection.count() > 0) {
      await expect(pipelineSection).toHaveClass(/hidden/);
    }
  });

  test('north star textarea loads saved value on page load', async ({ page, localWorkerUrlKey }) => {
    // Save a value via the API using the page's cookie context
    const saved = 'Be the simplest way to ship.';
    const pageRequest = page.context().request;
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: saved }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('.roadmap-north-star-input');
    await expect(textarea).toHaveValue(saved);
  });

  test('north star textarea saves changes on blur', async ({ page, localWorkerUrlKey }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('.roadmap-north-star-input');
    await textarea.fill('Updated north star value.');
    await textarea.blur();

    // Wait briefly for the blurred save to land
    await page.waitForTimeout(500);

    const pageRequest = page.context().request;
    const response = await pageRequest.get(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`);
    const body = await response.json();
    expect(body.northStar).toBe('Updated north star value.');
  });

  test('all sections show "not yet" state before generate', async ({ page }) => {
    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    // Each layer placeholder should have status text indicating it has not yet generated
    const layers = ['digest', 'technical', 'product', 'trajectory', 'north-star-reading', 'gap'];
    for (const layer of layers) {
      const section = page.locator(`[data-layer="${layer}"]`);
      await expect(section).toBeVisible();
      // Default state class signals "not yet generated"
      await expect(section).toHaveAttribute('data-state', 'idle');
    }
  });

  test('clicking generate-reading runs all layers (including the digest) when north star is set', async ({ page, localWorkerUrlKey }) => {
    // Pre-set a north star so layers 3b and 4 fire
    const pageRequest = page.context().request;
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: 'Be the simplest way to ship.' }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const btn = page.locator('.roadmap-generate-reading-btn');
    await btn.click();

    // Each layer should populate from its mock SSE stream. The digest is the
    // synthesis layer — it generates last but lives at the top of the reading.
    const expectedTexts = {
      'technical': 'Mock technical narrative',
      'product': 'Mock product perspective',
      'trajectory': 'Mock trajectory',
      'north-star-reading': 'Mock north star reading',
      'gap': 'Mock gap analysis',
      'digest': 'Mock summary'
    };

    for (const [layer, text] of Object.entries(expectedTexts)) {
      const content = page.locator(`[data-layer="${layer}"] .roadmap-layer-content`);
      await expect(content).toContainText(text, { timeout: 10000 });
    }

    // Each layer's data-state should be 'done' after completion
    for (const layer of Object.keys(expectedTexts)) {
      await expect(page.locator(`[data-layer="${layer}"]`)).toHaveAttribute('data-state', 'done', { timeout: 10000 });
    }

    // Button should be re-enabled with regenerate label
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText(/regenerate/i);
  });

  test('without a north star, layers 3b and 4 show CTA and do not run', async ({ page, localWorkerUrlKey }) => {
    // Ensure north star is empty
    const pageRequest = page.context().request;
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: '' }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const btn = page.locator('.roadmap-generate-reading-btn');
    await btn.click();

    // Layers 1, 2, 3a populate
    await expect(page.locator('[data-layer="technical"] .roadmap-layer-content')).toContainText('Mock technical', { timeout: 10000 });
    await expect(page.locator('[data-layer="product"] .roadmap-layer-content')).toContainText('Mock product', { timeout: 10000 });
    await expect(page.locator('[data-layer="trajectory"] .roadmap-layer-content')).toContainText('Mock trajectory', { timeout: 10000 });

    // Layer 3b and 4 stay in not-available state, no streamed content
    await expect(page.locator('[data-layer="north-star-reading"]')).toHaveAttribute('data-state', 'not-available');
    await expect(page.locator('[data-layer="gap"]')).toHaveAttribute('data-state', 'not-available');
    await expect(page.locator('[data-layer="north-star-reading"] .roadmap-layer-content')).toBeEmpty();
    await expect(page.locator('[data-layer="gap"] .roadmap-layer-content')).toBeEmpty();

    // The digest still runs — it degrades to layers 1/2/3a when there's no north star.
    await expect(page.locator('[data-layer="digest"] .roadmap-layer-content')).toContainText('Mock summary', { timeout: 10000 });
    await expect(page.locator('[data-layer="digest"]')).toHaveAttribute('data-state', 'done', { timeout: 10000 });
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

// =============================================================================
// Report history store (LIN-299): save/list/read of durable report runs.
// =============================================================================

test.describe('Roadmap Report History', () => {
  const REPORTS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/reports`;

  const sampleNarrative = (tag = '') => ({
    technical: 'tech ' + tag,
    product: 'product ' + tag,
    trajectory: 'trajectory ' + tag,
    northStarReading: 'ns reading ' + tag,
    gap: 'gap ' + tag
  });

  test.beforeEach(async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}`);
    await request.get('/test/clear-report-history');
  });

  test('POST returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);
    const response = await request.post(REPORTS_URL, { data: { narrative: sampleNarrative() } });
    expect(response.status()).toBe(403);
  });

  test('GET returns 403 when feature flag is off', async ({ request }) => {
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);
    const response = await request.get(REPORTS_URL);
    expect(response.status()).toBe(403);
  });

  test('POST returns 400 when narrative missing', async ({ request }) => {
    const response = await request.post(REPORTS_URL, { data: { northStar: 'x' } });
    expect(response.status()).toBe(400);
  });

  test('POST then GET round-trips a report (model + timestamp stamped server-side)', async ({ request }) => {
    const postRes = await request.post(REPORTS_URL, {
      data: { northStar: 'be useful', narrative: sampleNarrative('a') }
    });
    expect(postRes.status()).toBe(201);
    const { report } = await postRes.json();
    expect(report.id).toBeTruthy();
    expect(report.model).toBeTruthy();               // stamped server-side
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.northStar).toBe('be useful');
    expect(report.narrative.technical).toBe('tech a');
    expect(report.orientation).toEqual([]);          // shape present for Step 1

    // List returns lightweight summaries (no narrative bodies).
    const listRes = await request.get(REPORTS_URL);
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.total).toBe(1);
    expect(listBody.reports[0].id).toBe(report.id);
    expect(listBody.reports[0].northStar).toBe('be useful');
    expect(listBody.reports[0].narrative).toBeUndefined();

    // The full record (with narratives) is fetched by id.
    const oneRes = await request.get(`${REPORTS_URL}/${report.id}`);
    expect(oneRes.status()).toBe(200);
    expect((await oneRes.json()).report.narrative.gap).toBe('gap a');
  });

  test('GET :id returns 404 for an unknown report', async ({ request }) => {
    const response = await request.get(`${REPORTS_URL}/does-not-exist`);
    expect(response.status()).toBe(404);
  });

  test('GET :id returns 403 when feature flag is off', async ({ request }) => {
    const { report } = await (await request.post(REPORTS_URL, { data: { narrative: sampleNarrative() } })).json();
    const noRoadmap = encodeURIComponent(JSON.stringify({ roadmap: false }));
    await request.get(`/test/set-session?features=${noRoadmap}`);
    const response = await request.get(`${REPORTS_URL}/${report.id}`);
    expect(response.status()).toBe(403);
  });

  test('list returns newest-first', async ({ request }) => {
    const first = await (await request.post(REPORTS_URL, { data: { narrative: sampleNarrative('first') } })).json();
    await new Promise(r => setTimeout(r, 20));
    const second = await (await request.post(REPORTS_URL, { data: { narrative: sampleNarrative('second') } })).json();

    const listBody = await (await request.get(REPORTS_URL)).json();
    expect(listBody.total).toBe(2);
    expect(listBody.reports[0].id).toBe(second.report.id);
    expect(listBody.reports[1].id).toBe(first.report.id);
  });

  test('limit caps the number of returned reports', async ({ request }) => {
    await request.post(REPORTS_URL, { data: { narrative: sampleNarrative('1') } });
    await request.post(REPORTS_URL, { data: { narrative: sampleNarrative('2') } });
    const listBody = await (await request.get(`${REPORTS_URL}?limit=1`)).json();
    expect(listBody.total).toBe(2);
    expect(listBody.reports.length).toBe(1);
  });

  test('reports are scoped per workspace', async ({ request }) => {
    await request.get(`/test/set-session?features=${FEATURES}&multiWorkspace=true`);
    await request.get('/test/clear-report-history?urlKey=test-workspace');
    await request.get('/test/clear-report-history?urlKey=second-workspace');

    const url1 = `/workspace/test-workspace/api/roadmap/reports`;
    const url2 = `/workspace/second-workspace/api/roadmap/reports`;
    await request.post(url1, { data: { narrative: sampleNarrative('ws1') } });

    expect((await (await request.get(url1)).json()).total).toBe(1);
    expect((await (await request.get(url2)).json()).total).toBe(0);
  });
});

test.describe('Roadmap Report History — reload rehydration (UI)', () => {
  test('a generated reading is restored after reload', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const ROADMAP_URL = roadmapUrl(localWorkerUrlKey);
    // Session setup must happen on the page's own cookie context.
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const pageRequest = page.context().request;
    await pageRequest.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);

    // Pre-set a north star so all five layers run.
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: 'Be the simplest way to ship.' }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('.roadmap-generate-reading-btn').click();
    // Wait for the run to complete (gap is the last layer).
    await expect(page.locator('[data-layer="gap"]')).toHaveAttribute('data-state', 'done', { timeout: 10000 });

    // Give the best-effort save POST time to land before reloading.
    await page.waitForTimeout(800);

    await page.reload();
    await page.waitForLoadState('networkidle');

    // The most recent report should be rehydrated into the layer placeholders.
    await expect(page.locator('[data-layer="technical"] .roadmap-layer-content'))
      .toContainText('Mock technical', { timeout: 10000 });
    await expect(page.locator('[data-layer="gap"] .roadmap-layer-content'))
      .toContainText('Mock gap', { timeout: 10000 });
    await expect(page.locator('[data-layer="technical"]')).toHaveAttribute('data-state', 'done');
    // Button reflects that a prior reading exists.
    await expect(page.locator('.roadmap-generate-reading-btn')).toContainText(/regenerate/i);
  });

  test('orientation bearings render on the page and rehydrate after reload (LIN-324/D)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const ROADMAP_URL = roadmapUrl(localWorkerUrlKey);
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const pageRequest = page.context().request;
    await pageRequest.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);
    // A north star is required for orientation to run.
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: 'Be the simplest way to ship.' }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('.roadmap-generate-reading-btn').click();
    await expect(page.locator('[data-layer="gap"]')).toHaveAttribute('data-state', 'done', { timeout: 10000 });

    // Visible result = the operator's own check that orientation generation
    // worked end-to-end. The mock bearings place TEST-2 (N) and TEST-13 (SE),
    // and flag TEST-14 off-compass (overboard); TEST-99's invalid bearing was
    // dropped server-side, so three rows render.
    const result = page.locator('#roadmap-orientation-result');
    await expect(result).toBeVisible({ timeout: 10000 });
    await expect(result.locator('.roadmap-orientation-row')).toHaveCount(3);
    await result.locator('summary').click(); // expand the collapsed details
    await expect(result.locator('[data-bearing="N"]').first()).toBeVisible();
    await expect(result.locator('[data-overboard="true"]').first()).toBeVisible();

    // Let the best-effort save land, then reload: the saved bearings rehydrate
    // through applyReport without regenerating.
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#roadmap-orientation-result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#roadmap-orientation-result .roadmap-orientation-row')).toHaveCount(3);
  });

  test('history lists past readings; selecting an older one shows a viewing banner', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const ROADMAP_URL = roadmapUrl(localWorkerUrlKey);
    await seedLocal(workspaceApiLocalSeed, ROADMAP_SEED_OPTS);
    const pageRequest = page.context().request;
    await pageRequest.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);
    await pageRequest.put(`/workspace/${localWorkerUrlKey}/api/roadmap/north-star`, {
      data: { northStar: 'Be the simplest way to ship.' }
    });

    await page.goto(ROADMAP_URL);
    await page.waitForLoadState('networkidle');

    const btn = page.locator('.roadmap-generate-reading-btn');

    // First reading → history shows one entry.
    await btn.click();
    await expect(page.locator('[data-layer="gap"]')).toHaveAttribute('data-state', 'done', { timeout: 10000 });
    await expect(page.locator('.roadmap-history-details summary')).toContainText('Past readings (1)', { timeout: 10000 });

    // Second reading → two entries.
    await btn.click();
    await expect(page.locator('[data-layer="gap"]')).toHaveAttribute('data-state', 'done', { timeout: 10000 });
    await expect(page.locator('.roadmap-history-details summary')).toContainText('Past readings (2)', { timeout: 10000 });

    // Open the list; newest is tagged "latest"; banner hidden while on latest.
    await page.locator('.roadmap-history-details summary').click();
    const rows = page.locator('.roadmap-history-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.roadmap-history-latest')).toBeVisible();
    await expect(page.locator('#roadmap-history-viewing')).toBeHidden();

    // Select the older reading → viewing banner appears, row marked selected.
    await rows.nth(1).click();
    await expect(page.locator('#roadmap-history-viewing')).toBeVisible();
    await expect(page.locator('#roadmap-history-viewing')).toContainText('Viewing a saved reading');
    await expect(rows.nth(1)).toHaveClass(/roadmap-history-row--selected/);

    // "view latest" returns to the newest reading and hides the banner.
    await page.locator('.roadmap-history-view-latest').click();
    await expect(page.locator('#roadmap-history-viewing')).toBeHidden();
  });
});
