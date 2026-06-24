/**
 * Pipeline Scenarios — E2E tests with real dispatch/agent data.
 *
 * These tests act as a fake dispatch consumer: queue prompts, take items,
 * post agent status — then load the pipeline page and assert the UI
 * renders correctly from the real data flow.
 *
 * Separate from pipeline.spec.js (which covers structure, gating, and
 * accessibility with empty data).
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, pipelineLocalSeed } from '../fixtures/local-harness.js';

// LIN-387: real dispatch→take→agent flow runs against the local-provider
// workspace. Tokens/clears are scoped to the per-worker key via the shared
// harness's `?urlKey=` param; the seed reuses testMockData so the asserted
// identifiers/titles (TEST-14 'Add pagination to user list', TEST-15) are
// unchanged.
//
// LIN-627: the workspace key + nav/API URLs are bound per-test from the
// `localWorkerUrlKey` worker fixture by the top-level beforeEach below; the
// helpers read these module-scoped lets. Playwright workers are separate
// processes, so this is per-worker state, never shared across parallel workers.
let WS, PIPELINE_URL, API;
const FEATURES = { pipeline: true, dispatch: true, proxy: true };

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clear all dispatch/agent state and set session with required features.
 */
async function setupCleanSession(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${WS}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${WS}`);
  await page.goto(`/test/clear-dispatch-tokens?urlKey=${WS}`);
  await page.goto(`/test/clear-proxy-tokens?urlKey=${WS}`);
  await page.goto(`/test/clear-agent-status?urlKey=${WS}`);
  await seedLocalWorkspace(page, pipelineLocalSeed, { features: FEATURES, urlKey: WS });
}

/**
 * Create a consumer (dispatch) token scoped to the local workspace.
 * Returns the Bearer token string.
 */
async function createConsumerToken(page) {
  const resp = await page.goto(`/test/create-dispatch-token?urlKey=${WS}`);
  const data = JSON.parse(await resp.text());
  return data.token;
}

/**
 * Create a readWrite proxy token scoped to the local workspace.
 * Returns the Bearer token string.
 */
async function createProxyToken(page) {
  const resp = await page.goto(`/test/create-proxy-token?scope=readWrite&urlKey=${WS}`);
  const data = JSON.parse(await resp.text());
  return data.token;
}

/**
 * Dispatch a prompt for a specific issue. Returns the item object.
 * Uses page.request (shares session cookies with the browser context).
 */
async function dispatchForIssue(page, { issueIdentifier, issueId, issueTitle, promptName, prompt }) {
  const resp = await page.request.post(`${API}/api/dispatch`, {
    data: {
      prompt: prompt || `Work on ${issueIdentifier}`,
      promptName: promptName || 'implementation',
      issueId: issueId || null,
      issueIdentifier,
      issueTitle: issueTitle || null,
      target: 'cli'
    }
  });
  expect(resp.status(), `dispatch POST failed: ${await resp.text()}`).toBe(201);
  const data = await resp.json();
  return data.item;
}

/**
 * Take a dispatch item (simulates agent claiming it).
 * Consumer endpoints use Bearer token auth, not session cookies.
 */
async function takeItem(page, itemId, consumerToken) {
  const resp = await page.request.post(`/api/dispatch/take/${itemId}`, {
    headers: { Authorization: `Bearer ${consumerToken}` }
  });
  return resp.json();
}

/**
 * Post a agent status for an issue (simulates agent completion/failure).
 * Proxy endpoints use Bearer token auth.
 */
async function postAgentStatus(page, proxyToken, { taskIdentifier, action, status, summary, dispatchId }) {
  const resp = await page.request.post('/api/proxy/agent/status', {
    headers: {
      Authorization: `Bearer ${proxyToken}`,
      'Content-Type': 'application/json'
    },
    data: {
      taskIdentifier,
      action: action || 'implementation',
      status,
      summary: summary || `Agent ${status} on ${taskIdentifier}`,
      ...(dispatchId ? { dispatchId } : {})
    }
  });
  return resp.json();
}

/**
 * Create a completed loop: dispatch → take → agent completed.
 * Returns the dispatch item for chaining.
 */
async function createCompletedLoop(page, consumerToken, proxyToken, { issueIdentifier, promptName, action }) {
  const item = await dispatchForIssue(page, { issueIdentifier, promptName: promptName || 'implementation' });
  await takeItem(page, item.id, consumerToken);
  await postAgentStatus(page, proxyToken, {
    taskIdentifier: issueIdentifier,
    action: action || promptName || 'implementation',
    status: 'completed',
    summary: `Completed ${promptName || 'implementation'} for ${issueIdentifier}`,
    dispatchId: item.id
  });
  return item;
}

/**
 * Navigate to the pipeline page with polling intercepted.
 * The SSR embed carries the real snapshot; the intercept only freezes
 * the 5s client poll to prevent overwrites during assertions.
 */
async function loadPipelinePage(page) {
  await page.route('**/api/pipeline/state', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] })
    })
  );
  await page.goto(PIPELINE_URL);
  await page.waitForLoadState('networkidle');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Pipeline Scenarios', () => {
  // Bind the per-worker key + URLs before every test (and before the nested
  // beforeEach hooks that call setupCleanSession). LIN-627.
  test.beforeEach(({ localWorkerUrlKey }) => {
    WS = localWorkerUrlKey;
    PIPELINE_URL = `/workspace/${WS}/pipeline`;
    API = `/workspace/${WS}`;
  });

  // ── Single Active Task ──────────────────────────────────────────────────

  test.describe('Single Active Task', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('cell appears in active grid when task is taken', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        issueId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef',
        promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell).toBeVisible();
      await expect(cell).toHaveAttribute('data-agent-state', 'running');
    });

    test('cell shows correct content', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell.locator('.cell-id')).toContainText('TEST-14');
      await expect(cell.locator('.cell-stage')).toContainText('impl');
      await expect(cell.locator('.cell-state')).toHaveClass(/state-running/);
      await expect(cell.locator('.cell-loops')).toContainText('1');
    });

    test('active task is removed from queue', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      // TEST-14 should NOT appear in the queue rail
      const queueEntry = page.locator('.queue-entry[data-identifier="TEST-14"]');
      await expect(queueEntry).toHaveCount(0);
    });
  });

  // ── Multiple Active Tasks ───────────────────────────────────────────────

  test.describe('Multiple Active Tasks', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('grid shows multiple cells', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);

      const item14 = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item14.id, consumerToken);

      const item15 = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-15',
        promptName: 'review'
      });
      await takeItem(page, item15.id, consumerToken);

      await loadPipelinePage(page);

      await expect(page.locator('.pipeline-cell[data-identifier="TEST-14"]')).toBeVisible();
      await expect(page.locator('.pipeline-cell[data-identifier="TEST-15"]')).toBeVisible();
    });

    test('cells show different stages', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);

      const item14 = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item14.id, consumerToken);

      const item15 = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-15',
        promptName: 'review'
      });
      await takeItem(page, item15.id, consumerToken);

      await loadPipelinePage(page);

      const cell14 = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const cell15 = page.locator('.pipeline-cell[data-identifier="TEST-15"]');
      await expect(cell14.locator('.cell-stage')).toContainText('impl');
      await expect(cell15.locator('.cell-stage')).toContainText('review');
    });
  });

  // ── Completed Loop → Activity Feed ──────────────────────────────────────

  test.describe('Completed Loop', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('completed task appears in activity feed', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });

      await loadPipelinePage(page);

      const activity = page.locator('.activity-entry');
      await expect(activity.first()).toBeVisible();

      // Find the entry for TEST-14
      const entry = page.locator('.activity-entry:has(.activity-id:text("TEST-14"))');
      await expect(entry).toBeVisible();
      await expect(entry.locator('.activity-state')).toHaveClass(/state-complete/);
    });

    test('completed task stays active when state is started', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });

      await loadPipelinePage(page);

      // TEST-14 state is "started" → remains in active grid even after loop completes
      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell).toBeVisible();
    });

    test('state API confirms completed loop in recent', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });

      const resp = await page.request.get(`${API}/api/pipeline/state`);
      const data = await resp.json();

      const recentLoop = data.recent.find(l => l.issueIdentifier === 'TEST-14');
      expect(recentLoop).toBeTruthy();
      expect(recentLoop.agentState).toBe('complete');
      expect(recentLoop.agentStatus).toBe('completed');
    });
  });

  // ── Failed Loop ─────────────────────────────────────────────────────────

  test.describe('Failed Loop', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('error appears in activity feed', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);
      await postAgentStatus(page, proxyToken, {
        taskIdentifier: 'TEST-14',
        action: 'implementation',
        status: 'failed',
        summary: 'Build errors in auth module',
        dispatchId: item.id
      });

      await loadPipelinePage(page);

      const entry = page.locator('.activity-entry:has(.activity-id:text("TEST-14"))');
      await expect(entry).toBeVisible();
      await expect(entry.locator('.activity-state')).toHaveClass(/state-error/);
    });

    test('state API confirms error loop', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14',
        promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);
      await postAgentStatus(page, proxyToken, {
        taskIdentifier: 'TEST-14',
        action: 'implementation',
        status: 'failed',
        summary: 'Build errors',
        dispatchId: item.id
      });

      const resp = await page.request.get(`${API}/api/pipeline/state`);
      const data = await resp.json();

      const recentLoop = data.recent.find(l => l.issueIdentifier === 'TEST-14');
      expect(recentLoop).toBeTruthy();
      expect(recentLoop.agentState).toBe('error');
      expect(recentLoop.agentStatus).toBe('failed');
    });
  });

  // ── Health Color Progression ────────────────────────────────────────────

  test.describe('Health Color Progression', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('green health with 3 loops', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 2 completed + 1 running = 3 loops → green
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'review'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell).toHaveClass(/health-green/);
      await expect(cell.locator('.cell-loops')).toContainText('3');
    });

    test('amber health with 5 loops', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 4 completed + 1 running = 5 loops → amber
      for (let i = 0; i < 4; i++) {
        await createCompletedLoop(page, consumerToken, proxyToken, {
          issueIdentifier: 'TEST-14', promptName: 'implementation'
        });
      }

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell).toHaveClass(/health-amber/);
      await expect(cell.locator('.cell-loops')).toContainText('5');
    });

    test('red health with 8 loops', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 7 completed + 1 running = 8 loops → red
      for (let i = 0; i < 7; i++) {
        await createCompletedLoop(page, consumerToken, proxyToken, {
          issueIdentifier: 'TEST-14', promptName: 'implementation'
        });
      }

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      await expect(cell).toHaveClass(/health-red/);
      await expect(cell.locator('.cell-loops')).toContainText('8');
    });
  });

  // ── Overlay from Active Cell ────────────────────────────────────────────

  test.describe('Overlay from Active Cell', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('overlay opens on cell click', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      await page.locator('.pipeline-cell[data-identifier="TEST-14"]').click();

      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).not.toHaveClass(/hidden/, { timeout: 5000 });
      await expect(page.locator('.overlay-content')).toBeVisible();
    });

    test('overlay shows task header', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);
      await page.locator('.pipeline-cell[data-identifier="TEST-14"]').click();

      await expect(page.locator('.overlay-id')).toContainText('TEST-14', { timeout: 5000 });
      await expect(page.locator('.overlay-title')).toContainText('Add pagination to user list');
    });

    test('overlay shows loop history with correct entries', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 2 completed + 1 running = 3 loops
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'review'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);
      await page.locator('.pipeline-cell[data-identifier="TEST-14"]').click();

      // Wait for overlay to load
      await expect(page.locator('.overlay-section-title')).toContainText('loop history', { timeout: 5000 });

      // 3 loop entries (newest first)
      const loopEntries = page.locator('.loop-entry');
      await expect(loopEntries).toHaveCount(3);

      // First entry (newest) should be running with pulse
      await expect(loopEntries.first()).toHaveClass(/loop-pulse/);
      await expect(loopEntries.first().locator('.loop-state')).toHaveClass(/state-running/);
    });

    test('overlay shows loop count with health color', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);
      await page.locator('.pipeline-cell[data-identifier="TEST-14"]').click();

      const loopsCount = page.locator('.overlay-loops-count');
      await expect(loopsCount).toContainText('2 loops', { timeout: 5000 });
      await expect(loopsCount).toHaveClass(/health-green/);
    });
  });

  // ── Queue Rendering ─────────────────────────────────────────────────────

  test.describe('Queue Rendering', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('queue entries show title', async ({ page }) => {
      await loadPipelinePage(page);

      const entries = page.locator('.queue-entry');
      const count = await entries.count();
      expect(count).toBeGreaterThan(0);

      // Queue contains unstarted/backlog issues; verify entries render with title
      const firstTitle = entries.first().locator('.queue-title');
      await expect(firstTitle).toBeVisible();
      const text = await firstTitle.textContent();
      expect(text.trim().length).toBeGreaterThan(0);
    });

    test('first queue entry has next-up emphasis', async ({ page }) => {
      await loadPipelinePage(page);

      const firstEntry = page.locator('.queue-entry').first();
      await expect(firstEntry).toHaveClass(/queue-next/);
    });

    test('queue entries have priority data attribute', async ({ page }) => {
      await loadPipelinePage(page);

      // At least one entry should have a data-priority attribute
      const entriesWithPriority = page.locator('.queue-entry[data-priority]');
      const count = await entriesWithPriority.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  // ── Column Counts and Status Summary ────────────────────────────────────

  test.describe('Column Counts and Status Summary', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('queue header shows item count', async ({ page }) => {
      await loadPipelinePage(page);

      const queueCount = page.locator('#pipeline-queue-count');
      await expect(queueCount).toBeVisible();
      // Should show a number matching the actual queue entries
      const countText = await queueCount.textContent();
      expect(countText.trim()).toMatch(/\d+/);
    });

    test('active header shows item count', async ({ page }) => {
      await loadPipelinePage(page);

      const activeCount = page.locator('#pipeline-active-count');
      await expect(activeCount).toBeVisible();
      // Active count reflects all started leaf issues from mock data
      const countText = await activeCount.textContent();
      expect(countText).toMatch(/\d+/);
    });

    test('header shows running summary', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const status = page.locator('#pipeline-status');
      await expect(status).toBeVisible();
      await expect(status).toContainText('1 running');
    });
  });

  // ── Progress Bar ────────────────────────────────────────────────────────

  test.describe('Progress Bar', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('cell has progress bar with segments', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 2 completed + 1 running = 3 segments
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'review'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const progressBar = cell.locator('.cell-progress');
      await expect(progressBar).toBeVisible();

      const segments = progressBar.locator('.progress-seg');
      await expect(segments).toHaveCount(3);
    });

    test('segments reflect loop status', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      // 1 completed + 1 running
      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const segments = cell.locator('.cell-progress .progress-seg');
      await expect(segments).toHaveCount(2);

      // Segments are rendered newest-first: running, then complete
      await expect(segments.nth(0)).toHaveClass(/seg-running/);
      await expect(segments.nth(1)).toHaveClass(/seg-complete/);
    });
  });

  // ── Health Dot and ×N Loop Count ────────────────────────────────────────

  test.describe('Health Dot and Loop Count Format', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('cell shows health dot with color', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const healthDot = cell.locator('.cell-health');
      await expect(healthDot).toBeVisible();
      await expect(healthDot).toHaveClass(/health-green/);
    });

    test('loop count uses ×N format', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);
      const proxyToken = await createProxyToken(page);

      await createCompletedLoop(page, consumerToken, proxyToken, {
        issueIdentifier: 'TEST-14', promptName: 'plan'
      });

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const loops = cell.locator('.cell-loops');
      await expect(loops).toContainText('×2');
    });
  });

  // ── Stage Badge ─────────────────────────────────────────────────────────

  test.describe('Stage Badge', () => {
    test.beforeEach(async ({ page }) => {
      await setupCleanSession(page);
    });

    test('stage is rendered as a badge', async ({ page }) => {
      const consumerToken = await createConsumerToken(page);

      const item = await dispatchForIssue(page, {
        issueIdentifier: 'TEST-14', promptName: 'implementation'
      });
      await takeItem(page, item.id, consumerToken);

      await loadPipelinePage(page);

      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const stage = cell.locator('.cell-stage');
      await expect(stage).toBeVisible();
      await expect(stage).toHaveClass(/cell-stage-badge/);
      await expect(stage).toContainText('impl');
    });
  });
});
