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

  test('experimental views appear in the header ONLY when their flag is on (gated, LIN-1247)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Policy reversal (LIN-1247): experimental views used to be Settings-only and
    // never in the switcher. They are now gated-included in the `⋯ more` overflow.
    const experimentalViews = ['collective', 'task-chat', 'ship', 'next-run', 'flight-companion', 'passage-planner', 'ship-biscuit'];

    // Flags off → none of the experimental views are in the switcher.
    await seedLocal(swimLocalSeed, { features: {} });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
    for (const view of experimentalViews) {
      await expect(nav(page).getView(view)).toHaveCount(0);
    }

    // Every experimental flag on → each view is surfaced (emitted as its kebab
    // route key, whether inline or collapsed in the overflow group).
    await seedLocal(swimLocalSeed, {
      features: { collective: true, taskChat: true, ship: true, nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true }
    });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');
    for (const view of experimentalViews) {
      await expect(nav(page).getView(view)).toHaveCount(1);
    }
    // The camelCase gating flags must NOT leak in as nav keys.
    for (const flag of ['taskChat', 'nextRun', 'flightCompanion', 'passagePlanner', 'shipBiscuit']) {
      await expect(nav(page).getView(flag)).toHaveCount(0);
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

// LIN-1286: desktop nav overflow. Above the 640px mobile breakpoint the strip used
// to inline every flag-gated view and rely on a horizontal scrollbar when many
// experimental features were on. A JS width-measuring routine now collapses ONLY the
// items that don't fit into the same `⋯ more` group (revealing the toggle only when
// something is hidden), so desktop no longer horizontal-scrolls yet a strip that fits
// never over-collapses — and the active-hoist invariant still holds.
test.describe('Desktop nav overflow (LIN-1286)', () => {
  // The widest possible switcher: 5 first-class + 3 power-user + 6 experimental.
  const WIDE_FLAGS = {
    roadmap: true, dispatch: true, proxy: true,
    collective: true, taskChat: true, ship: true,
    nextRun: true, flightCompanion: true, shipBiscuit: true
  };
  const FLAG_GATED = ['roadmap', 'dispatch', 'proxy', 'collective', 'task-chat', 'ship', 'next-run', 'flight-companion', 'ship-biscuit'];

  const stripScrolls = (page) =>
    page.locator('.nav-views').evaluate(el => el.scrollWidth > el.clientWidth + 1);

  const countVisible = async (page, views) => {
    let n = 0;
    for (const v of views) if (await nav(page).getView(v).isVisible()) n++;
    return n;
  };

  test('collapses the excess behind ⋯ more at a narrow desktop width, no horizontal scroll', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: WIDE_FLAGS });
    // A narrow DESKTOP width (above the 640px mobile breakpoint) that cannot fit all
    // 14 tabs — so the measuring routine must collapse the excess.
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // The first-class five stay inline.
    for (const view of ['observation', 'swipe', 'swim', 'projects', 'settings']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }

    // The toggle is revealed because something is genuinely hidden…
    const more = page.locator('[data-testid="nav-more-toggle"]');
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    // …and at least one flag-gated view is collapsed out of the inline strip.
    expect(await countVisible(page, FLAG_GATED)).toBeLessThan(FLAG_GATED.length);

    // The core defect is gone: the strip does not horizontally scroll.
    expect(await stripScrolls(page)).toBe(false);

    // Opening `⋯ more` reveals every collapsed view in the in-flow card.
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const view of FLAG_GATED) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
  });

  test('does NOT collapse when the row already fits at a wide desktop width', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Only the 3 power-user flags on → 8 tabs, comfortably fitting a wide desktop.
    await seedLocal(swimLocalSeed, { features: { roadmap: true, dispatch: true, proxy: true } });
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Everything is inline (the over-collapse a pure breakpoint rule would cause is
    // avoided) and the toggle stays hidden.
    for (const view of ['observation', 'swipe', 'swim', 'projects', 'settings', 'roadmap', 'dispatch', 'proxy']) {
      await expect(nav(page).getView(view)).toBeVisible();
    }
    await expect(page.locator('[data-testid="nav-more-toggle"]')).not.toBeVisible();
    expect(await stripScrolls(page)).toBe(false);
  });

  test('keeps the active overflow view inline on desktop (active-hoist invariant)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: WIDE_FLAGS });
    await page.setViewportSize({ width: 800, height: 800 });
    // Dispatch is a flag-gated overflow view — but it is the current page here, so it
    // must be hoisted inline and NEVER hidden inside the collapsed `⋯ more`.
    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`);
    await page.waitForLoadState('networkidle');

    // The strip still collapses (many views) and does not scroll…
    await expect(page.locator('[data-testid="nav-more-toggle"]')).toBeVisible();
    expect(await stripScrolls(page)).toBe(false);
    // …yet the active dispatch tab is visible inline while the card is closed.
    await expect(page.locator('[data-testid="nav-more-toggle"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(nav(page).getView('dispatch')).toBeVisible();
  });
});

// LIN-1149: nav-actions placement — the deliberate order of shared nav-chrome
// actions. Search (projects-only) must precede the queue badge (feature-gated,
// all pages), and the gating rules must not leak one onto the wrong page.
test.describe('nav-actions placement (LIN-1149)', () => {
  test('search toggle precedes queue badge in DOM order on the projects page', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Both search and badge exist in .nav-actions on the projects page.
    const actions = page.locator('.nav-actions');
    await expect(actions.locator('.search-toggle')).toBeAttached();
    await expect(actions.locator('[data-queue-badge]')).toBeAttached();
    // The search toggle renders BEFORE the queue badge in the source order so it
    // is first in DOM and first in visual reading order (LTR).
    const firstChild = actions.locator('> :first-child');
    await expect(firstChild).toHaveClass(/search-toggle/);
  });

  test('queue badge is the sole nav-action on non-projects pages when dispatch is on (no search leak)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
    // The observation page is non-projects — search must NOT leak here.
    await page.goto(`/workspace/${localWorkerUrlKey}/observation`);
    await page.waitForLoadState('networkidle');

    const actions = page.locator('.nav-actions');
    // Queue badge is present (dispatch flag is on).
    await expect(actions.locator('[data-queue-badge]')).toBeAttached();
    // Search toggle must NOT appear on non-projects pages.
    await expect(actions.locator('.search-toggle')).toHaveCount(0);
  });

  test('search toggle is present but queue badge absent on projects when dispatch is off (search is NOT dispatch-gated)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: {} }); // dispatch flag OFF
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const actions = page.locator('.nav-actions');
    // Search toggle is on (projects page, NOT gated on dispatch).
    await expect(actions.locator('.search-toggle')).toBeAttached();
    // Queue badge is absent (dispatch flag is off).
    await expect(actions.locator('[data-queue-badge]')).toHaveCount(0);
  });
});

// LIN-1068: the sticky header must ACTUALLY PIN, and the clearance system that
// only matters when it pins must hold against the real, pinned header. The header
// was inert on `main` because `overflow-x: hidden` on `html`/`body` made an
// ancestor a scroll container and stuck `.nav-bar` to it instead of the viewport;
// the fix is `overflow-x: clip` (clips horizontally without a scroll container).
// Every assertion here would FAIL under the broken pre-fix state — that is the
// point: no prior test locked "the header pins", which is how the regression
// shipped. Height measured at runtime; no pixel value is hardcoded.
test.describe('Sticky header pin + clearance (LIN-1068)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
  });

  for (const width of [390, 1280]) {
    test(`header pins to the viewport top after scroll at ${width}px`, async ({ page, localWorkerUrlKey }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/workspace/${localWorkerUrlKey}/`);
      await page.waitForLoadState('networkidle');

      // Precondition: the page must be tall enough to scroll, else the pin is
      // untestable (a non-scrolling page has an in-flow header at top by default).
      await page.evaluate(() => window.scrollTo(0, 600));
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY, 'page must scroll for the pin assertion to be meaningful').toBeGreaterThan(0);

      // The regression lock: with position:sticky genuinely working the header's
      // top edge is flush with the viewport top (~0) after scrolling. Under the
      // broken overflow-x:hidden state it scrolled away to ~ -scrollY.
      const navTop = await page.locator('.nav-bar').evaluate(el => el.getBoundingClientRect().top);
      expect(Math.abs(navTop)).toBeLessThanOrEqual(1);
    });
  }

  test('pinned header does not intercept content beneath it (LIN-984 re-proven with a real pin)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => window.scrollTo(0, 400));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // 1) Just below the pinned header, the topmost element must be page content,
    //    never the nav — the header sits ABOVE content, it does not overlay it.
    const belowHeaderIsNav = await page.evaluate(() => {
      const nav = document.querySelector('.nav-bar');
      const navRect = nav.getBoundingClientRect();
      const x = Math.round(window.innerWidth / 2);
      const el = document.elementFromPoint(x, Math.ceil(navRect.bottom + 2));
      return nav.contains(el);
    });
    expect(belowHeaderIsNav, 'element just below the header must not belong to the nav').toBe(false);

    // 2) A focusable control scrolled to the top settles BELOW the header thanks to
    //    scroll-margin-top: var(--nav-sticky-h), so it stays clickable rather than
    //    tucked under the pinned nav — the exact interception the clearance guards.
    const settle = await page.evaluate(() => {
      const nav = document.querySelector('.nav-bar');
      const navBottom = nav.getBoundingClientRect().bottom;
      const focusables = [...document.querySelectorAll('a[href], button, summary, [tabindex]')]
        .filter(e => !nav.contains(e) && e.offsetParent !== null);
      const target = focusables.sort((a, b) => b.offsetTop - a.offsetTop)[0];
      if (!target) return null;
      target.scrollIntoView({ block: 'start' });
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2)
      );
      return { top: rect.top, navBottom, clickable: target === hit || target.contains(hit) };
    });
    expect(settle, 'expected at least one focusable page control below the header').not.toBeNull();
    expect(settle.top, 'control must not be tucked under the pinned header').toBeGreaterThanOrEqual(settle.navBottom - 1);
    expect(settle.clickable, 'pinned header must not click-intercept the control').toBe(true);
  });

  test('mobile --nav-sticky-h clearance is at least the measured header height (branch-a guard)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const { clearancePx, headerPx } = await page.evaluate(() => {
      const nav = document.querySelector('.nav-bar');
      // Resolve --nav-sticky-h to px via a throwaway probe sized by the token
      // (inherited from :root), instead of hardcoding 122/124 — the guard tracks
      // real header growth. This is exactly the value that feeds the pinned
      // header's scroll-margin-top clearance.
      const probe = document.createElement('div');
      probe.style.height = 'var(--nav-sticky-h)';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      document.body.appendChild(probe);
      const clearancePx = probe.getBoundingClientRect().height;
      probe.remove();
      return { clearancePx, headerPx: nav.offsetHeight };
    });
    expect(clearancePx).toBeGreaterThan(0); // token actually resolves
    expect(clearancePx).toBeGreaterThanOrEqual(headerPx);
  });
});
