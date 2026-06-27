import { test, expect } from '../fixtures/test-base.js';

// LIN-595: the first-class autopilot Observation page
// (/workspace/:urlKey/observation), which superseded the experimental autopilot
// dashboard (LIN-509). Distinct from dashboard.spec.js, which covers the
// unprefixed tree-view "dashboard". Like the Collective page it seeds via
// /test/set-session — the page needs only a session with workspaces (no flag);
// the live feed reads dispatch/agent-status stores (Mongo-only), so we seed runs
// through the user dispatch API.

// Bound per-test from the per-worker key (LIN-628) so session, nav, the seed/
// teardown query params, and the workspace-tag assertions all address this
// worker's partition. Playwright workers are separate processes, so these
// module-scoped lets are per-worker state.
let URL_KEY;
let OBSERVATION_URL;
let DASHBOARD_URL;
let SETTINGS_URL;
let SESSIONS_URL;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  DASHBOARD_URL = `/workspace/${URL_KEY}/dashboard`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  SESSIONS_URL = `/workspace/${URL_KEY}/api/dashboard/sessions`;
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  // The materialized Observation read-model (LIN-623) is a projection of the logs
  // above — clear it too, or a stale derived doc + backfill marker would mask the
  // freshly-seeded run and the live fallback would never engage.
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
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
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.obs-header h1')).toHaveText('Observation');
    });

    test('/dashboard 302-redirects to /observation', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/observation');
    });

    test('the footer carries a first-class observation link', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`.footer-action[href="${OBSERVATION_URL}"]`)).toBeVisible();
    });

    test('the experimental dashboard toggle is gone from Settings', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-feature="dashboard"]')).toHaveCount(0);
      await expect(page.locator('.settings-action:has-text("open the autopilot dashboard")')).toHaveCount(0);
    });
  });

  test.describe('Page structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?multiWorkspace=true&urlKey=${URL_KEY}`);
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
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      const res = await page.request.get(SESSIONS_URL);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.active)).toBe(true);
      expect(Array.isArray(body.recent)).toBe(true);
      expect(body.workspaces.some(w => w.urlKey === URL_KEY)).toBe(true);
    });

    test('a queued autopilot run appears as an active session, workspace-tagged', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
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
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-902', issueTitle: 'Visible session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#obs-active .obs-session').filter({ hasText: 'Visible session' })).toBeVisible();
    });

    test('expanding a session reveals its body', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-905', issueTitle: 'Expandable session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Expandable session' });
      await expect(card).toBeVisible();
      await card.locator('.obs-session-head').click();
      await expect(card.locator('.obs-session-body')).toBeVisible();
    });

    test('the expanded body drills into the tasks the session touched (Level 3)', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-906', issueTitle: 'Drill-down session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Drill-down session' });
      await expect(card).toBeVisible();
      await card.locator('.obs-session-head').click();
      // The Level-3 body renders a per-task block for the seed task, even with no
      // worker runs under it yet.
      const body = card.locator('.obs-session-body');
      await expect(body.locator('.obs-tasks')).toBeVisible();
      await expect(body.locator('.obs-task-ident').filter({ hasText: 'LIN-906' })).toBeVisible();
    });
  });

  test.describe('Level 3 drill-down (worker tree)', () => {
    // Seed an autopilot session (orchestrator anchor + one worker stamped with the
    // anchor's id as sessionId — the LIN-591 spine) so the body renders a per-task
    // worker-session node that expands to its detail.
    async function seedSessionWithWorker(page) {
      const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-910', issueTitle: 'Worker-tree seed', target: 'cli' }
      });
      expect(anchor.status()).toBe(201);
      const anchorId = (await anchor.json()).item.id;
      const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-911', issueTitle: 'Worker child', target: 'cli', sessionId: anchorId }
      });
      expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
    }

    test('a worker node renders under its task and expands to a detail block', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedSessionWithWorker(page);

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Worker-tree seed' }).first();
      await expect(card).toBeVisible();
      await card.locator('.obs-session-head').first().click();

      // The worker tree carries the implementation worker as its own node.
      const worker = card.locator('.obs-worker').filter({ hasText: 'implementation' }).first();
      await expect(worker).toBeVisible();
      await worker.locator('.obs-worker-head').click();
      await expect(worker.locator('.obs-worker-body')).toBeVisible();
    });
  });

  // LIN-749: a terminal session that errored but whose touched task is now Done
  // renders done-with-warning. The "task is Done" signal comes ONLY from the
  // drill-down hydration seam (never the per-poll feed, which has a no-Linear
  // cost contract), so the card stays 'error' until expanded, then upgrades.
  test.describe('done-with-warning upgrade (LIN-749)', () => {
    // Drive one dispatch run to a terminal [failed] outcome through the real
    // consumer take+feedback flow, so the session reconstructs as terminal+error.
    async function seedFailedRun(page, { issueIdentifier, issueTitle }) {
      const item = await seedQueuedRun(page, { issueIdentifier, issueTitle });
      const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
      const { token } = await tokenResp.json();
      const take = await page.request.post(`/api/dispatch/take/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
      const fb = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: '[failed] iterm window never launched' }
      });
      expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
    }

    test('an errored terminal session whose task hydrates to Done upgrades to done-with-warning', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedFailedRun(page, { issueIdentifier: 'LIN-744', issueTitle: 'iTerm-struggling session' });

      // The touched task reports Done from the hydration seam (mocked so the test
      // does not depend on a live Linear backend).
      await page.route('**/api/dashboard/hydrate/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ hydrated: true, identifier: 'LIN-744', state: { name: 'Done', type: 'completed' }, labels: [], url: null })
        })
      );

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');

      // A terminal session that finished <24h ago is Active, not Archive (LIN-631).
      const card = page.locator('#obs-active .obs-session').filter({ hasText: 'iTerm-struggling session' }).first();
      await expect(card).toBeVisible();

      // Pre-drill-down: the feed-derived status is plain 'error' (no task lookup).
      await expect(card).toHaveAttribute('data-status', 'error');

      // Drilling in fires the hydration; the Done state upgrades the card.
      await card.locator('.obs-session-head').first().click();
      await expect(card).toHaveAttribute('data-status', 'done-with-warning');
      await expect(card.locator('.obs-pill')).toHaveAttribute('data-status', 'done-with-warning');
      await expect(card.locator('.obs-pill')).toContainText('done ⚠');
    });
  });
});
