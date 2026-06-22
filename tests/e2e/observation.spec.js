import { test, expect } from '../fixtures/test-base.js';

// LIN-595: the first-class autopilot Observation page
// (/workspace/:urlKey/observation), which superseded the experimental autopilot
// dashboard (LIN-509). Distinct from dashboard.spec.js, which covers the
// unprefixed tree-view "dashboard". Like the Collective page it seeds via
// /test/set-session — the page needs only a session with workspaces (no flag);
// the live feed reads dispatch/agent-status stores (Mongo-only), so we seed runs
// through the user dispatch API.

const URL_KEY = 'test-workspace';
const OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
const DASHBOARD_URL = `/workspace/${URL_KEY}/dashboard`;
const SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
const SESSIONS_URL = `/workspace/${URL_KEY}/api/dashboard/sessions`;

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
}

async function seedQueuedRun(page, { issueIdentifier, issueTitle, kind = 'autopilot' }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'do the thing', promptName: 'autopilot', kind, issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  return (await res.json()).item;
}

test.describe('Autopilot Observation page (first-class)', () => {
  test.describe('Tier: first-class, no flag', () => {
    test('loads without any feature flag', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.obs-header h1')).toHaveText('Observation');
    });

    test('/dashboard 302-redirects to /observation', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/observation');
    });

    test('the footer carries a first-class observation link', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`.footer-action[href="${OBSERVATION_URL}"]`)).toBeVisible();
    });

    test('the experimental dashboard toggle is gone from Settings', async ({ page }) => {
      await page.goto('/test/set-session');
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-feature="dashboard"]')).toHaveCount(0);
      await expect(page.locator('.settings-action:has-text("open the autopilot dashboard")')).toHaveCount(0);
    });
  });

  test.describe('Page structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/test/set-session?multiWorkspace=true');
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders the banner, controls, active and archive sections', async ({ page }) => {
      await expect(page.locator('#obs-banner')).toBeVisible();
      await expect(page.locator('.obs-controls-section')).toBeVisible();
      await expect(page.locator('.obs-active-section')).toBeVisible();
      await expect(page.locator('.obs-archive-section')).toBeVisible();
    });

    test('shows a filter chip per connected workspace, all on by default', async ({ page }) => {
      const chips = page.locator('.obs-chip');
      await expect(chips).toHaveCount(2);
      await expect(page.locator('.obs-chip.is-on')).toHaveCount(2);
    });

    test('the completed archive is collapsed by default and toggles open', async ({ page }) => {
      const toggle = page.locator('#obs-archive-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#obs-archive-body')).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#obs-archive-body')).toBeVisible();
    });
  });

  test.describe('Sessions feed', () => {
    test('returns the active/recent contract (no flag gate)', async ({ page }) => {
      await page.goto('/test/set-session');
      await clearRuns(page);
      const res = await page.request.get(SESSIONS_URL);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.active)).toBe(true);
      expect(Array.isArray(body.recent)).toBe(true);
      expect(body.workspaces.some(w => w.urlKey === URL_KEY)).toBe(true);
    });

    test('a queued autopilot run appears as an active session, workspace-tagged', async ({ page }) => {
      await page.goto('/test/set-session');
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-901', issueTitle: 'Seeded session' });

      const res = await page.request.get(SESSIONS_URL);
      const body = await res.json();
      const sess = body.active.find(s => s.seedIssue === 'LIN-901');
      expect(sess, 'seeded session is active').toBeTruthy();
      expect(sess.status).toBe('in-progress');
      expect(sess.terminal).toBe(false);
      expect(sess.workspaceUrlKey).toBe(URL_KEY);
      expect(sess.workspaceName).toBeTruthy();
    });

    test('the page renders a seeded autopilot session in the active feed', async ({ page }) => {
      await page.goto('/test/set-session');
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-902', issueTitle: 'Visible session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#obs-active .obs-session').filter({ hasText: 'Visible session' })).toBeVisible();
    });

    test('expanding a session reveals its body', async ({ page }) => {
      await page.goto('/test/set-session');
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-905', issueTitle: 'Expandable session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Expandable session' });
      await expect(card).toBeVisible();
      await card.locator('.obs-session-head').click();
      await expect(card.locator('.obs-session-body')).toBeVisible();
    });
  });
});
