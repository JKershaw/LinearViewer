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
    await expect(page.locator('.kpi-cards .kpi-card')).toHaveCount(11);
    await expect(page.locator('.kpi-card-label').first()).toHaveText('workspaces');
    await expect(page.locator('.kpi-card-label', { hasText: 'autopilot runs' })).toBeVisible();
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
    expect(data.funnel).toBeTruthy();
    expect(data.hourOfDay.length).toBe(24);
  });

  test('chart areas render (chart or empty-state note) for each section', async ({ page }) => {
    await page.goto('/kpis');

    // Each chart box ends up with either a live canvas or a "no data yet"
    // note — never an empty hole.
    const boxes = page.locator('.kpi-chart-box');
    await expect(boxes).toHaveCount(9);
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
