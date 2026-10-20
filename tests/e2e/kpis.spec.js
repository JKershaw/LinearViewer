/**
 * E2E tests for the public /kpis page, rebuilt in LIN-3703
 * (docs/plans/kpis-public-design.md).
 *
 * The page requires no authentication and is intentionally not linked from
 * any navigation. It renders server-side sections plus Chart.js charts
 * hydrated from an embedded payload; counts below the floor render as text.
 */
import { test, expect } from '@playwright/test';
import { SELECTORS } from '../helpers.js';
import { renderKpisPage } from '../../lib/render-kpis.js';
import { toPublicKpis } from '../../lib/kpi-stats.js';
import { buildStats } from '../helpers/public-kpis-fixture.js';

const K = SELECTORS.publicKpis;

// LIN-1846: /kpis is the only spec that ever requests /kpis, and the route
// caches its instance-wide stats process-wide for 60s (server.js KPI_CACHE_MS)
// with no test-only bypass. Seeding proxy events in beforeAll — before ANY
// test in this file issues the first page.goto('/kpis') — guarantees that
// first request lands on a cold cache, which awaits the fresh DB read
// synchronously, so the seeded events are already in the snapshot every
// later test (warm or stale-refreshed) reads. Seeding per-test instead would
// often land after the cache is already warm, leaving the charts empty for
// the rest of the run regardless of the fixture.
const SEED_URL_KEY = 'kpis-e2e-seed';

test.describe('KPIs page', () => {
  test.beforeAll(async ({ request }) => {
    await request.get(`/test/seed-proxy-event?urlKey=${SEED_URL_KEY}&status=200&endpoint=/api/proxy/issues`);
    await request.get(`/test/seed-proxy-event?urlKey=${SEED_URL_KEY}&status=404&endpoint=/api/proxy/me`);
  });

  test.afterAll(async ({ request }) => {
    await request.get(`/test/clear-proxy-events?urlKey=${SEED_URL_KEY}`);
  });

  test('renders without authentication, as three sections', async ({ page }) => {
    await page.goto('/kpis');

    await expect(page.locator('main.kpis-content > h2')).toHaveText('Harbour in numbers');
    for (const name of ['outcome', 'activity', 'people']) {
      await expect(page.locator(K.section(name))).toBeVisible();
    }
    await expect(page.locator(K.card('workspaces'))).toBeVisible();
    await expect(page.locator(K.card('autopilot-runs'))).toBeVisible();
  });

  test('headlines the dispatch outcome rate with a coverage sub-label', async ({ page }) => {
    await page.goto('/kpis');

    const headline = page.locator(K.headline);
    await expect(headline).toBeVisible();
    await expect(headline.locator('.kpi-headline-value')).toBeVisible();
    await expect(headline.locator('.kpi-headline-label')).toHaveText(/of dispatched work landed · 30d/);
    // The rate must never be readable as covering all dispatched work.
    await expect(headline.locator('.kpi-headline-coverage')).toHaveText(/\d+ of \d+ dispatches resolved · 30d/);
    await expect(headline.locator('.kpi-headline-slices')).toHaveText(/done \d+ · failed \d+ · aborted \d+/);
  });

  test('the headline number links to the evidence behind it', async ({ page }) => {
    await page.goto('/kpis');

    const evidence = page.locator('#kpi-outcome-evidence');
    const link = page.locator('a.kpi-headline-value');
    const rate = await page.evaluate(() => window.__KPI_DATA__.outcomes.rate);
    if (rate === null) {
      // No rate → no anchor: a link to an empty chart is a dead end.
      await expect(link).toHaveCount(0);
      return;
    }
    await expect(link).toHaveAttribute('href', '#kpi-outcome-evidence');
    await link.click();
    await expect(evidence).toBeInViewport();
  });

  test('loads Chart.js and embeds the public view only', async ({ page }) => {
    await page.goto('/kpis');

    expect(await page.evaluate(() => typeof window.Chart !== 'undefined')).toBe(true);

    const data = await page.evaluate(() => window.__KPI_DATA__);
    expect(Object.keys(data).sort()).toEqual(['daily', 'dispatchKinds', 'generatedAt', 'milestoneFunnel', 'outcomes', 'phases', 'totals']);
    expect(data.phases.days.length).toBe(30);
    // Four whole weeks inside the 30-day window (the oldest partial week would under-fill).
    expect(data.outcomes.weeks.length).toBe(4);
    expect(data.outcomes.windowDays).toBe(30);
    // The dropped operator figures never cross the public boundary.
    for (const dropped of ['terminalMarkedTaskCost', 'weeklyBudgetGauge', 'vanity', 'topEndpoints']) {
      expect(data[dropped]).toBeUndefined();
    }
  });

  test('chart areas render (chart or empty-state note) for each section', async ({ page }) => {
    await page.goto('/kpis');

    // Each chart box ends up with either a live canvas or a note — never an empty hole.
    const boxes = page.locator('[data-testid^="kpis-chart-"]');
    await expect(boxes).toHaveCount(6);
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      expect(await boxes.nth(i).locator('canvas, .kpi-chart-empty').count()).toBeGreaterThan(0);
    }
  });

  test('no floored count in 1..floor-1 reaches the embedded payload, and every hidden leaf has a text row', async ({ page }) => {
    await page.goto('/kpis');
    const data = await page.evaluate(() => window.__KPI_DATA__);
    const floor = Number((await page.locator(K.privacy).textContent()).match(/fewer than (\d+)/)[1]);
    const floored = [
      data.totals.workspaces,
      ...Object.values(data.milestoneFunnel.steps).map(s => s.count),
      ...(data.milestoneFunnel.mode ? [data.milestoneFunnel.mode.total, ...data.milestoneFunnel.mode.byRung.flatMap(r => [r.entries, r.notReady])] : [])
    ];
    for (const leaf of floored) {
      if (typeof leaf === 'number') expect(leaf === 0 || leaf >= floor).toBe(true);
    }
    const hidden = floored.filter(leaf => leaf && typeof leaf === 'object').length;
    await expect(page.locator(K.hidden)).toHaveCount(hidden);
  });

  test('renders without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/kpis');
    await page.waitForTimeout(300); // let charts lay out

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The cards stay visible
    await expect(page.locator(K.card('workspaces'))).toBeVisible();
  });

  test('shows footer with legal links and is not linked from the landing page', async ({ page }) => {
    await page.goto('/kpis');
    await expect(page.locator('.page-footer')).toBeVisible();
    await expect(page.locator('.page-footer a[href="/privacy"]')).toBeVisible();
    await expect(page.locator(K.privacy)).toContainText('never shows names, workspace keys or content');

    // The page is intentionally unlinked: the landing page must not point to it
    await page.goto('/');
    await expect(page.locator('a[href="/kpis"]')).toHaveCount(0);
  });
});

// LIN-3710: the trend charts, sparklines and disclosures, drawn from a seeded
// 30-day payload. The page is built from the fixture with the real renderer and
// served in place of /kpis, so the numbers are known and nothing is cached.
test.describe('KPIs page — trend charts from a seeded payload (LIN-3710)', () => {
  const view = toPublicKpis(buildStats({ fullSeries: true }));
  const DISCLOSURES = ['outcome-trend', 'outcome-weekly', 'done-daily', 'proxy-phases'];

  test.beforeEach(async ({ page }) => {
    const html = renderKpisPage(view);
    await page.route('**/kpis', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  });

  test('every chart canvas has a live chart and the 7-day line has 23 points', async ({ page }) => {
    await page.goto('/kpis');
    for (const name of ['outcome-trend', 'outcome-weekly', 'done-daily', 'proxy-phases']) {
      const live = await page.evaluate(id => Boolean(window.Chart.getChart(document.getElementById(id))), `chart-${name}`);
      expect(live, name).toBe(true);
    }
    const line = await page.evaluate(() => {
      const chart = window.Chart.getChart(document.getElementById('chart-proxy-phases'));
      return chart.data.datasets.find(d => d.type === 'line').data;
    });
    expect(line).toHaveLength(30);
    expect(line.filter(v => v !== null)).toHaveLength(23);
    const trend = await page.evaluate(() => window.Chart.getChart(document.getElementById('chart-outcome-trend')).config.type);
    expect(trend).toBe('line');
  });

  test('three cards carry a 30-point sparkline and workspaces carries none', async ({ page }) => {
    await page.goto('/kpis');
    for (const name of ['agent-actions', 'dispatches', 'autopilot-runs']) {
      const svg = page.locator(`${K.spark(name)} svg`);
      await expect(svg).toHaveAttribute('role', 'img');
      await expect(svg).toHaveAttribute('data-points', '30');
    }
    await expect(page.locator(K.spark('workspaces'))).toHaveCount(0);
    await expect(page.locator(`${K.headline} svg`)).toHaveCount(0);
  });

  test('each disclosure is closed, then opens to a table with the right rows', async ({ page }) => {
    await page.goto('/kpis');
    const rows = { 'outcome-trend': 4, 'outcome-weekly': 4, 'done-daily': 30, 'proxy-phases': 30 };
    for (const name of DISCLOSURES) {
      const details = page.locator(K.numbers(name));
      await expect(details).not.toHaveAttribute('open', '');
      await details.locator('summary').click();
      await expect(details.locator('tbody tr')).toHaveCount(rows[name]);
    }
    await expect(page.locator(`${K.numbers('done-daily')} tbody tr`).last()).toContainText('today, so far');
  });

  test('no horizontal scroll at 390px with every disclosure open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/kpis');
    for (const name of DISCLOSURES) await page.locator(K.numbers(name)).locator('summary').click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// LIN-3002: /kpis must never fall back to a whole-collection read when a KPI
// aggregation fails — it must propagate the error so the route's EXISTING
// warm-stale-serve / cold-500 handling (server.js app.get('/kpis'), untouched
// by this ticket) is what actually runs. These cases use the /test/kpis-fail-
// next-aggregate + /test/clear-kpi-cache seam (routes/test.js) to make one
// real collection's aggregate() reject for exactly one call, rather than
// mocking anything — server.js and lib/kpi-stats.js run for real throughout.
//
// Seam choice, recorded per the assignment: server.js does not export `app`/
// `kpiCache`/its DB collections, and is a single top-level script that binds
// a real port and DB connection on import — there is no existing precedent in
// this repo for importing it into a `node --test` unit file, and doing so
// here would be a much larger, riskier seam than reusing the E2E boot this
// file already relies on. The established, already-proven pattern for
// exactly this class of problem (injecting server-side test state Playwright
// specs can't reach any other way) is the NODE_ENV=test-gated `/test/*` route
// family in routes/test.js — session/state seeding, provider faking, etc.
// already work this way. So the seam here is two small additive routes in
// that same family: one arms a one-shot rejecting aggregate() on the named
// collection (self-restoring after exactly one call) plus a one-shot
// console.error capture for the loader-failure log line; the other resets the
// process-wide kpiCache singleton to cold or warm-but-stale. `/kpis`'s own
// route body (server.js:1931-1954) is untouched by any of this.
//
// Dependents identified before touching the shared kpiCache/collection seam:
// kpiCache/kpiInflight have exactly one reader/writer in server.js — the
// `/kpis` route itself (confirmed by grep; nothing else in server.js
// references either binding) — so resetting it here cannot desync any other
// route's state. `.aggregate()` has exactly two call sites in the whole repo
// (both in lib/kpi-stats.js, per the ticket's own grep), so patching it on
// dispatchHistoryCollection/proxyEventsCollection cannot affect any other
// consumer of those collections (which all use `.find()`/`.countDocuments()`,
// left untouched). This file's OWN earlier tests (and any other E2E spec)
// share the same process-wide kpiCache/collections; running concurrently with
// this block is the same pre-existing worker-isolation class CLAUDE.md
// already calls out for free-tier.spec.js/proxy-local.spec.js, not a new risk
// this ticket introduces — mitigated here the same way, by never raising
// `workers` and keeping this block's own tests sequential (fullyParallel is
// already false repo-wide).
//
// Expected to be RED against today's (unfixed) lib/kpi-stats.js: both loaders
// currently swallow the injected aggregate() rejection and fall back to a
// real find({}) read, which succeeds — so neither case below can observe the
// bug the ticket describes yet. See the beat-1 report for the captured
// pre-fix failure output.
test.describe('KPIs page — aggregation-failure propagation (LIN-3002)', () => {
  async function pollForKpiRefreshError(request, { attempts = 15, intervalMs = 200 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const res = await request.get('/test/last-kpi-refresh-error');
      const { message } = await res.json();
      if (message) return message;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  test('warm cache: a rejecting background refresh still serves the last good snapshot and logs the failure', async ({ request }) => {
    // Establish a real, good snapshot (no fault armed yet).
    await request.get('/test/clear-kpi-cache');
    const goodResponse = await request.get('/kpis');
    expect(goodResponse.status()).toBe(200);
    const goodBody = await goodResponse.text();

    // Keep that snapshot but make it stale, so the next request takes the
    // warm-but-stale branch (serve now, refresh in the background) instead
    // of the fresh (no-refresh) branch.
    await request.get('/test/clear-kpi-cache?mode=stale');

    // Arm a one-shot rejecting aggregate() on proxyEvents for the background
    // refresh this next request triggers.
    await request.get('/test/kpis-fail-next-aggregate?collection=proxyEvents');

    const staleServeResponse = await request.get('/kpis');
    expect(staleServeResponse.status()).toBe(200);
    // Still the last good snapshot — the request must not block on, or be
    // affected by, the background refresh it kicks off.
    expect(await staleServeResponse.text()).toBe(goodBody);

    // The background refresh's rejection must be logged (server.js:1938),
    // never silent. This is the acceptance witness: today, the aggregation
    // failure is swallowed inside the loader and the background refresh
    // resolves via the find({}) fallback instead of rejecting, so this
    // never fires and the poll below times out.
    const message = await pollForKpiRefreshError(request);
    expect(message).toBeTruthy();
    expect(message).toContain('KPI background refresh failed');
  });

  test('cold cache: a rejecting refresh returns the existing 500 error page, never a whole-collection fallback read', async ({ request }) => {
    await request.get('/test/clear-kpi-cache'); // cold: no prior snapshot
    await request.get('/test/kpis-fail-next-aggregate?collection=dispatchHistory');

    const response = await request.get('/kpis');
    // Acceptance witness: today, loadDispatchHistory's catch falls back to
    // dispatchHistory.find({}).toArray(), which succeeds, so
    // collectKpiStats resolves and this returns 200 with a real (if
    // fallback-sourced) page instead of the 500 below — the exact
    // unbounded-read-masks-the-error bug LIN-3002 exists to fix.
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain('Could not load instance KPIs');
  });
});
