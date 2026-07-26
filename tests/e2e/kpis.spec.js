/**
 * E2E tests for the public /kpis page.
 *
 * The page requires no authentication and is intentionally not linked from
 * any navigation. It renders server-side stat cards plus Chart.js charts
 * hydrated from an embedded payload.
 */
import { test, expect } from '@playwright/test';

test.describe('KPIs page', () => {
  test('renders without authentication', async ({ page }) => {
    await page.goto('/kpis');

    await expect(page.locator('h2')).toHaveText('instance kpis');
    // The headline outcome number sits ABOVE .kpi-cards and is deliberately not
    // one of them — it is a ratio, not a volume count — so this stays 11.
    await expect(page.locator('.kpi-cards .kpi-card')).toHaveCount(11);
    await expect(page.locator('.kpi-card-label').first()).toHaveText('workspaces');
    await expect(page.locator('.kpi-card-label', { hasText: 'autopilot runs' })).toBeVisible();
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
    expect(data.dispatchByWeek.weeks.length).toBe(5);
    // The outcome trend uses 4 weekly buckets, NOT the 5-week span above: the
    // history TTL is 30 days, so a 35-day span under-fills its oldest bucket.
    expect(data.dispatchOutcomes.weeks.length).toBe(4);
    expect(data.dispatchOutcomes.weeklyRate.length).toBe(4);
    expect(data.dispatchOutcomes.weeklyResolved.length).toBe(4);
    expect(data.dispatchOutcomes.windowDays).toBe(30);
    expect(data.funnel).toBeTruthy();
    expect(data.hourOfDay.length).toBe(24);
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
