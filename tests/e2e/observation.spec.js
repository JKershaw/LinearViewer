import { test, expect } from '../fixtures/test-base.js';
import { featuresParam } from '../helpers.js';
import { sweepFixedOverlaps, describeHits } from '../fixed-overlay-sweep.js';

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
  // The LIN-617 sessions-feed cache (in-process, 5s TTL, keyed by workspace set) is
  // a projection too — but of the merged feed OUTPUT, not the stores. Left warm it
  // serves the stale pre-seed feed within its TTL, so the first assertion races a
  // feed that predates this test's seed. Drop it so the reset is fully consistent
  // (LIN-799). Production TTL semantics are unaffected — this is a test-reset seam.
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
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
      // Title routes through the shared renderPageHeader primitive (LIN-975);
      // the h1 also carries the fused "● live" indicator, so match by substring.
      await expect(page.locator('.page-header.obs-header h1')).toContainText('Observation');
    });

    test('/dashboard 302-redirects to /observation', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(DASHBOARD_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/observation');
    });

    test('the header switcher carries a first-class observation link', async ({ page }) => {
      // The cross-view links were hoisted from the footer into the shared header
      // nav switcher (LIN-978); observation is a first-class view, always shown.
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(`.nav-views [data-testid="nav-view-observation"][href="${OBSERVATION_URL}"]`)).toBeVisible();
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

    test('the Active eyebrow reflects the live running count, not a static "Active" (LIN-929)', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);

      // With nothing running, the eyebrow count is 0 (not a static "Active").
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#obs-active-count .obs-active-count-n')).toHaveText('0');

      // Seed one in-progress session → the running count reflects it on load.
      // Drop the 5s sessions-feed cache the first load warmed empty, else it would
      // serve the pre-seed feed and mask the new session (same reason clearRuns does).
      await seedQueuedRun(page, { issueIdentifier: 'LIN-906', issueTitle: 'Counting session' });
      await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#obs-active .obs-session').filter({ hasText: 'Counting session' })).toBeVisible();
      await expect(page.locator('#obs-active-count .obs-active-count-n')).toHaveText('1');
    });

    test('expanding a session reveals its body', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-905', issueTitle: 'Expandable session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Expandable session' });
      await expect(card).toBeVisible();
      // Disclosure is a dedicated control below the meta row now (LIN-928), not
      // the header itself.
      await card.locator('.obs-disc').click();
      await expect(card.locator('.obs-session-body')).toBeVisible();
    });

    test('clicking anywhere on the card head toggles the body (LIN-944)', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-944', issueTitle: 'Whole-box toggle' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Whole-box toggle' });
      await expect(card).toBeVisible();
      const body = card.locator('.obs-session-body');
      await expect(body).toBeHidden();
      // The whole head is the tap target now (LIN-944) — click the topline, not the
      // dedicated `.obs-disc` control, and the card still expands.
      await card.locator('.obs-session-topline').click();
      await expect(body).toBeVisible();
      // Clicking the head again collapses it.
      await card.locator('.obs-session-topline').click();
      await expect(body).toBeHidden();
    });

    test('the expanded body drills into the tasks the session touched (Level 3)', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedQueuedRun(page, { issueIdentifier: 'LIN-906', issueTitle: 'Drill-down session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Drill-down session' });
      await expect(card).toBeVisible();
      await card.locator('.obs-disc').click();
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
      await card.locator('.obs-disc').first().click();

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
      await card.locator('.obs-disc').first().click();
      await expect(card).toHaveAttribute('data-status', 'done-with-warning');
      // done-with-warning migrates onto the theme StatusPill (LIN-783): a `done`
      // pill (no 5th colour) plus an additive ⚠ warning marker, not a bespoke
      // .obs-pill state.
      const pill = card.locator('.obs-session-topline .status-pill').first();
      await expect(pill).toHaveClass(/status-pill--done/);
      await expect(pill).toContainText('done');
      await expect(pill.locator('.status-pill__warn')).toBeVisible();
    });
  });

  // LIN-933: the indeterminate "livebar" shimmer — the collapsed running-row's
  // in-flight affordance. It renders ONLY for a live (running) worker run that is
  // not expanded, and its reduced-motion fallback is a static half-opacity FILL
  // (not a band frozen mid-sweep). It is decorative + aria-hidden; the run's
  // "running" state is already conveyed textually by `.obs-worker-state`.
  test.describe('Running-collapsed livebar shimmer (LIN-933)', () => {
    // Seed an autopilot session whose implementation worker is RUNNING: dispatch
    // the worker under an anchor session, then claim it via the consumer take flow.
    // A taken run with no terminal feedback reconstructs with agentState 'running'
    // (live) — the exact state the livebar is for. Passing `terminalMarker` posts
    // that marker so the run instead reconstructs terminal (not live).
    async function seedSessionWorker(page, { terminalMarker = null } = {}) {
      const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-933', issueTitle: 'Livebar seed', target: 'cli' }
      });
      expect(anchor.status()).toBe(201);
      const anchorId = (await anchor.json()).item.id;
      const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-934', issueTitle: 'Running worker', target: 'cli', sessionId: anchorId }
      });
      expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
      const workerId = (await worker.json()).item.id;

      const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
      const { token } = await tokenResp.json();
      const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
      if (terminalMarker) {
        const fb = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { message: terminalMarker }
        });
        expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
      }
    }

    // Load the page, drill into the seeded session, and return the (collapsed by
    // default) implementation worker node.
    async function openWorker(page, seedOpts) {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedSessionWorker(page, seedOpts);

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      const card = page.locator('.obs-session').filter({ hasText: 'Livebar seed' }).first();
      await expect(card).toBeVisible();
      await card.locator('.obs-disc').first().click();
      const worker = card.locator('.obs-worker').filter({ hasText: 'implementation' }).first();
      await expect(worker).toBeVisible();
      return worker;
    }

    test('a running, collapsed worker shows an aria-hidden livebar; expanding hides it', async ({ page }) => {
      const worker = await openWorker(page);
      const livebar = worker.locator('.livebar');
      await expect(livebar).toHaveCount(1);
      // Decorative: the textual `.obs-worker-state` carries the "running" signal.
      await expect(livebar).toHaveAttribute('aria-hidden', 'true');

      // Expanding the worker row removes the collapsed-only affordance (mockup's
      // `running && !open`).
      await worker.locator('.obs-worker-head').click();
      await expect(worker.locator('.obs-worker-body')).toBeVisible();
      await expect(worker.locator('.livebar')).toHaveCount(0);
    });

    test('a terminal (non-live) worker shows no livebar', async ({ page }) => {
      const worker = await openWorker(page, { terminalMarker: '[done] shipped' });
      await expect(worker.locator('.obs-worker-state')).toHaveText('complete');
      await expect(worker.locator('.livebar')).toHaveCount(0);
    });

    test('reduced motion renders the livebar as a static, full-width, half-opacity fill', async ({ page }) => {
      // The enforced CI guard (pixel diffs can't reliably prove opacity/width):
      // under reduced motion the `:after` band must stop animating and become a
      // solid amber fill spanning the whole track at ~0.5 opacity — beating the
      // global freezer, which only stalls the animation and can leave the 38%
      // band frozen off-centre.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const worker = await openWorker(page);
      const livebar = worker.locator('.livebar');
      await expect(livebar).toHaveCount(1);

      const style = await livebar.evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        return {
          animationName: after.animationName,
          opacity: after.opacity,
          afterWidth: parseFloat(after.width),
          hostWidth: el.clientWidth,
        };
      });
      expect(style.animationName).toBe('none');
      expect(style.opacity).toBe('0.5');
      // Full-width fill, not the 38% animated band.
      expect(style.afterWidth).toBeGreaterThan(style.hostWidth * 0.9);
    });
  });

  // LIN-1019: the feed must offer a click-path to the per-session page, where the
  // human follow-up reply box (LIN-1004) lives. A "waiting on you" card (LIN-1005)
  // without that link is a dead end. The header carries a persistent `open ↗`
  // anchor; a waiting card additionally carries a `reply →` CTA. Both point at
  // /workspace/:urlKey/observation/session/:sessionId for the session's OWN key.
  test.describe('per-session page link (LIN-1019)', () => {
    // Drive a run to a non-terminal [blocked] wake marker so the session rolls up
    // to the session-level "waiting on user" state (LIN-1005).
    async function seedWaitingRun(page, { issueIdentifier, issueTitle }) {
      const item = await seedQueuedRun(page, { issueIdentifier, issueTitle });
      const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
      const { token } = await tokenResp.json();
      const take = await page.request.post(`/api/dispatch/take/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
      const fb = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { message: '[blocked] need a decision from you' }
      });
      expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
    }

    test('a waiting card links to the per-session page via both the header and a reply CTA', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await clearRuns(page);
      await seedWaitingRun(page, { issueIdentifier: 'LIN-1019', issueTitle: 'Reply-me session' });

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');

      const card = page.locator('.obs-session').filter({ hasText: 'Reply-me session' }).first();
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-status', 'waiting');

      // Both affordances resolve to the same session route, and the href carries
      // this session's OWN workspace key (the feed is cross-workspace merged).
      const sessionPathRe = new RegExp(`/workspace/${URL_KEY}/observation/session/[^"']+$`);
      const open = card.locator('.obs-session-open');
      await expect(open).toBeVisible();
      await expect(open).toHaveAttribute('href', sessionPathRe);

      const reply = card.locator('.obs-summary-reply');
      await expect(reply).toBeVisible();
      await expect(reply).toHaveAttribute('href', sessionPathRe);

      // The link actually lands on the dedicated session page — and that page is
      // the one that renders the reply surface (LIN-1004; LIN-1163 moved it from
      // a page-level box to the per-run inline reply, which lives inside a
      // collapsed run card until expanded — the whole-card click, item 3).
      await reply.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toMatch(sessionPathRe);
      const run = page.locator('[data-testid="session-run"]').first();
      await run.click();
      await expect(run.locator('[data-testid="session-inline-reply"]')).toBeVisible();
    });
  });

  // LIN-1487 (S2c) T5 — the repaint-freeze regression guard.
  //
  // A multi-wake lineage folds into ONE visual unit in the feed, but the runs
  // stay unfolded and `sessionSignature` keeps mapping over the unfolded runs, so
  // a per-run agentState transition INSIDE a folded lineage must still repaint the
  // open card. The hazard the plan names: had the fold collapsed the run term in
  // the signature, this transition would be invisible and the open card would
  // freeze on stale state.
  //
  // The mechanism is forced. A real feedback POST advances `lastActivity`, itself
  // a signature term, so the card would repaint for an UNRELATED reason and pass
  // green against the very defect the test exists to catch. So the sessions feed
  // is fully mocked with `lastActivity`, `status` and `runCount` byte-identical
  // across both polls — the ONLY term that can move the signature is the run term
  // the fold would destroy. Poll #2 is forced immediately via `visibilitychange`
  // (the page's own handler) rather than waiting out the 5s cadence.
  test.describe('lineage fold — two-poll repaint (LIN-1487 T5)', () => {
    test('a per-run state change inside a folded lineage repaints the open card', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);

      // One session, one task, TWO wakes sharing a lineage (rootItemId-derived
      // lineageId) → they fold into one `.obs-lineage` unit. Pinned across polls:
      // status/runCount/lastActivity. Only run 'wake-1' moves: running → complete.
      const LAST_ACTIVITY = new Date(Date.now() - 60 * 1000).toISOString(); // recent → Active
      const runBase = (loopId, agentState) => ({
        loopId, lineageId: 'lineage-root', issueIdentifier: 'LIN-1487', issueTitle: 'Feed fold',
        agentState, stage: null, promptName: 'implementation', kind: 'implementation',
        iteration: null, agentSummary: null, runtime: null, metrics: [], toolPeak: null,
        producedArtifacts: [],
      });
      const feed = (wake1State) => ({
        active: [{
          sessionId: 'sess-fold-e2e', workspaceUrlKey: URL_KEY, workspaceName: 'Test',
          seedIssue: 'LIN-1486', seedTitle: 'Fold session', tasksTouched: ['LIN-1487'],
          status: 'in-progress', terminal: false, stale: false, standalone: false, taken: true,
          waiting: false, waitingMessage: null,
          runCount: 2,
          runs: [runBase('wake-1', wake1State), runBase('wake-2', 'complete')],
          recentKind: null, dispatchedAt: LAST_ACTIVITY, completedAt: null,
          lastActivity: LAST_ACTIVITY, runtime: null, model: null,
        }],
        recent: [], recentTotal: 0,
        counts: { total: 1, active: 1, recent: 0 },
      });

      // Response is gated on a flag the test flips — robust to however many polls
      // fire before we advance (they all read 'running', never a premature
      // 'complete').
      let advanced = false;
      await page.route('**/api/dashboard/sessions*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed(advanced ? 'complete' : 'running')) })
      );
      // Neutralise the drill-down side fetches so expansion never errors/hangs.
      for (const glob of ['**/api/dashboard/session-context/**', '**/api/dashboard/hydrate/**', '**/api/dashboard/session-summary/**', '**/api/dashboard/run-summary/**']) {
        await page.route(glob, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      }

      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');

      const card = page.locator('#obs-active .obs-session').filter({ hasText: 'Fold session' }).first();
      await expect(card).toBeVisible();
      await card.locator('.obs-disc').first().click();

      // The two wakes are folded into ONE lineage unit (not two bare cells).
      const lineage = card.locator('.obs-lineage').first();
      await expect(lineage).toBeVisible();
      await expect(lineage.locator('.obs-worker')).toHaveCount(2);

      // Poll #1 state: wake-1 is running.
      const wake1 = card.locator('.obs-worker').filter({ has: page.locator('[data-loop="wake-1"]') }).first();
      await expect(wake1.locator('.obs-worker-state')).toHaveText('running');

      // Advance the feed and force poll #2. lastActivity/status/runCount are
      // unchanged, so the signature moves ONLY on wake-1's agentState.
      advanced = true;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

      // The open card must repaint: wake-1 now reads 'complete'. A frozen card
      // (folded-signature regression) would still read 'running' here.
      await expect(wake1.locator('.obs-worker-state')).toHaveText('complete');
      // The card stayed folded and intact across the repaint.
      await expect(card.locator('.obs-lineage .obs-worker')).toHaveCount(2);
    });
  });
});

// LIN-1194: the Sessions tab. An intra-page switcher on the Observation page adds
// a "Sessions" view that surfaces every in-flight session — including standalone
// user-dispatched (non-autopilot) cli/web prompts the autopilot-centric feed drops.
test.describe('Sessions tab — in-flight standalone sessions (LIN-1194)', () => {
  // A standalone RUNNING session: a non-autopilot cli prompt (no sessionId) that a
  // consumer has TAKEN but not finished → reconstructs taken + non-terminal, i.e.
  // running-only in-flight. Standalone because kind !== 'autopilot' and no sessionId.
  async function seedStandaloneRunning(page, { issueIdentifier, issueTitle }) {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { prompt: 'do the thing', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli' }
    });
    expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
    const item = (await res.json()).item;
    const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
    const { token } = await tokenResp.json();
    const take = await page.request.post(`/api/dispatch/take/${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
    return item;
  }

  test('all three tabs render, Autopilot active by default', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    // A third tab, Rulings, was added by LIN-1728 Phase 4 — its own coverage
    // lives in tests/e2e/observation-rulings.spec.js; asserted here only for
    // count/inactive-by-default so this file's own tab invariant stays true.
    const tabs = page.locator('#obs-tabs .obs-tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('.obs-tab[data-view="autopilot"]')).toHaveClass(/is-active/);
    await expect(page.locator('.obs-tab[data-view="sessions"]')).not.toHaveClass(/is-active/);
    await expect(page.locator('.obs-tab[data-view="rulings"]')).not.toHaveClass(/is-active/);
  });

  test('a standalone running session shows under Sessions but NOT under Autopilot', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedStandaloneRunning(page, { issueIdentifier: 'LIN-1194', issueTitle: 'Standalone in-flight' });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    // Autopilot tab (default): the standalone session must not appear at all.
    await expect(
      page.locator('.obs-session').filter({ hasText: 'Standalone in-flight' })
    ).toHaveCount(0);

    // Switch to the Sessions tab — the standalone session appears in the Active feed.
    await page.locator('.obs-tab[data-view="sessions"]').click();
    await expect(page.locator('.obs-tab[data-view="sessions"]')).toHaveClass(/is-active/);
    const card = page.locator('#obs-active .obs-session').filter({ hasText: 'Standalone in-flight' });
    await expect(card).toBeVisible();

    // Switch back to Autopilot — it disappears again (the two views are distinct).
    await page.locator('.obs-tab[data-view="autopilot"]').click();
    await expect(
      page.locator('.obs-session').filter({ hasText: 'Standalone in-flight' })
    ).toHaveCount(0);
  });

  test('the standalone session card links to its own per-session page (reuses LIN-1003/1004)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedStandaloneRunning(page, { issueIdentifier: 'LIN-1194', issueTitle: 'Standalone drill-in' });

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="sessions"]').click();

    const card = page.locator('#obs-active .obs-session').filter({ hasText: 'Standalone drill-in' });
    await expect(card).toBeVisible();
    const sessionPathRe = new RegExp(`/workspace/${URL_KEY}/observation/session/[^"']+$`);
    const open = card.locator('.obs-session-open');
    await expect(open).toHaveAttribute('href', sessionPathRe);
    await open.click();
    await page.waitForLoadState('networkidle');
    // The dedicated per-session page renders the standalone session with no new
    // plumbing (it resolves by the session's own dispatch id).
    expect(page.url()).toMatch(sessionPathRe);
    await expect(page.locator('.page-header')).toContainText(/Session|session/);
  });
});

// ── LIN-2298: the acceptance witness ────────────────────────────────────────
//
// This is the sweep the ticket was refused on. LIN-2298 demanded "measure
// first", and lane C's measurement is what turned it from a suspected
// over-reserved padding into a ruled-on defect: with six seeded sessions and a
// rect sweep every 2px, the last `.obs-session` intersected the fixed
// `.feedback-fab` at 111 scroll offsets (520–740 at 360px) and the card's own
// `open ↗` control at 26 (578–628). 111/26 at 320 and 390, 112/27 at 430.
//
// Why the Observation feed and not another page: `.obs-session` cards span the
// reading column BY DESIGN, and LIN-2272's result is that no CSS reserve keeps
// full-width content out of a fixed overlay's path at every scroll offset. The
// horizontal reserve that worked for the footer rows (LIN-2299) and the centred
// Live Console button (LIN-2296) had nowhere to push these cards to. That is
// what made John rule for relocating the trigger rather than reserving again.
//
// The selector correction matters and is recorded here because the ticket's own
// text got it wrong: it asked for a sweep of "the last `.obs-card`", and
// `.obs-card` appears NOWHERE in the repo. The real card is `.obs-session` and
// its control is `.obs-session-open`, inside `.obs-session-side`. A guard
// written from the ticket's wording would have swept a phantom and passed.
//
// Asserted against ANY visible fixed overlay rather than against `.feedback-fab`
// by name — see tests/fixed-overlay-sweep.js. Naming the deleted element would
// make this pass vacuously, which is the exact shape of the LIN-2252 no-op the
// whole ticket family exists to have caught.
test.describe('LIN-2298: no fixed overlay covers the Observation feed', () => {
  // Six sessions, matching the count lane C measured with. The count is
  // load-bearing: the sweep needs a document tall enough to actually scroll,
  // and the overlap band it is guarding against was measured on a feed this
  // long. One card would leave `maxScroll` at 0 and the loop would run a single
  // iteration at rest — passing while testing nothing.
  async function seedFeed(page, n = 6) {
    const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
    const { token } = await tokenResp.json();
    for (let i = 0; i < n; i++) {
      const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
        data: {
          prompt: 'do the thing', promptName: 'implementation', kind: 'implementation',
          issueIdentifier: `LIN-229${i}`, issueTitle: `Sweep session ${i}`, target: 'cli'
        }
      });
      expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
      const item = (await res.json()).item;
      // TAKEN but unfinished → the card reconstructs as in-flight and renders
      // its `open ↗` control, which is the interactive half of the acceptance.
      const take = await page.request.post(`/api/dispatch/take/${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
    }
  }

  for (const width of [320, 360, 390, 430]) {
    test(`the last session card and its open control are clear of every fixed overlay (${width}px)`, async ({ page }) => {
      // feedbackWidget ON deliberately: this is the configuration that produced
      // the 111/26 overlaps, so it is the one worth asserting against. With the
      // flag off the old FAB was not rendered either and the sweep would have
      // been green for the wrong reason.
      await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ feedbackWidget: true })}`);
      await clearRuns(page);
      await seedFeed(page);

      await page.setViewportSize({ width, height: 844 });
      await page.goto(OBSERVATION_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('.obs-tab[data-view="sessions"]').click();

      // Preconditions, so a green sweep cannot mean "nothing was there".
      await expect(page.getByTestId('feedback-widget-root')).toHaveAttribute('data-enabled', 'true');
      const cards = page.locator('#obs-active .obs-session');
      await expect(cards.first()).toBeVisible();
      const count = await cards.count();
      expect(count, 'seeded feed rendered').toBeGreaterThan(1);

      // And the document must actually scroll, or every sweep below runs one
      // iteration at rest and proves nothing.
      const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(maxScroll, `page must scroll at ${width}px for the sweep to mean anything`).toBeGreaterThan(0);

      const cardHits = await sweepFixedOverlaps(page, '#obs-active .obs-session:last-of-type');
      expect(cardHits, `last .obs-session: ${describeHits(cardHits)}`).toEqual([]);

      const openHits = await sweepFixedOverlaps(page, '#obs-active .obs-session:last-of-type .obs-session-open');
      expect(openHits, `its .obs-session-open: ${describeHits(openHits)}`).toEqual([]);
    });
  }

  // The relocation half of the acceptance: "a witness that the trigger is
  // present and opens the panel from the nav on a mobile viewport." Run at
  // 360px — the width the overlap was measured at, and the one where the nav
  // is most likely to have collapsed the trigger out of reach.
  test('the nav trigger is present and opens the panel on a mobile viewport', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ feedbackWidget: true })}`);
    await page.setViewportSize({ width: 360, height: 844 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    const trigger = page.getByTestId('nav-feedback-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // The FAB is gone, not merely restyled — assert its absence so a partial
    // revert that left both controls on screen would fail here.
    await expect(page.getByTestId('feedback-fab')).toHaveCount(0);

    await expect(page.getByTestId('feedback-popup')).toBeHidden();
    await trigger.click();
    await expect(page.getByTestId('feedback-popup')).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // And it closes again from the same control — a disclosure, not a one-way door.
    await trigger.click();
    await expect(page.getByTestId('feedback-popup')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
