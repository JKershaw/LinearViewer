/**
 * Swim Page — Vertical Orientation tests
 *
 * Exercises the orientation toggle: UI control, DOM data attribute, CSS layout
 * flip, inline sizing, persistence, and connector rendering in the vertical
 * variant.
 */
import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed } from '../fixtures/local-harness.js';

// LIN-378: rides a seeded local workspace (no `test-token` mock) — same swim
// sample fixture, converted to local shape.

test.describe('Swim Page — Vertical Orientation', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed);
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await page.evaluate(() => localStorage.removeItem('swim-settings'));
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await page.waitForLoadState('networkidle');
  });

  test('orientation select exists and defaults to flow', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    const select = page.locator('#swim-orientation');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('flow');

    // Page root should reflect flow by default
    await expect(page.locator('.swim-page')).toHaveAttribute('data-orientation', 'flow');
  });

  test('switching to vertical sets data-orientation on the page', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    await expect(page.locator('.swim-page')).toHaveAttribute('data-orientation', 'vertical');
  });

  test('vertical mode lays out lanes as a row, items column-stacked', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    // .swim-lanes should be flex-direction: row
    const lanesFlexDir = await page.locator('#swim-lanes').evaluate(el =>
      getComputedStyle(el).flexDirection
    );
    expect(lanesFlexDir).toBe('row');

    // Each .swim-lane should be flex-direction: column
    const laneFlexDir = await page.locator('.swim-lane').first().evaluate(el =>
      getComputedStyle(el).flexDirection
    );
    expect(laneFlexDir).toBe('column');

    // Lanes should lay out side-by-side: first two lanes have the same approximate top
    const bounds = await page.locator('.swim-lane').evaluateAll(els =>
      els.slice(0, 2).map(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left };
      })
    );
    if (bounds.length === 2) {
      expect(Math.abs(bounds[0].top - bounds[1].top)).toBeLessThan(20);
      expect(bounds[1].left).toBeGreaterThan(bounds[0].left);
    }
  });

  test('vertical mode emits min-height instead of min-width on segments', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    // At least one segment should carry inline min-height style
    const styles = await page.locator('.swim-lane-segment').evaluateAll(els =>
      els.map(el => el.getAttribute('style') || '')
    );
    expect(styles.some(s => /min-height:\s*\d+px/.test(s))).toBeTruthy();
    expect(styles.every(s => !/min-width:\s*\d+px/.test(s))).toBeTruthy();
  });

  test('lane labels appear on top in vertical mode', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    // Label should be vertically above the first item in the same lane
    const rects = await page.locator('.swim-lane').first().evaluate(lane => {
      const label = lane.querySelector('.swim-lane-label');
      const box = lane.querySelector('.swim-box');
      if (!label || !box) return null;
      return {
        labelBottom: label.getBoundingClientRect().bottom,
        boxTop: box.getBoundingClientRect().top
      };
    });
    expect(rects).not.toBeNull();
    if (rects) {
      expect(rects.labelBottom).toBeLessThanOrEqual(rects.boxTop + 2);
    }
  });

  test('orientation is persisted in localStorage', async ({ page, localWorkerUrlKey }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');
    await page.waitForTimeout(100);

    // Reload page
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await page.waitForLoadState('networkidle');

    // Should still be in vertical mode
    await expect(page.locator('.swim-page')).toHaveAttribute('data-orientation', 'vertical');
    await page.locator('.swim-settings-toggle').click();
    await expect(page.locator('#swim-orientation')).toHaveValue('vertical');
  });

  test('toggling back to horizontal restores horizontal layout', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');
    await expect(page.locator('.swim-page')).toHaveAttribute('data-orientation', 'vertical');

    await page.locator('#swim-orientation').selectOption('horizontal');
    await expect(page.locator('.swim-page')).toHaveAttribute('data-orientation', 'horizontal');

    const lanesFlexDir = await page.locator('#swim-lanes').evaluate(el =>
      getComputedStyle(el).flexDirection
    );
    expect(lanesFlexDir).toBe('column');
  });

  test('vertical mode still renders task boxes with the right parts', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    const box = page.locator('.swim-box').first();
    await expect(box).toBeVisible();
    await expect(box.locator('.swim-box-state')).toBeVisible();
    await expect(box.locator('.swim-box-title')).toBeVisible();
  });

  test('vertical mode with showBlockers draws connectors', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');
    await page.locator('#swim-show-blockers').check();
    await page.waitForTimeout(200);

    // SVG connector layer should be present (the sample data has blocking relations)
    const connectorSvg = page.locator('#swim-connectors');
    await expect(connectorSvg).toBeAttached();
  });

  test('popover still opens on box click in vertical mode', async ({ page }) => {
    await page.locator('.swim-settings-toggle').click();
    await page.locator('#swim-orientation').selectOption('vertical');

    await page.locator('.swim-box').first().click();
    await expect(page.locator('#swim-popover')).not.toHaveClass(/hidden/);
  });
});
