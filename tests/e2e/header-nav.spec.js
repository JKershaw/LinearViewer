import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed } from '../fixtures/local-harness.js';
import { nav } from '../helpers.js';

// LIN-978 (UI audit D, keystone): the shared header-level view switcher. The
// cross-view links were hoisted from the footer into `renderNavBar`, so
// cross-view navigation is reachable from the sticky header on every workspace
// page — usable at 390px in a single row, not the old multi-line footer wrap.
//
// Rides the realistic swim seed on the local provider (the same seed the
// before/after screenshot review uses). Flagged power-user views are enabled so
// the switcher is at its widest (7 links) — the worst case for wrapping.

const FLAGS = { roadmap: true, dispatch: true, proxy: true };

test.describe('Header view switcher (LIN-978)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
  });

  test('carries the tier-gated view links in the header on the dashboard', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // First-class views always present.
    for (const view of ['observation', 'swipe', 'swim', 'settings']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
    // Flagged power-user views present because their flags are on.
    for (const view of ['roadmap', 'dispatch', 'proxy']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
    // The footer no longer carries any of the hoisted view links.
    await expect(page.locator('.footer-actions [data-testid^="footer-link-"]')).toHaveCount(0);
  });

  test('flagged power-user views are hidden when their flags are off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: {} });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    for (const view of ['observation', 'swipe', 'swim', 'settings']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
    for (const view of ['roadmap', 'dispatch', 'proxy']) {
      await expect(nav(page).getView(view)).toHaveCount(0);
    }
  });

  test('experimental views are NOT hoisted into the header (Settings-only)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Even with every experimental flag on, they must not appear in the switcher.
    await seedLocal(swimLocalSeed, {
      features: { collective: true, taskChat: true, ship: true, nextRun: true, flightCompanion: true }
    });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    for (const view of ['collective', 'task-chat', 'taskChat', 'ship', 'next-run', 'nextRun', 'flight-companion']) {
      await expect(nav(page).getView(view)).toHaveCount(0);
    }
  });

  test('collapses flag-gated views behind ⋯ more at 390px, first-class five stay inline (LIN-1058)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // The first-class five (LIN-1088 added projects) stay inline on the strip
    // and share one vertical band.
    for (const view of ['observation', 'swipe', 'swim', 'projects', 'settings']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
    const primaryTops = await page.locator('.nav-views > [data-testid^="nav-view-"]').evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().top)
    );
    expect(primaryTops.length).toBe(5); // exactly the first-class five inline (dashboard hoists no extra tab; projects IS the dashboard's current tab)
    expect(Math.max(...primaryTops) - Math.min(...primaryTops)).toBeLessThan(4);

    // The flag-gated views are collapsed (not visible) until `⋯ more` opens them.
    for (const view of ['roadmap', 'dispatch', 'proxy']) {
      await expect(nav(page).getView(view)).not.toBeVisible();
    }
    const more = page.locator('[data-testid="nav-more-toggle"]');
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    // Opening `⋯ more` reveals the flag-gated views in the in-flow expander.
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const view of ['roadmap', 'dispatch', 'proxy']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
  });

  test('every nav view target is a comfortable 44px tap target at 390px', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Primary (inline) links + the ⋯ more toggle must all clear 44px.
    const inlineHeights = await page.locator('.nav-views > [data-testid^="nav-view-"], .nav-more-toggle').evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().height)
    );
    for (const h of inlineHeights) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('cross-view nav is reachable at 390px without scrolling the page', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // The switcher sits in the sticky header near the top of the viewport, so it
    // is on-screen with the page at its initial (unscrolled) scroll position.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const box = await nav(page).getView('swim').boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeLessThan(800); // within the initial viewport, no scroll needed
  });
});
