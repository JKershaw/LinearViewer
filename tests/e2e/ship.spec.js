import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed } from '../fixtures/local-harness.js';

// LIN-378: the ship surface is fully modeled by the local provider, so this spec
// rides a seeded local workspace (no `test-token` mock). The seed is the swim
// sample fixture converted to local shape — same projects, blocking chains, and
// labels the assertions below were written against.

test.describe('Ship Page', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed(localWorkerUrlKey), { features: { ship: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/ship`);
    await page.waitForLoadState('networkidle');
  });

  test('renders the ship rectangle at the centre', async ({ page }) => {
    const ship = page.locator('#ship-rect');
    await expect(ship).toBeVisible();
    // Measure the rect's LAYOUT footprint (offsetWidth/Height), which ignores
    // the canvas zoom transform — the first-paint fit (LIN-1221 F1) scales the
    // whole canvas down, so boundingBox would report the shrunk visual size.
    const size = await ship.evaluate(n => ({ w: n.offsetWidth, h: n.offsetHeight }));
    expect(size.w).toBeGreaterThan(100);
    expect(size.h).toBeGreaterThan(50);
  });

  test('in-progress items are placed inside the ship', async ({ page }) => {
    const inShip = page.locator('#ship-rect-cards .swim-box');
    await expect(inShip.first()).toBeVisible();
    const count = await inShip.count();
    expect(count).toBeGreaterThan(0);
  });

  test('orbit cards are rendered outside the ship', async ({ page }) => {
    const orbit = page.locator('#ship-orbit .swim-box');
    await expect(orbit.first()).toBeVisible();
    const count = await orbit.count();
    expect(count).toBeGreaterThan(0);
  });

  test('each orbit card carries a data-sector attribute', async ({ page }) => {
    const orbit = page.locator('#ship-orbit .swim-box');
    const sectors = await orbit.evaluateAll(nodes =>
      nodes.map(n => n.getAttribute('data-sector'))
    );
    expect(sectors.length).toBeGreaterThan(0);
    const allowed = new Set(['forward', 'starboard', 'aft', 'port', 'drift']);
    for (const s of sectors) {
      expect(allowed.has(s)).toBeTruthy();
    }
  });

  test('clicking a card opens the popover', async ({ page }) => {
    const card = page.locator('#ship-orbit .swim-box').first();
    await card.click();
    const pop = page.locator('#ship-popover');
    await expect(pop).not.toHaveClass(/hidden/);
    await expect(page.locator('#ship-popover-title')).not.toBeEmpty();
  });

  test('popover close button hides it', async ({ page }) => {
    await page.locator('#ship-orbit .swim-box').first().click();
    const pop = page.locator('#ship-popover');
    await expect(pop).not.toHaveClass(/hidden/);
    await page.locator('#ship-popover-close').click();
    await expect(pop).toHaveClass(/hidden/);
  });

  test('segment labels show project names', async ({ page }) => {
    await expect(page.locator('.ship-sector-guide')).toBeAttached();
    const labels = await page.locator('.ship-sector-label').allTextContents();
    // Swim sample has 4 projects; their non-started cards produce 4 segments.
    // BUGS label would only appear if any bug-labelled item is non-started
    // (DASH-3 is bug-labelled but in-progress, so it goes to the ship).
    expect(labels.sort()).toEqual([
      'API v2',
      'Authentication Overhaul',
      'Dashboard Redesign',
      'Infrastructure'
    ]);
  });

  test('heading chip shows "pick a heading" when none is set', async ({ page }) => {
    const chipText = page.locator('#ship-heading-chip-text');
    await expect(chipText).toHaveText(/pick a heading/i);
    await expect(page.locator('#ship-heading-chip')).toHaveAttribute('data-state', 'empty');
    // No forward segment in the default state.
    const fwd = page.locator('#ship-orbit .swim-box[data-sector="forward"]');
    await expect(fwd).toHaveCount(0);
  });

  test('picker opens on chip click and lists projects + labels', async ({ page }) => {
    const picker = page.locator('#ship-heading-picker');
    await expect(picker).toHaveClass(/hidden/);
    await page.locator('#ship-heading-chip').click();
    await expect(picker).not.toHaveClass(/hidden/);
    const projectOptions = await page.locator('#ship-heading-project option').allTextContents();
    expect(projectOptions.length).toBeGreaterThan(1); // — none — + at least one project
    expect(projectOptions).toContain('Authentication Overhaul');
  });

  test('choosing a project sets the heading and routes its cards forward', async ({ page }) => {
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-project').selectOption('Authentication Overhaul');
    // Picker closes on selection.
    await expect(page.locator('#ship-heading-picker')).toHaveClass(/hidden/);
    // Chip shows the heading name.
    await expect(page.locator('#ship-heading-chip-text')).toHaveText('Authentication Overhaul');
    await expect(page.locator('#ship-heading-chip')).toHaveAttribute('data-state', 'set');
    // Forward segment now exists and holds the project's cards.
    const fwd = page.locator('#ship-orbit .swim-box[data-sector="forward"]');
    await expect(fwd.first()).toBeVisible();
    expect(await fwd.count()).toBeGreaterThan(0);
    // The forward segment intentionally has NO segment-horizon label — the
    // heading chip up high owns that role, giving forward its chart-annotation
    // status (rather than reading as just another segment).
    await expect(page.locator('.ship-sector-label[data-segment^="heading:"]'))
      .toHaveCount(0);
    // And the project no longer appears among the port/starboard segments.
    const projectLabels = await page
      .locator('.ship-sector-label[data-segment^="project:"]')
      .allTextContents();
    expect(projectLabels).not.toContain('Authentication Overhaul');
  });

  test('clear heading restores the empty state', async ({ page }) => {
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-project').selectOption('Authentication Overhaul');
    await expect(page.locator('#ship-heading-chip-text')).toHaveText('Authentication Overhaul');
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-clear').click();
    await expect(page.locator('#ship-heading-chip-text')).toHaveText(/pick a heading/i);
    await expect(page.locator('#ship-orbit .swim-box[data-sector="forward"]')).toHaveCount(0);
  });

  // LIN-535 / LIN-1221 F1: zoom, pan, overlap recovery, a swipe link — and the
  // new fit contract. Reset returns to the first-paint FIT (not a hardcoded
  // 100%): on a phone 100% re-clips the graph the fit was there to reveal.
  test('zoom controls scale the canvas and reset returns to fit', async ({ page }) => {
    const canvas = page.locator('#ship-canvas');
    // The transform now carries a centring translate before the scale; read the
    // scale factor out of it.
    const scaleOf = async () => {
      const t = await canvas.evaluate(n => n.style.transform);
      const m = t.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    };

    // First paint applies a fit zoom (≤ 1) so the whole graph is visible.
    const fit = await scaleOf();
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThanOrEqual(1);
    const fitLabel = await page.locator('#ship-zoom-reset').textContent();

    await page.locator('#ship-zoom-in').click();
    const scaleIn = await scaleOf();
    expect(scaleIn).toBeGreaterThan(fit);

    await page.locator('#ship-zoom-out').click();
    await page.locator('#ship-zoom-out').click();
    expect(await scaleOf()).toBeLessThan(scaleIn);

    await page.locator('#ship-zoom-reset').click();
    // Reset returns to the exact first-paint fit, label and all.
    expect(await scaleOf()).toBeCloseTo(fit, 5);
    await expect(page.locator('#ship-zoom-reset')).toHaveText(fitLabel);
  });

  // LIN-1221 F1: on a 390px phone the whole graph must be visible on first paint
  // — no orbit card clipped off-canvas (the old default-100% "empty void" bug).
  test('mobile 390 first paint fits the graph on-canvas (F1)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Fit zoomed out below 100% to make room.
    const scale = await page.locator('#ship-canvas').evaluate(n => {
      const m = n.style.transform.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    expect(scale).toBeLessThan(1);

    // Every orbit card sits within the viewport horizontally (the binding axis
    // on a tall-narrow phone). A few px tolerance for sub-pixel rounding.
    const clip = await page.evaluate(() => {
      const W = window.innerWidth, H = window.innerHeight;
      const cards = [...document.querySelectorAll('#ship-orbit .swim-box')];
      let offX = 0;
      for (const c of cards) {
        const b = c.getBoundingClientRect();
        if (b.left < -2 || b.right > W + 2) offX++;
      }
      return { count: cards.length, offX, W, H };
    });
    expect(clip.count).toBeGreaterThan(0);
    expect(clip.offX).toBe(0);
  });

  // LIN-1221 F2 / LIN-984 non-regression: on desktop the fixed mode toggle must
  // sit clear of the (normal-flow) shared nav and stay clickable — the nav must
  // not overlay and intercept it.
  test('desktop mode toggle clears the nav and stays clickable (F2 / LIN-984)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const geom = await page.evaluate(() => {
      const nav = document.querySelector('.nav-bar').getBoundingClientRect();
      const ctl = document.querySelector('.ship-mode-control').getBoundingClientRect();
      // What actually receives a click at the toggle's centre?
      const cx = ctl.left + ctl.width / 2;
      const cy = ctl.top + ctl.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const ctlEl = document.querySelector('.ship-mode-control');
      return {
        navBottom: nav.bottom,
        ctlTop: ctl.top,
        interceptedByNav: !!(hit && hit.closest('.nav-bar')),
        toggleOwnsHit: !!(hit && ctlEl.contains(hit))
      };
    });
    // The toggle sits entirely below the nav (no vertical overlap).
    expect(geom.ctlTop).toBeGreaterThanOrEqual(geom.navBottom);
    // And nothing from the nav overlays the toggle's hit point.
    expect(geom.interceptedByNav).toBe(false);
    expect(geom.toggleOwnsHit).toBe(true);

    // It genuinely responds to a click (project mode stays active, unintercepted).
    await page.locator('#ship-mode-project').click();
    await expect(page.locator('#ship-mode-project')).toHaveClass(/active/);
  });

  test('drag in empty space pans the canvas', async ({ page }) => {
    const pageEl = page.locator('.ship-page');
    // At first-paint FIT (LIN-1221 F1) the whole graph fits the viewport, so
    // there is no scroll room to pan. Zoom in past fit first so the canvas
    // overflows and dragging has somewhere to go.
    for (let i = 0; i < 6; i++) await page.locator('#ship-zoom-in').click();

    // Pick a drag origin over empty canvas — NOT on a card or a fixed control
    // (the mode toggle now sits top-left, the zoom control bottom-left; LIN-1221
    // F2). Scan a few control-free candidate points for bare canvas.
    const origin = await page.evaluate(() => {
      const r = document.querySelector('.ship-page').getBoundingClientRect();
      const IGNORE = '.swim-box, .ship-heading-control, .ship-mode-control, .ship-zoom-control, .swim-popover';
      const candidates = [
        [r.right - 24, r.top + 24],
        [r.right - 24, r.bottom - 24],
        [r.right - 24, r.top + r.height / 2],
        [r.left + r.width / 2, r.top + 24]
      ];
      for (const [x, y] of candidates) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest(IGNORE)) return { x, y };
      }
      return { x: r.right - 24, y: r.top + 24 };
    });

    const before = await pageEl.evaluate(n => n.scrollLeft);
    // Drag leftward → the pan handler increases scrollLeft.
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x - 140, origin.y - 60, { steps: 8 });
    await page.mouse.up();
    const after = await pageEl.evaluate(n => n.scrollLeft);
    expect(after).toBeGreaterThan(before);
  });

  test('opening a card lifts it above its neighbours (overlap recovery)', async ({ page }) => {
    const card = page.locator('#ship-orbit .swim-box').first();
    await expect(card).not.toHaveClass(/ship-active/);
    await card.click();
    await expect(card).toHaveClass(/ship-active/);
    const z = await card.evaluate(n => getComputedStyle(n).zIndex);
    expect(Number(z)).toBeGreaterThan(3);
    // Closing releases the lift so no card stays permanently raised.
    await page.locator('#ship-popover-close').click();
    await expect(card).not.toHaveClass(/ship-active/);
  });

  test('popover offers a swipe link alongside the Linear link', async ({ page, localWorkerUrlKey }) => {
    await page.locator('#ship-orbit .swim-box').first().click();
    const swipe = page.locator('#ship-popover-swipe');
    await expect(swipe).toBeVisible();
    const href = await swipe.getAttribute('href');
    expect(href).toMatch(
      new RegExp(`/workspace/${localWorkerUrlKey}/swipe/[A-Za-z0-9-]+`)
    );
    // The Linear link is still present — the swipe link is additive.
    await expect(page.locator('#ship-popover-link')).toBeVisible();
  });

  test('swipe link navigates to the task in the swipe view', async ({ page, localWorkerUrlKey }) => {
    await page.locator('#ship-orbit .swim-box').first().click();
    const href = await page.locator('#ship-popover-swipe').getAttribute('href');
    await page.goto(href);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/swipe/`));
  });

  test('layout is deterministic across reloads', async ({ page }) => {
    const positions1 = await page.locator('#ship-orbit .swim-box').evaluateAll(
      nodes => nodes.map(n => ({
        id: n.getAttribute('data-issue-id'),
        left: n.style.left,
        top: n.style.top
      }))
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    const positions2 = await page.locator('#ship-orbit .swim-box').evaluateAll(
      nodes => nodes.map(n => ({
        id: n.getAttribute('data-issue-id'),
        left: n.style.left,
        top: n.style.top
      }))
    );
    expect(positions2).toEqual(positions1);
  });
});

// LIN-496: ship is an experimental, in-development view surfaced via Settings.
// With its flag off it must redirect to settings (mirrors collective), not render.
test.describe('Ship Page — gating (LIN-496)', () => {
  test('redirects to settings when the ship flag is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed(localWorkerUrlKey)); // no ship flag
    await page.goto(`/workspace/${localWorkerUrlKey}/ship`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/workspace/${localWorkerUrlKey}/settings$`));
    await expect(page.locator('#ship-rect')).toHaveCount(0);
  });
});
