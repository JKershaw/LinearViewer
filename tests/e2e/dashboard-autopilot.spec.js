import { test, expect } from '../fixtures/test-base.js';

// LIN-509: the experimental combined, realtime AUTOPILOT dashboard
// (/workspace/:urlKey/dashboard). Distinct from dashboard.spec.js, which covers
// the unprefixed tree-view "dashboard". Like the Collective page it seeds via
// /test/set-session — the page only needs a session with workspaces + the
// per-user `dashboard` flag; the live feed reads dispatch/foreman stores
// (Mongo-only), so we seed runs through the user dispatch API.

const URL_KEY = 'test-workspace';
const DASHBOARD_URL = `/workspace/${URL_KEY}/dashboard`;
const SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
const LOOPS_URL = `/workspace/${URL_KEY}/api/dashboard/loops`;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;
const ENABLED = featuresParam({ dashboard: true });

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-foreman-status?urlKey=${URL_KEY}`);
}

async function seedQueuedRun(page, { issueIdentifier, issueTitle, kind = 'plan' }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'do the thing', promptName: 'plan', kind, issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  return (await res.json()).item;
}

test.describe('Autopilot Dashboard (experimental)', () => {
  test.describe('Feature flag gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.dashboard-header h1')).toHaveText('Dashboard');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="dashboard"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the autopilot dashboard")')).toHaveCount(0);

      await page.goto(`/test/set-session?${ENABLED}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the autopilot dashboard")')).toBeVisible();
    });
  });

  test.describe('Page structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&${ENABLED}`);
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders the banner, controls, active and recent sections', async ({ page }) => {
      await expect(page.locator('#dashboard-banner')).toBeVisible();
      await expect(page.locator('.dashboard-controls-section')).toBeVisible();
      await expect(page.locator('.dashboard-active-section')).toBeVisible();
      await expect(page.locator('.dashboard-recent-section')).toBeVisible();
    });

    test('shows a filter chip per connected workspace, all on by default', async ({ page }) => {
      const chips = page.locator('.dashboard-chip');
      await expect(chips).toHaveCount(2);
      await expect(page.locator('.dashboard-chip.is-on')).toHaveCount(2);
    });

    test('defaults the scope toggle to autopilot', async ({ page }) => {
      await expect(page.locator('.dashboard-scope-btn[data-scope="autopilot"]')).toHaveClass(/is-on/);
      await expect(page.locator('.dashboard-scope-btn[data-scope="all"]')).not.toHaveClass(/is-on/);
    });
  });

  test.describe('Merged loops feed', () => {
    test('returns 403 when the flag is off', async ({ page }) => {
      await page.goto('/test/set-session');
      const res = await page.request.get(LOOPS_URL);
      expect(res.status()).toBe(403);
    });

    test('returns the active/recent contract when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      const res = await page.request.get(LOOPS_URL);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.active)).toBe(true);
      expect(Array.isArray(body.recent)).toBe(true);
      expect(body.workspaces.some(w => w.urlKey === URL_KEY)).toBe(true);
    });

    test('a queued run appears in the active feed, workspace-tagged', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-901', issueTitle: 'Seeded run' });

      const res = await page.request.get(LOOPS_URL);
      const body = await res.json();
      const run = body.active.find(r => r.issueIdentifier === 'LIN-901');
      expect(run, 'seeded queued run is active').toBeTruthy();
      expect(run.agentState).toBe('queued');
      expect(run.workspaceUrlKey).toBe(URL_KEY);
      expect(run.workspaceName).toBeTruthy();
    });

    test('the dashboard page renders a seeded autopilot run in the active feed', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      // Autopilot kind so it survives the default autopilot-only scope.
      await seedQueuedRun(page, { issueIdentifier: 'LIN-902', issueTitle: 'Visible run', kind: 'autopilot' });

      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#dashboard-active .dashboard-session').filter({ hasText: 'Visible run' })).toBeVisible();
    });

    test('a non-autopilot run is hidden by default but shown under "All runs"', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-904', issueTitle: 'Manual run', kind: 'plan' });

      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      // Default scope = autopilot-only → the plain run is filtered out.
      await expect(page.locator('.dashboard-session').filter({ hasText: 'Manual run' })).toHaveCount(0);
      // Flip to "All runs" → it appears.
      await page.locator('.dashboard-scope-btn[data-scope="all"]').click();
      await expect(page.locator('.dashboard-session').filter({ hasText: 'Manual run' })).toBeVisible();
    });

    test('expanding a session reveals its nested run events', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-905', issueTitle: 'Expandable run', kind: 'autopilot' });

      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.dashboard-session').filter({ hasText: 'Expandable run' });
      await expect(card).toBeVisible();
      await card.locator('.dashboard-session-head').click();
      await expect(card.locator('.dashboard-runs .dashboard-event')).toHaveCount(1);
    });
  });

  test.describe('Run summary', () => {
    test('refuses a summary for a still-active run (terminal-only gate)', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      await clearRuns(page);
      const item = await seedQueuedRun(page, { issueIdentifier: 'LIN-903', issueTitle: 'Active run' });

      const res = await page.request.post(`/workspace/${URL_KEY}/api/dashboard/run-summary/${item.id}`);
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.agentState).toBe('queued');
    });

    test('404 for an unknown loop id', async ({ page }) => {
      await page.goto(`/test/set-session?${ENABLED}`);
      const res = await page.request.post(`/workspace/${URL_KEY}/api/dashboard/run-summary/does-not-exist`);
      expect(res.status()).toBe(404);
    });
  });
});
