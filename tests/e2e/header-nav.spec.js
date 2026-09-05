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
  test('search toggle precedes queue badge precedes rulings badge in DOM order on the projects page', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    // Search, the queue badge, and the rulings badge (LIN-1728 Phase 3, same
    // `dispatch` gate as the queue badge) all exist in .nav-actions on the
    // projects page.
    const actions = page.locator('.nav-actions');
    await expect(actions.locator('.search-toggle')).toBeAttached();
    await expect(actions.locator('[data-queue-badge]')).toBeAttached();
    await expect(actions.locator('[data-rulings-badge]')).toBeAttached();
    // The search toggle renders BEFORE the queue badge in the source order so it
    // is first in DOM and first in visual reading order (LTR).
    const firstChild = actions.locator('> :first-child');
    await expect(firstChild).toHaveClass(/search-toggle/);
    // The rulings badge trails the queue badge (LIN-1149, extended LIN-1728).
    const lastChild = actions.locator('> :last-child');
    await expect(lastChild).toHaveAttribute('data-rulings-badge', '');
  });

  test('the queue + rulings badges are the sole nav-actions on non-projects pages when dispatch is on (no search leak)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS });
    // The observation page is non-projects — search must NOT leak here.
    await page.goto(`/workspace/${localWorkerUrlKey}/observation`);
    await page.waitForLoadState('networkidle');

    const actions = page.locator('.nav-actions');
    // Both badges are present (dispatch flag is on).
    await expect(actions.locator('[data-queue-badge]')).toBeAttached();
    await expect(actions.locator('[data-rulings-badge]')).toBeAttached();
    // Search toggle must NOT appear on non-projects pages.
    await expect(actions.locator('.search-toggle')).toHaveCount(0);
  });

  test('search toggle is present but both badges absent on projects when dispatch is off (search is NOT dispatch-gated)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: {} }); // dispatch flag OFF
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const actions = page.locator('.nav-actions');
    // Search toggle is on (projects page, NOT gated on dispatch).
    await expect(actions.locator('.search-toggle')).toBeAttached();
    // Both badges are absent (dispatch flag is off) — the rulings badge shares
    // the queue badge's gate, deliberately (LIN-1728 Phase 3).
    await expect(actions.locator('[data-queue-badge]')).toHaveCount(0);
    await expect(actions.locator('[data-rulings-badge]')).toHaveCount(0);
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
});

// LIN-2179: widened coverage for the mobile scrolling-strip fix — the pre-fix
// clearance guard pinned a single 390×700/no-flags fixture, the one combination
// where nothing ever wrapped, which is why the 168px-wrapped-header regression
// shipped unnoticed. This sweeps widths × active view with every experimental +
// power-user flag on, against a fixed workspace name throughout (per the LIN-2179
// design's explicit instruction not to take on the workspace-name axis — the
// projects-page `.nav-primary-row` wrap stays a separate, unproven, out-of-scope
// condition).
test.describe('Mobile nav-strip density sweep (LIN-2179)', () => {
  const ALL_EXPERIMENTAL_FLAGS = {
    roadmap: true, dispatch: true, proxy: true,
    collective: true, taskChat: true, ship: true, nextRun: true,
    flightCompanion: true, passagePlanner: true, shipBiscuit: true,
    liveConsole: true, shipJourney: true
  };
  const MOBILE_SWEEP_WIDTHS = [360, 390, 412, 430];
  // A first-class view (never hoisted — already primary, so it exercises the
  // baseline five-inline-plus-toggle case), the shortest flag-gated label (`ship`,
  // 4 chars — the one view that did NOT wrap pre-fix) and the longest flag-gated
  // label (`passage-planner` — the worst-case hoisted-label width).
  const MOBILE_SWEEP_VIEWS = [
    { pagePath: 'swim', activeKey: 'swim' },
    { pagePath: 'ship', activeKey: 'ship' },
    { pagePath: 'passage-planner', activeKey: 'passage-planner' }
  ];

  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, { features: ALL_EXPERIMENTAL_FLAGS });
  });

  for (const width of MOBILE_SWEEP_WIDTHS) {
    test(`mobile --nav-sticky-h clearance is at least the measured header height at ${width}px (branch-a guard)`, async ({ page, localWorkerUrlKey }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/workspace/${localWorkerUrlKey}/passage-planner`);
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

    for (const { pagePath, activeKey } of MOBILE_SWEEP_VIEWS) {
      test(`view strip is a single non-wrapping row with the active tab reachable at ${width}px (${activeKey})`, async ({ page, localWorkerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/workspace/${localWorkerUrlKey}/${pagePath}`);
        await page.waitForLoadState('networkidle');

        // One row: every primary child of `.nav-views` shares a single top offset —
        // INCLUDING the `⋯ more` toggle itself (LIN-2189 F3): the toggle's own wrap
        // was the reported defect, and a guard that only checks the links passes
        // vacuously on the exact two-row layout the user reported (the links alone
        // always shared row 1; only the toggle dropped to row 2). The closed strip
        // inherits the base non-wrapping row (LIN-2179) so it can no longer wrap
        // onto a second row at any width, for any hoisted label.
        const primaryTops = await page.locator('.nav-views > [data-testid^="nav-view-"], .nav-views > [data-testid="nav-more-toggle"]').evaluateAll(els =>
          els.map(el => el.getBoundingClientRect().top)
        );
        expect(primaryTops.length).toBeGreaterThan(0);
        expect(Math.max(...primaryTops) - Math.min(...primaryTops)).toBeLessThan(4);

        // Active tab reachable: fully inside the strip's visible box and clear of
        // the pinned toggle's own footprint (the scroll-into-view guard, LIN-2179
        // delta 4 — the scrolling row must never hide the active tab).
        const result = await page.evaluate(() => {
          const strip = document.querySelector('.nav-views');
          const active = document.querySelector('.nav-view-current');
          const toggle = document.querySelector('.nav-more-toggle');
          if (!strip || !active) return null;
          const stripRect = strip.getBoundingClientRect();
          const activeRect = active.getBoundingClientRect();
          const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
          const toggleRect = toggleVisible ? toggle.getBoundingClientRect() : null;
          const insideStrip = activeRect.left >= stripRect.left - 1 && activeRect.right <= stripRect.right + 1;
          const clearOfToggle = !toggleRect || activeRect.right <= toggleRect.left + 1 || activeRect.left >= toggleRect.right - 1;
          return { insideStrip, clearOfToggle };
        });
        expect(result, 'expected an active tab to be present').not.toBeNull();
        expect(result.insideStrip, 'active tab must be fully inside the visible strip').toBe(true);
        expect(result.clearOfToggle, 'active tab must not sit under the pinned toggle').toBe(true);
      });

      test(`keyboard focus traversal keeps every focused mobile nav tab visible within the strip at ${width}px (${activeKey}) (LIN-2189 F2)`, async ({ page, localWorkerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/workspace/${localWorkerUrlKey}/${pagePath}`);
        await page.waitForLoadState('networkidle');

        // Focus every primary tab (and the toggle) in strip order, exactly as `Tab`
        // traversal would, and check each stays fully inside the strip's visible
        // box the moment it is focused. Pre-fix this could not happen on mobile
        // (`overflow-x: visible` + wrap clipped nothing horizontally); the strip's
        // new `overflow-x: auto` can leave leading tabs scrolled out of view, and
        // real `Tab` traversal alone does not scroll them back (LIN-2189 F2) — the
        // `focusin` handler in common.js is what restores that guarantee.
        const results = await page.evaluate(() => {
          const strip = document.querySelector('.nav-views');
          // Only genuine `Tab` stops: the active tab renders as a non-link
          // `<strong>` (by design, LIN-978) and is never itself a focus target,
          // so it's excluded here via `tabIndex` rather than the testid pattern.
          const targets = Array.from(strip.querySelectorAll(':scope > [data-testid^="nav-view-"], :scope > [data-testid="nav-more-toggle"]'))
            .filter(t => t.tabIndex >= 0);
          return targets.map(t => {
            t.focus();
            const stripRect = strip.getBoundingClientRect();
            const rect = t.getBoundingClientRect();
            return {
              testid: t.getAttribute('data-testid'),
              focused: document.activeElement === t,
              insideStrip: rect.left >= stripRect.left - 1 && rect.right <= stripRect.right + 1
            };
          });
        });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.focused, `${r.testid} must actually receive focus for this check to be meaningful`).toBe(true);
          expect(r.insideStrip, `focused ${r.testid} must stay inside the visible strip`).toBe(true);
        }
      });
    }

    test(`every nav view target is a comfortable 44px tap target, and the toggle keeps a real width, at ${width}px (LIN-2189 F1)`, async ({ page, localWorkerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${localWorkerUrlKey}/passage-planner`);
      await page.waitForLoadState('networkidle');

      // Height is the tap-target contract for every inline link and the toggle —
      // the toggle's visible CONTENT shrinks to a bare glyph on mobile (LIN-2179),
      // a horizontal-only compaction, so width is not asserted here for the links.
      const heights = await page.locator('.nav-views > [data-testid^="nav-view-"], .nav-more-toggle').evaluateAll(els =>
        els.map(el => el.getBoundingClientRect().height)
      );
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);

      // The toggle's BOX still needs a real horizontal footprint though: collapsing
      // it to the bare glyph's own rendered width (measured as low as ~7px pre-fix)
      // fails WCAG 2.2 SC 2.5.8 Target Size (Minimum), 24×24 CSS px (LIN-2189 F1).
      const toggleWidth = await page.locator('[data-testid="nav-more-toggle"]').evaluate(el => el.getBoundingClientRect().width);
      expect(toggleWidth).toBeGreaterThanOrEqual(24);
    });
  }

  test('toggle accessible name still contains "more" while the label is visually hidden (LIN-2179)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const toggle = page.locator('[data-testid="nav-more-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName(/more/);

    // Visually clipped, not removed — the `⋯` glyph is a bare ~11px-wide target
    // but "more" stays in the accessible-name tree (distinguishes this from
    // `display:none`, which would have stripped it from the computed name above).
    const clipped = await page.locator('.nav-more-label').evaluate(el => {
      const cs = getComputedStyle(el);
      return cs.position === 'absolute' && cs.width === '1px' && cs.height === '1px';
    });
    expect(clipped).toBe(true);
  });
});

// LIN-2210 close-out ledger item 2: `.nav-action.login` (Sign in / GitHub / Jira
// on the landing preview pages' shared nav bar) had no mobile tap target — the
// existing 44px rule above is written against `.nav-item`, which `.nav-action`
// never carries. This targets the unauthenticated `/swipe` preview directly (no
// seedLocal/session needed — it is the landing bar, not a workspace nav), the
// same surface the review measured 18.7px → 44.0px on.
test.describe('Landing preview nav auth tap target (LIN-2210)', () => {
  test('.nav-action.login clears 44px on /swipe at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/swipe');
    await page.waitForLoadState('networkidle');

    const heights = await page.locator('.nav-actions .nav-action.login').evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});

// LIN-2523: `.nav-filters` goes from 2 items (wordmark + workspace) to 3
// (+ team) on the four newly-selectored pages (swipe/swim/ship/roadmap) now
// that they thread real teams/selectedTeamId into renderNavBar. PINNED on the
// Linear test-token session (mirrors tests/e2e/error-handling.spec.js's own
// "Team Filtering" block) — the local provider declares zero teams
// (`fetchTeams` returns `[]`), so `swimLocalSeed`'s session would never
// exercise the data-present branch this sweep is checking. Swept across the
// same mobile widths tests/e2e/header-nav.spec.js's other density sweep uses
// (360/390/412/430) so this rides the same "does the strip actually still
// fit" concern, not just a desktop-only assertion.
test.describe('.nav-filters team-item mobile sweep (LIN-2523)', () => {
  const MOBILE_SWEEP_WIDTHS = [360, 390, 412, 430];
  const NEWLY_SELECTORED_PAGES = ['swipe', 'swim', 'ship', 'roadmap'];
  const FEATURES = encodeURIComponent(JSON.stringify({ roadmap: true, ship: true }));

  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}&features=${FEATURES}`);
    // Reset any team selection persisted for this {account, urlKey} by an
    // earlier spec (LIN-2521's resolveTeamSelection remembers the choice
    // across requests, independent of this test's own session) — an explicit
    // ?team=all clears it (LIN-727), so every test below starts from the
    // genuine "all" default rather than inheriting a stale filter.
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
  });

  for (const width of MOBILE_SWEEP_WIDTHS) {
    for (const pagePath of NEWLY_SELECTORED_PAGES) {
      test(`${pagePath} at ${width}px: .nav-filters carries the team item (3 children, team selector attached)`, async ({ page, workerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/workspace/${workerUrlKey}/${pagePath}`);
        await page.waitForLoadState('networkidle');

        await expect(page.locator('.nav-filters')).toBeVisible();
        const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
        expect(childCount, `${pagePath} at ${width}px must carry brand + workspace + team (3), not just brand + workspace (2)`).toBe(3);

        await expect(page.locator('#team-toggle')).toBeAttached();
        await expect(page.locator('#team-toggle')).toHaveText('all');
      });
    }

    test(`a non-filterable page (dispatch) at ${width}px stays at 2 — the baseline this sweep's "3" is measured against`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/dispatch`);
      await page.waitForLoadState('networkidle');

      const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
      expect(childCount).toBe(2);
      await expect(page.locator('#team-toggle')).toHaveCount(0);
    });
  }

  test('picking a team marks the selection and keeps the count at 3, on each newly-selectored page', async ({ page, workerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const pagePath of NEWLY_SELECTORED_PAGES) {
      await page.goto(`/workspace/${workerUrlKey}/${pagePath}?team=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`);
      await page.waitForLoadState('networkidle');

      const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
      expect(childCount, pagePath).toBe(3);
      await expect(page.locator('#team-toggle'), pagePath).toHaveText('Engineering');
    }
  });
});

// LIN-2529: `.nav-filters` goes from 3 items (wordmark + workspace + team) to
// 4 (+ assignee) on the DASHBOARD ONLY, now that renderPage threads
// availableAssignees/selectedAssignee/canFilterByMe into renderNavBar
// (LIN-2526 computed the values; LIN-2527 built the navbar functions; this is
// the first point real data actually reaches them). PINNED on the Linear
// test-token session — same reasoning as the LIN-2523 sweep above: testMockData
// carries real assignee names (Alice/Bob/Charlie), so the dashboard-only
// data-present branch this sweep checks is actually exercised. Swept across
// the same mobile widths as the density sweeps above, plus a same-width
// regression guard that /swim (team-reached, NOT assignee-reached) stays at 3
// — proving the dashboard-only boundary holds under the same viewport.
test.describe('.nav-filters assignee-item mobile sweep (LIN-2529)', () => {
  const MOBILE_SWEEP_WIDTHS = [360, 390, 412, 430];

  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    // Reset any team selection persisted by an earlier spec (same reasoning as
    // the LIN-2523 block above — resolveTeamSelection remembers choices across
    // requests independent of this test's own session).
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
  });

  for (const width of MOBILE_SWEEP_WIDTHS) {
    // The wrap question this sweep deliberately left open (LIN-2527 AC5's "no
    // .nav-primary-row wrap" assertion) is now CLOSED by the LIN-2551 block
    // at the bottom of this file, which measures the strip rather than
    // counting it. This sweep keeps asserting item COUNT — a distinct
    // property (the assignee item is PRESENT on the dashboard and absent
    // elsewhere), which a wrap measurement does not cover.
    test(`dashboard at ${width}px: .nav-filters carries the assignee item (4 children)`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.nav-filters')).toBeVisible();
      const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
      expect(childCount, `dashboard at ${width}px must carry brand + workspace + team + assignee (4)`).toBe(4);

      await expect(page.locator('#assignee-toggle')).toBeAttached();
      await expect(page.locator('#assignee-toggle')).toHaveText('all');
    });

    test(`/swim at ${width}px stays at 3 — assignee must not leak onto a team-reached, non-dashboard page`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/swim`);
      await page.waitForLoadState('networkidle');

      const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
      expect(childCount).toBe(3);
      await expect(page.locator('#assignee-toggle')).toHaveCount(0);
    });
  }

  test('picking an assignee marks the selection and keeps the count at 4', async ({ page, workerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${workerUrlKey}/?assignee=Alice`);
    await page.waitForLoadState('networkidle');

    const childCount = await page.locator('.nav-filters').evaluate(el => el.children.length);
    expect(childCount).toBe(4);
    await expect(page.locator('#assignee-toggle')).toHaveText('Alice');
  });
});

// LIN-2551 — the mobile density budget, measured rather than counted.
//
// This discharges LIN-2516 ledger item L4. The LIN-2529 sweep above asserts
// `.nav-filters` CHILD COUNTS at these widths and never wrap-freedom, which is
// exactly why CI stayed green while the strip rendered three rows deep on
// every phone-sized viewport: a count of 4 is satisfied whether those four
// items sit on one row or four. What is asserted here is the property the
// count cannot see — the strip occupies a SINGLE row. `.nav-filters` is a
// wrapping flex container, so its rendered height is the direct witness: one
// row of 44px-min-height items, against the 94-101px (three rows) it measured
// before the budget fix.
//
// SCOPE, stated precisely so it is not read as more than it is: this pins
// `.nav-filters`. It does NOT pin `.nav-primary-row`, which still puts
// `.nav-actions` (the search toggle) on its own line at narrow widths — that
// is pre-existing behaviour, unchanged by LIN-2551, so LIN-2527 AC5's broader
// "no `.nav-primary-row` wrap" question stays open.
//
// EVERY FILTER STATE IS SWEPT, and that is the load-bearing part. A budget
// tuned against the default `all`/`all` fits and then overflows the moment a
// real value replaces either one — measured, not theorised: an earlier
// revision of this fix passed at all four widths with `all`/`all` while still
// rendering three rows at 412px and 430px with a team selected. Sweeping only
// the default state is how a sweep passes over the very bug it exists for.

// The Engineering team from tests/fixtures/mock-data.js — the ID, not the
// name: `?team=` resolves through matchTeamId, and a bare name silently
// degrades to unfiltered, which would quietly hand a "team selected" test the
// `all` state it was written to avoid.
const TEST_TEAM_ENGINEERING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const DENSITY_FILTER_STATES = [
  { label: 'no filters', team: 'all', assignee: 'all' },
  { label: 'assignee only', team: 'all', assignee: 'Charlie' },
  { label: 'team only', team: TEST_TEAM_ENGINEERING_ID, assignee: 'all' },
  { label: 'team + assignee (worst case)', team: TEST_TEAM_ENGINEERING_ID, assignee: 'Charlie' }
];

// The four LIN-2529 sweep widths, plus 375px — between two of them, guarding
// the assumption that passing at 360 and 390 implies passing in between — and
// 480px, the top of the phone budget's own media query.
const DENSITY_SWEEP_WIDTHS = [360, 375, 390, 412, 430, 480];

// One row of `.nav-item`s, whose mobile `min-height` is 44px (the tap-target
// rule above). The allowance over 44 absorbs line-height and baseline-
// alignment jitter without being loose enough to admit a second row, which
// lands near 88px and which the pre-fix three-row state measured at 94-101px.
const SINGLE_ROW_MAX_HEIGHT = 60;

function densityUrl(urlKey, state) {
  return `/workspace/${urlKey}/?team=${encodeURIComponent(state.team)}&assignee=${encodeURIComponent(state.assignee)}`;
}

test.describe('.nav-filters mobile density budget (LIN-2551)', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
  });

  for (const width of DENSITY_SWEEP_WIDTHS) {
    for (const state of DENSITY_FILTER_STATES) {
      test(`dashboard at ${width}px, ${state.label}: the 4-item filter strip does not wrap`, async ({ page, workerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(densityUrl(workerUrlKey, state));
        await page.waitForLoadState('networkidle');

        const filters = page.locator('.nav-filters');
        await expect(filters).toBeVisible();
        // Still 4 DOM children at every width — at phone widths the brand is
        // hidden with `display: none` rather than removed, so this block and
        // the LIN-2529 count sweep above agree about the strip's composition.
        expect(await filters.evaluate(el => el.children.length)).toBe(4);

        const height = await filters.evaluate(el => Math.round(el.getBoundingClientRect().height));
        expect(height, `.nav-filters must render as ONE row at ${width}px with ${state.label} — measured ${height}px against a ${SINGLE_ROW_MAX_HEIGHT}px single-row bound`).toBeLessThanOrEqual(SINGLE_ROW_MAX_HEIGHT);
      });
    }

    test(`dashboard at ${width}px: no filter control is pushed off-viewport`, async ({ page, workerUrlKey }) => {
      // The other half of "it fits", and a regression pin rather than a
      // witness for this ticket's own bug: a strip forced onto one row by
      // shrinking can push its last item past the viewport edge, where the
      // root's `overflow-x: clip` makes it unreachable with no horizontal
      // scrollbar to reveal it. A `nowrap` revision of this fix did exactly
      // that. It is a worse outcome than the wrap it would have replaced, so
      // it is pinned even though it passes against `main` too.
      await page.setViewportSize({ width, height: 800 });
      await page.goto(densityUrl(workerUrlKey, DENSITY_FILTER_STATES[3]));
      await page.waitForLoadState('networkidle');

      const offscreen = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.nav-filters .nav-value')]
          .filter(c => c.getBoundingClientRect().right > viewport + 1)
          .map(c => `${c.id || c.className}@${Math.round(c.getBoundingClientRect().right)}`);
      });
      expect(offscreen, `every filter control must sit inside the ${width}px viewport`).toEqual([]);
    });
  }

  test('the strip still shows what it is showing — values are not crushed away to fit', async ({ page, workerUrlKey }) => {
    // The guard against "passing" the assertions above by shrinking every
    // value to nothing. A `nowrap` revision of this fix did exactly that —
    // team and assignee values rendered 0px and 4px wide at 360px — and would
    // have satisfied both a height and an off-viewport check.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(densityUrl(workerUrlKey, DENSITY_FILTER_STATES[3]));
    await page.waitForLoadState('networkidle');

    const values = await page.evaluate(() =>
      [...document.querySelectorAll('.nav-filters .nav-value')].map(v => ({
        text: v.textContent.trim(),
        width: Math.round(v.getBoundingClientRect().width),
        truncated: v.scrollWidth > v.clientWidth + 1
      }))
    );

    expect(values.length).toBe(3);

    // The distinction this test exists to draw: a value TRUNCATED by the `ch`
    // cap still renders a readable span with an ellipsis, and its full text is
    // a tap away in the dropdown. A value CRUSHED by flex shrink renders a few
    // pixels of nothing. The `nowrap` revision produced 0px and 4px here; the
    // shipped budget produces ~39-59px. The bound sits between the two, so it
    // fails on a squeeze and passes on an honest cap.
    const LEGIBLE_MIN_PX = 30;
    for (const v of values) {
      expect(v.width, `"${v.text}" must still render legibly, not be shrunk to nothing`).toBeGreaterThanOrEqual(LEGIBLE_MIN_PX);
    }

    // And it must be the real selected values under test, not the defaults —
    // `?team=` resolves by id, and a value that silently degraded to `all`
    // would render ~12px and quietly measure the wrong thing.
    const [, team, assignee] = values;
    expect(team.text, 'the selected team must be the value under test, not the `all` default').toBe('Engineering');
    expect(assignee.text, 'the selected assignee must be the value under test').toBe('Charlie');
    expect(assignee.truncated, 'a short real assignee name should sit under the cap, not at it').toBe(false);
  });

  test('320px — below the swept range, the strip degrades by wrapping rather than by clipping', async ({ page, workerUrlKey }) => {
    // 320px is narrower than any width this ticket covers, and it is where the
    // budget genuinely runs out with a team selected. Recorded honestly rather
    // than asserted away: `flex-wrap` is KEPT precisely so this width degrades
    // to a second row instead of pushing a control out of reach. Still an
    // improvement on `main`, which rendered three rows here.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(densityUrl(workerUrlKey, DENSITY_FILTER_STATES[3]));
    await page.waitForLoadState('networkidle');

    const { height, offscreen } = await page.evaluate(() => {
      const el = document.querySelector('.nav-filters');
      const viewport = document.documentElement.clientWidth;
      return {
        height: Math.round(el.getBoundingClientRect().height),
        offscreen: [...el.querySelectorAll('.nav-value')].filter(c => c.getBoundingClientRect().right > viewport + 1).length
      };
    });

    expect(height, 'at 320px the strip may take a second row, but never a third').toBeLessThanOrEqual(2 * SINGLE_ROW_MAX_HEIGHT);
    expect(offscreen, 'wrapping is the degradation; clipping a control is not').toBe(0);
  });
});
