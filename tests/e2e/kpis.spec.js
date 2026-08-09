/**
 * E2E tests for the public /kpis page.
 *
 * The page requires no authentication and is intentionally not linked from
 * any navigation. It renders server-side stat cards plus Chart.js charts
 * hydrated from an embedded payload.
 */
import { test, expect } from '@playwright/test';

// LIN-1846: /kpis is the only spec that ever requests /kpis, and the route
// caches its instance-wide stats process-wide for 60s (server.js KPI_CACHE_MS)
// with no test-only bypass. Seeding proxy events in beforeAll — before ANY
// test in this file issues the first page.goto('/kpis') — guarantees that
// first request lands on a cold cache, which awaits the fresh DB read
// synchronously, so the seeded events are already in the snapshot every
// later test (warm or stale-refreshed) reads. Seeding per-test instead would
// often land after the cache is already warm, leaving the toggle-dependent
// charts empty for the rest of the run regardless of the fixture.
const SEED_URL_KEY = 'kpis-e2e-seed';

test.describe('KPIs page', () => {
  test.beforeAll(async ({ request }) => {
    await request.get(`/test/seed-proxy-event?urlKey=${SEED_URL_KEY}&status=200&endpoint=/api/proxy/issues`);
    await request.get(`/test/seed-proxy-event?urlKey=${SEED_URL_KEY}&status=404&endpoint=/api/proxy/me`);
  });

  test.afterAll(async ({ request }) => {
    await request.get(`/test/clear-proxy-events?urlKey=${SEED_URL_KEY}`);
  });

  test('renders without authentication', async ({ page }) => {
    await page.goto('/kpis');

    await expect(page.locator('h2')).toHaveText('instance kpis');
    // The headline outcome number sits ABOVE .kpi-cards and is deliberately not
    // one of them — it is a ratio, not a volume count — so this stays 11.
    await expect(page.locator('.kpi-cards .kpi-card')).toHaveCount(11);
    await expect(page.locator('.kpi-card-label').first()).toHaveText('workspaces');
    await expect(page.locator('.kpi-card-label', { hasText: 'autopilot runs' })).toBeVisible();
  });

  test('renders the cost-per-terminal-marked-task card with its bias/coverage disclosures visible (LIN-1958)', async ({ page }) => {
    await page.goto('/kpis');

    const card = page.locator('.kpi-cost-card');
    await expect(card).toBeVisible();
    // Label pinned verbatim by the 2026-08-03 ruling.
    await expect(card.locator('.kpi-cost-label')).toHaveText('cost per terminal-marked task');
    await expect(card.locator('.kpi-cost-value')).toBeVisible();

    // The figure's window (LIN-1958 review F3) — a separate span, never
    // folded into the pinned label above.
    await expect(card.locator('.kpi-cost-window')).toBeVisible();
    await expect(card.locator('.kpi-cost-window')).toHaveText(/\d+d window/);

    // No plan fee is configured in the e2e environment, so the cash headline
    // stays "—" with the unset-state blocker named.
    await expect(card.locator('.kpi-cost-cash')).toHaveText(/cash: — · pending plan-fee configuration/);

    // The sample size + exclusion count (LIN-1958 review F4) — the
    // issue-level coverage story the LIN-1957 handoff nominated, unlike
    // pricedLineageShare which is blind to whole-lineage capture loss.
    await expect(card.locator('.kpi-cost-sample')).toBeVisible();
    await expect(card.locator('.kpi-cost-sample')).toHaveText(/\d+ terminal-marked issues · \d+ unpriced \(excluded\)/);

    // The four bias/coverage shares are load-bearing disclosures (the
    // ruling's condition for publishing the number at all) — assert they are
    // actually VISIBLE, not merely present somewhere in the DOM.
    const shares = card.locator('.kpi-cost-shares');
    await expect(shares).toBeVisible();
    await expect(shares).toHaveText(/close-out linked/);
    await expect(shares).toHaveText(/evidence linked/);
    await expect(shares).toHaveText(/opencode summed/);
    await expect(shares).toHaveText(/unknown harness/);

    const coverage = card.locator('.kpi-cost-coverage');
    await expect(coverage).toBeVisible();
    await expect(coverage).toHaveText(/priced lineages/);
    await expect(coverage).toHaveText(/attributable lineages/);

    const usdLines = card.locator('.kpi-cost-usd-lines');
    await expect(usdLines).toBeVisible();
    await expect(usdLines).toHaveText(/unresolved/);
    // "resolved overhead", never a bare "overhead" (LIN-1958 review F2) — the
    // LIN-1957 handoff forbids deriving a rendered label from the field name.
    await expect(usdLines).toHaveText(/resolved overhead/);

    // Sits above and outside .kpi-cards — the pinned grid count of 11 (below)
    // must be unaffected by this card.
    await expect(page.locator('.kpi-cards .kpi-cost-card')).toHaveCount(0);
  });

  test('headlines the dispatch outcome rate with a coverage sub-label', async ({ page }) => {
    await page.goto('/kpis');

    const headline = page.locator('.kpi-headline');
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
    await expect(evidence).toHaveClass(/kpi-chart-box/);

    const link = page.locator('a.kpi-headline-value');
    const data = await page.evaluate(() => window.__KPI_DATA__.dispatchOutcomes.rate);
    if (data === null) {
      // No rate → no anchor: a link to an empty chart is a dead end.
      await expect(link).toHaveCount(0);
      return;
    }
    await expect(link).toHaveAttribute('href', '#kpi-outcome-evidence');
    await link.click();
    await expect(evidence).toBeInViewport();
  });

  test('loads Chart.js and the embedded data payload', async ({ page }) => {
    await page.goto('/kpis');

    const hasChart = await page.evaluate(() => typeof window.Chart !== 'undefined');
    expect(hasChart).toBe(true);

    const data = await page.evaluate(() => window.__KPI_DATA__);
    expect(data).toBeTruthy();
    expect(data.totals).toBeTruthy();
    expect(Array.isArray(data.proxyCategories.days)).toBe(true);
    expect(data.proxyCategories.days.length).toBe(30);
    expect(data.proxyCategoriesHourly.hours.length).toBe(24);
    // Dispatched work by kind is now a genuine 30-day daily window (LIN-1846),
    // not the old 5×7-day = 35-day span that exceeded the 30-day history TTL.
    expect(data.dispatchByDay.days.length).toBe(30);
    // The outcome trend uses 4 weekly buckets: the history TTL is 30 days, so
    // a full 30-day span split into whole weeks would under-fill its oldest.
    expect(data.dispatchOutcomes.weeks.length).toBe(4);
    expect(data.dispatchOutcomes.weeklyRate.length).toBe(4);
    expect(data.dispatchOutcomes.weeklyResolved.length).toBe(4);
    expect(data.dispatchOutcomes.windowDays).toBe(30);
    expect(data.funnel).toBeTruthy();
    expect(data.hourOfDay.length).toBe(24);
    // LIN-1957 review round 2 correction: this list never pinned the
    // terminal-marked-task-cost block, so `collectKpiStats` could drop it
    // entirely and this spec would still pass. Pin presence at the public
    // boundary on the RENDERED page, not just in the unit privacy canary.
    expect(data.terminalMarkedTaskCost).toBeTruthy();
  });

  test('chart areas render (chart or empty-state note) for each section', async ({ page }) => {
    await page.goto('/kpis');

    // Each chart box ends up with either a live canvas or a "no data yet"
    // note — never an empty hole.
    const boxes = page.locator('.kpi-chart-box');
    await expect(boxes).toHaveCount(10);
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      const hasContent = await box.locator('canvas, .kpi-chart-empty').count();
      expect(hasContent).toBeGreaterThan(0);
    }
  });

  test('hero chart has a 30d/24h range toggle defaulting to 30d', async ({ page }) => {
    await page.goto('/kpis');

    const toggle = page.locator('.kpi-range-toggle[data-chart="chart-proxy-phases"]');
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('.kpi-range-btn')).toHaveCount(2);
    await expect(toggle.locator('.kpi-range-btn.is-active')).toHaveText('30d');
    await expect(toggle.locator('[data-range="24h"]')).toBeVisible();
  });

  // LIN-1846: the volume-led scope decision gives 24h toggles to the two
  // remaining proxy-derived charts, alongside the hero chart above. Low-volume
  // dispatch/agent-status charts get the honest 30-day window but no toggle.
  for (const chartId of ['chart-proxy-status', 'chart-top-endpoints']) {
    test(`${chartId} has a 30d/24h range toggle that switches the active button on click (LIN-1846)`, async ({ page }) => {
      await page.goto('/kpis');

      // The toggle markup renders unconditionally, server-side, regardless of
      // data — but its click handler is only wired client-side inside the
      // `!emptyUnless(...)` branch (public/kpis.js), which replaces the
      // canvas with a "no data yet" note on an empty chart. So the assertion
      // that actually predicts whether the handler is wired is the CANVAS's
      // survival, not the toggle's. The beforeAll seed above guarantees this
      // chart has data, so the canvas existing is a real assertion here, not
      // a guard that silently skips the rest of the test.
      await expect(page.locator(`#${chartId}`)).toBeVisible();

      const toggle = page.locator(`.kpi-range-toggle[data-chart="${chartId}"]`);
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.kpi-range-btn')).toHaveCount(2);
      await expect(toggle.locator('.kpi-range-btn.is-active')).toHaveText('30d');

      await toggle.locator('[data-range="24h"]').click();
      await expect(toggle.locator('.kpi-range-btn.is-active')).toHaveText('24h');
      await expect(toggle.locator('[data-range="30d"]')).not.toHaveClass(/is-active/);
    });
  }

  test('renders without horizontal overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/kpis');
    await page.waitForTimeout(300); // let charts lay out

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Cards collapse to two columns and stay visible
    await expect(page.locator('.kpi-cards .kpi-card').first()).toBeVisible();
  });

  test('shows footer with legal links and is not linked from the landing page', async ({ page }) => {
    await page.goto('/kpis');
    await expect(page.locator('.page-footer')).toBeVisible();
    await expect(page.locator('.page-footer a[href="/privacy"]')).toBeVisible();

    // The page is intentionally unlinked: the landing page must not point to it
    await page.goto('/');
    await expect(page.locator('a[href="/kpis"]')).toHaveCount(0);
  });
});
