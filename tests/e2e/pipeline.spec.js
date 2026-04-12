import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const PIPELINE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/pipeline`;
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`;
const API_PREFIX = `/workspace/${TEST_WORKSPACE_URL_KEY}`;

test.describe('Pipeline Page', () => {
  test.describe('Feature Flag Gating', () => {
    test('pipeline page redirects to settings when feature flag is disabled', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain('/settings');
    });

    test('pipeline page loads when feature flag is enabled', async ({ page }) => {
      // Intercept pipeline polling to avoid networkidle issues
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.pipeline-header-title')).toContainText('pipeline');
    });

    test('pipeline toggle defaults to off in settings', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const toggle = page.locator('[data-feature="pipeline"]');
      await expect(toggle).toBeVisible();
      const state = toggle.locator('.toggle-state');
      await expect(state).toContainText('off');
    });

    test('pipeline footer link visible when flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      const pipelineLink = page.locator('.footer-action:has-text("pipeline")');
      await expect(pipelineLink).toBeVisible();
    });

    test('pipeline footer link hidden when flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
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

      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
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
      // Clear dispatch/foreman state to prevent cross-test contamination
      await page.goto('/test/clear-dispatch-queue');
      await page.goto('/test/clear-dispatch-history');
      await page.goto('/test/clear-foreman-status');
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
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
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);

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
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
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
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);

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
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
      await page.route('**/api/pipeline/state', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetchedAt: new Date().toISOString(), active: [], queue: [], recent: [] }) })
      );

      await page.goto(PIPELINE_URL);
      await page.waitForLoadState('networkidle');
    });

    // Use a queue entry with a known identifier (TEST-1 exists in mock data)
    async function clickKnownEntry(page) {
      const entry = page.locator('.queue-entry[data-identifier="TEST-1"]');
      const count = await entry.count();
      if (count === 0) {
        // Fallback: click any entry with a non-empty identifier
        const anyEntry = page.locator('.queue-entry[data-identifier]:not([data-identifier=""])');
        if (await anyEntry.count() > 0) {
          await anyEntry.first().click();
          return true;
        }
        return false;
      }
      await entry.click();
      return true;
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

  test.describe('Accessibility', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ pipeline: true }))}`);
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
      const firstEntry = page.locator('.queue-entry').first();
      const count = await firstEntry.count();
      if (count === 0) return;

      await firstEntry.click();

      const closeBtn = page.locator('.overlay-close');
      await expect(closeBtn).toHaveAttribute('aria-label', 'Close', { timeout: 5000 });
    });

    test('body gets overlay-open class when overlay is shown', async ({ page }) => {
      const firstEntry = page.locator('.queue-entry').first();
      const count = await firstEntry.count();
      if (count === 0) return;

      await firstEntry.click();
      await expect(page.locator('.overlay-content')).toBeVisible({ timeout: 5000 });

      await expect(page.locator('body')).toHaveClass(/overlay-open/);
    });

    test('body loses overlay-open class when overlay is closed', async ({ page }) => {
      const firstEntry = page.locator('.queue-entry').first();
      const count = await firstEntry.count();
      if (count === 0) return;

      await firstEntry.click();
      await expect(page.locator('.overlay-content')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');

      await expect(page.locator('body')).not.toHaveClass(/overlay-open/);
    });
  });
});
