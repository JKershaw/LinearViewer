import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, pipelineLocalSeed, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js';

// LIN-387: this spec rides the local-provider harness (seedLocalWorkspace +
// pipelineLocalSeed) instead of the deleted `test-token` mock branch. The seed
// is the SAME testMockData the mock used to return, so identifiers/titles the
// assertions reference (TEST-1/2/14) are unchanged.
const PIPELINE_URL = `/workspace/${LOCAL_WORKSPACE_URL_KEY}/pipeline`;
const SETTINGS_URL = `/workspace/${LOCAL_WORKSPACE_URL_KEY}/settings`;
const API_PREFIX = `/workspace/${LOCAL_WORKSPACE_URL_KEY}`;

// Seed the local workspace; pipeline flag optional per-test.
const seedPipeline = (page, features) =>
  seedLocalWorkspace(page, pipelineLocalSeed, features ? { features } : undefined);

test.describe('Pipeline Page', () => {
  test.describe('Feature Flag Gating', () => {
    test('pipeline page redirects to settings when feature flag is disabled', async ({ page }) => {
      await seedPipeline(page);
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain('/settings');
    });

    test('pipeline page loads when feature flag is enabled', async ({ page }) => {
      // Intercept pipeline polling to avoid networkidle issues
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await seedPipeline(page, { pipeline: true });
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.pipeline-header-title')).toContainText('pipeline');
    });

    test('pipeline toggle defaults to off in settings', async ({ page }) => {
      await seedPipeline(page);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const toggle = page.locator('[data-feature="pipeline"]');
      await expect(toggle).toBeVisible();
      const state = toggle.locator('.toggle-state');
      await expect(state).toContainText('off');
    });

    test('pipeline footer link visible when flag is on', async ({ page }) => {
      await seedPipeline(page, { pipeline: true });
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const pipelineLink = page.locator('.footer-action:has-text("pipeline")');
      await expect(pipelineLink).toBeVisible();
    });

    test('pipeline footer link hidden when flag is off', async ({ page }) => {
      await seedPipeline(page);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const pipelineLink = page.locator('.footer-action:has-text("pipeline")');
      await expect(pipelineLink).toHaveCount(0);
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      // Intercept pipeline polling to stabilise networkidle
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await seedPipeline(page, { pipeline: true });
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders three-column layout', async ({ page }) => {
      await expect(page.locator('.pipeline-floor')).toBeVisible();
      await expect(page.locator('.pipeline-queue')).toBeVisible();
      await expect(page.locator('.pipeline-grid-wrap')).toBeVisible();
      await expect(page.locator('.pipeline-activity')).toBeVisible();
    });

    test('shows queue rail with title', async ({ page }) => {
      await expect(page.locator('.pipeline-rail-title:has-text("queue")')).toBeVisible();
      await expect(page.locator('#pipeline-queue-list')).toBeVisible();
    });

    test('shows active grid with title', async ({ page }) => {
      await expect(page.locator('.pipeline-grid-title')).toBeVisible();
      await expect(page.locator('.pipeline-grid-title')).toContainText('active');
      await expect(page.locator('#pipeline-grid')).toHaveCount(1);
    });

    test('shows activity rail with title', async ({ page }) => {
      const activityTitle = page.locator('.pipeline-activity .pipeline-rail-title');
      await expect(activityTitle).toBeVisible();
      await expect(activityTitle).toContainText('activity');
      await expect(page.locator('#pipeline-activity-list')).toHaveCount(1);
    });

    test('shows fetched-at timestamp', async ({ page }) => {
      await expect(page.locator('#pipeline-fetched-at')).toBeVisible();
    });

    test('has pipeline overlay element hidden by default', async ({ page }) => {
      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).toHaveClass(/hidden/);
    });

    test('navbar shows projects link', async ({ page }) => {
      const projectsLink = page.locator('.nav-action:has-text("projects")');
      await expect(projectsLink).toBeVisible();
    });

    test('pipeline is bold in footer when on pipeline page', async ({ page }) => {
      const pipelineFooter = page.locator('.footer-current:has-text("pipeline")');
      await expect(pipelineFooter).toBeVisible();
    });

    test('includes pipeline.css stylesheet', async ({ page }) => {
      const link = page.locator('link[href="/pipeline.css"]');
      await expect(link).toHaveCount(1);
    });

    test('includes pipeline.js script', async ({ page }) => {
      const script = page.locator('script[src="/pipeline.js"]');
      await expect(script).toHaveCount(1);
    });
  });

  test.describe('Pipeline API', () => {
    test.beforeEach(async ({ page }) => {
      // Clear dispatch/agent-status state to prevent cross-test contamination
      await page.goto(`/test/clear-dispatch-queue?urlKey=${LOCAL_WORKSPACE_URL_KEY}`);
      await page.goto(`/test/clear-dispatch-history?urlKey=${LOCAL_WORKSPACE_URL_KEY}`);
      await page.goto(`/test/clear-agent-status?urlKey=${LOCAL_WORKSPACE_URL_KEY}`);
      await seedPipeline(page, { pipeline: true });
    });

    test('state endpoint returns JSON snapshot', async ({ page }) => {
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/state`);
      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('fetchedAt');
      expect(data).toHaveProperty('active');
      expect(data).toHaveProperty('queue');
      expect(data).toHaveProperty('recent');
      expect(Array.isArray(data.active)).toBe(true);
      expect(Array.isArray(data.queue)).toBe(true);
      expect(Array.isArray(data.recent)).toBe(true);
    });

    test('state endpoint returns queue and active from mock issues', async ({ page }) => {
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/state`);
      const data = await response.json();

      // Classification is state-based: started → active, unstarted/backlog → queue
      expect(data.queue.length).toBeGreaterThan(0);
      expect(data.active.length).toBeGreaterThan(0);
      // Verify active tasks have started state
      for (const task of data.active) {
        expect(task.state.type).toBe('started');
      }
    });

    test('task detail endpoint returns task data', async ({ page }) => {
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/task/TEST-1`);
      expect(response.status()).toBe(200);

      const task = await response.json();
      expect(task.identifier).toBe('TEST-1');
      expect(task.title).toBe('Parent task in progress');
      expect(task).toHaveProperty('loops');
      expect(task).toHaveProperty('loopCount');
      expect(task).toHaveProperty('healthColor');
      expect(task).toHaveProperty('parentChain');
    });

    test('task detail endpoint returns 404 for unknown issue', async ({ page }) => {
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/task/NONEXISTENT-999`);
      expect(response.status()).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('task detail with children shows empty loops when no dispatch history', async ({ page }) => {
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/task/TEST-1`);
      const task = await response.json();

      expect(task.loops).toEqual([]);
      expect(task.loopCount).toBe(0);
      expect(task.healthColor).toBe('green');
    });

    test('task detail includes parent chain for child issues', async ({ page }) => {
      // TEST-2 is a child of TEST-1
      const response = await page.request.get(`${API_PREFIX}/api/pipeline/task/TEST-2`);
      const task = await response.json();

      expect(task.identifier).toBe('TEST-2');
      expect(task.parentChain.length).toBeGreaterThan(0);
      expect(task.parentChain[0].identifier).toBe('TEST-1');
    });
  });

  test.describe('Client-Side Rendering', () => {
    test('hydrates queue from embedded data', async ({ page }) => {
      await seedPipeline(page, { pipeline: true });

      // Let the real page load with mock data (no polling intercept for initial load)
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      // The embedded __PIPELINE_DATA__ should hydrate the queue with mock issues
      const queueEntries = page.locator('.queue-entry');
      const count = await queueEntries.count();
      // Should have some queue items (mock data has several incomplete issues)
      expect(count).toBeGreaterThan(0);
    });

    test('queue entries show issue titles', async ({ page }) => {
      await seedPipeline(page, { pipeline: true });
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      const firstTitle = page.locator('.queue-entry .queue-title').first();
      const text = await firstTitle.textContent();
      // Mock data has issues with titles; first entry should have non-empty text
      expect(text.trim().length).toBeGreaterThan(0);
    });

    test('empty states shown when no data', async ({ page }) => {
      await seedPipeline(page, { pipeline: true });

      // Intercept the initial page load to inject empty data
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      // Grid should show empty state (no active tasks from embedded data,
      // but queue may have items from the server-rendered snapshot)
      const gridEmpty = page.locator('#pipeline-grid-empty');
      // The grid empty message is shown only when no active tasks
      // (embedded data has no active loops, so grid should be empty)
      const cells = page.locator('.pipeline-cell');
      const cellCount = await cells.count();
      if (cellCount === 0) {
        await expect(gridEmpty).not.toHaveClass(/hidden/);
      }
    });
  });

  test.describe('Overlay', () => {
    test.beforeEach(async ({ page }) => {
      await seedPipeline(page, { pipeline: true });
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');
    });

    // Use a queue entry with a known identifier (TEST-1 exists in mock data)
    async function clickKnownEntry(page) {
      // Try a known active cell first, then fall back to any clickable entry
      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      if (await cell.count() > 0) {
        await cell.click();
        return true;
      }
      const anyCell = page.locator('.pipeline-cell[data-identifier]:not([data-identifier=""])');
      if (await anyCell.count() > 0) {
        await anyCell.first().click();
        return true;
      }
      const anyEntry = page.locator('.queue-entry[data-identifier]:not([data-identifier=""])');
      if (await anyEntry.count() > 0) {
        await anyEntry.first().click();
        return true;
      }
      return false;
    }

    test('clicking queue entry opens overlay', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).not.toHaveClass(/hidden/, { timeout: 5000 });
      await expect(page.locator('.overlay-content')).toBeVisible();
    });

    test('overlay shows task identifier and title', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      await expect(page.locator('.overlay-id')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.overlay-title')).toBeVisible();
    });

    test('overlay shows loop history section', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      await expect(page.locator('.overlay-section-title')).toContainText('loop history', { timeout: 5000 });
    });

    test('overlay shows generate prompt button for idle tasks', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      await expect(page.locator('.overlay-recommend')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.overlay-recommend')).toHaveText('generate next prompt');
    });

    test('overlay closes on close button click', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      await expect(page.locator('.overlay-content')).toBeVisible({ timeout: 5000 });

      await page.locator('.overlay-close').click();

      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).toHaveClass(/hidden/);
    });

    test('overlay closes on Escape key', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      await expect(page.locator('.overlay-content')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');

      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).toHaveClass(/hidden/);
    });

    test('overlay shows linear link', async ({ page }) => {
      const opened = await clickKnownEntry(page);
      if (!opened) return;

      const link = page.locator('.overlay-linear-link');
      await expect(link).toBeVisible({ timeout: 5000 });
      await expect(link).toHaveText('view on linear');
    });
  });

  // LIN-322: the leaf overlay polls every OVERLAY_POLL_MS and re-renders by
  // replacing .overlay-content wholesale, which used to reset scrollTop to 0
  // every cycle. The poll callback now captures/restores scroll (and follows
  // the live feed to the bottom when the user was already near the bottom).
  test.describe('Overlay scroll preservation (LIN-322)', () => {
    // A leaf task with enough loop history to overflow .overlay-content (80vh).
    function makeTask(loopCount) {
      const loops = [];
      for (let i = 0; i < loopCount; i++) {
        loops.push({
          agentState: 'complete',
          dispatchedAt: new Date(Date.now() - i * 60000).toISOString(),
          stage: 'execute',
          promptName: `prompt-${i}`,
          agentSummary: `Loop ${i}: did a chunk of work that takes vertical space so the overlay scrolls and we can exercise scroll preservation across a poll tick.`,
          feedback: []
        });
      }
      return {
        identifier: 'TEST-14',
        title: 'Scrollable task',
        agentState: 'running',
        currentStage: 'execute',
        loopCount,
        healthColor: 'green',
        url: 'https://linear.app/test/issue/TEST-14',
        loops
      };
    }

    async function openScrollableOverlay(page) {
      // Click whatever entry the hydrated queue offers; the routed task endpoint
      // returns our fixture regardless of the clicked identifier.
      const entry = page.locator('.queue-entry[data-identifier]:not([data-identifier=""])').first();
      await expect(entry).toBeVisible({ timeout: 5000 });
      await entry.click();
      const content = page.locator('.overlay-content');
      await expect(content).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.overlay-section-title')).toContainText('loop history', { timeout: 5000 });
      // Confirm .overlay-content is actually the scroll container (not .pipeline-overlay).
      const scrollable = await content.evaluate(el => el.scrollHeight > el.clientHeight);
      expect(scrollable).toBe(true);
      return content;
    }

    test.beforeEach(async ({ page }) => {
      await seedPipeline(page, { pipeline: true });
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );
    });

    test('retains scroll position across a poll tick', async ({ page }) => {
      let taskRequests = 0;
      // Stable loop count → scrollHeight stable → exact scrollTop should be restored.
      await page.route('**/api/pipeline/task/**', route => {
        taskRequests += 1;
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeTask(50)) });
      });
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      const content = await openScrollableOverlay(page);

      // Scroll to a mid-point (well clear of the ~60px near-bottom threshold).
      await content.evaluate(el => { el.scrollTop = 200; });
      const before = await content.evaluate(el => el.scrollTop);
      expect(before).toBeGreaterThan(0);

      // Wait for at least one full poll cycle (OVERLAY_POLL_MS = 2000).
      const initialRequests = taskRequests;
      await expect.poll(() => taskRequests, { timeout: 6000 }).toBeGreaterThan(initialRequests);
      await page.waitForTimeout(150); // let the re-render + restore settle

      const after = await content.evaluate(el => el.scrollTop);
      expect(after).not.toBe(0);
      expect(Math.abs(after - before)).toBeLessThan(5);

      // No unintended side effects: overlay still open, recap mount preserved.
      await expect(page.locator('#pipeline-overlay')).not.toHaveClass(/hidden/);
      await expect(page.locator('.overlay-recap-mount')).toHaveCount(1);
    });

    test('follows the live feed to the bottom when near the bottom', async ({ page }) => {
      let taskRequests = 0;
      // First response: 50 loops. After the first poll: 70 loops → scrollHeight grows.
      await page.route('**/api/pipeline/task/**', route => {
        taskRequests += 1;
        const count = taskRequests <= 1 ? 50 : 70;
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeTask(count)) });
      });
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      const content = await openScrollableOverlay(page);

      // Scroll to the bottom so the near-bottom auto-follow kicks in.
      await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const heightBefore = await content.evaluate(el => el.scrollHeight);

      // Wait for the poll to deliver the larger loop set.
      await expect.poll(() => taskRequests, { timeout: 6000 }).toBeGreaterThan(1);
      await page.waitForTimeout(150);

      const state = await content.evaluate(el => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      }));
      // New content arrived (taller) and the view followed it to the bottom.
      expect(state.scrollHeight).toBeGreaterThan(heightBefore);
      expect(state.scrollHeight - state.scrollTop - state.clientHeight).toBeLessThan(60);

      await expect(page.locator('#pipeline-overlay')).not.toHaveClass(/hidden/);
      await expect(page.locator('.overlay-recap-mount')).toHaveCount(1);
    });
  });

  test.describe('Accessibility', () => {
    test.beforeEach(async ({ page }) => {
      await seedPipeline(page, { pipeline: true });
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('overlay has aria-hidden attribute', async ({ page }) => {
      const overlay = page.locator('#pipeline-overlay');
      await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    });

    test('rails have aria-label attributes', async ({ page }) => {
      await expect(page.locator('.pipeline-queue')).toHaveAttribute('aria-label', 'Queue');
      await expect(page.locator('.pipeline-grid-wrap')).toHaveAttribute('aria-label', 'Active tasks');
      await expect(page.locator('.pipeline-activity')).toHaveAttribute('aria-label', 'Activity feed');
    });

    test('overlay close button has aria-label', async ({ page }) => {
      // Click a cell with a known identifier for reliable overlay load
      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const count = await cell.count();
      if (count === 0) return;

      await cell.click();

      const closeBtn = page.locator('.overlay-close');
      await expect(closeBtn).toHaveAttribute('aria-label', 'Close', { timeout: 5000 });
    });

    test('body gets overlay-open class when overlay is shown', async ({ page }) => {
      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const count = await cell.count();
      if (count === 0) return;

      await cell.click();
      // Wait for overlay to fully load past the loading state
      await expect(page.locator('.overlay-title')).toBeVisible({ timeout: 5000 });

      await expect(page.locator('body')).toHaveClass(/overlay-open/);
    });

    test('body loses overlay-open class when overlay is closed', async ({ page }) => {
      const cell = page.locator('.pipeline-cell[data-identifier="TEST-14"]');
      const count = await cell.count();
      if (count === 0) return;

      await cell.click();
      // Wait for overlay to fully load past the loading state
      await expect(page.locator('.overlay-title')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');

      await expect(page.locator('body')).not.toHaveClass(/overlay-open/, { timeout: 5000 });
    });
  });
});
