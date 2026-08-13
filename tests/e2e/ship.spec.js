import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed, shipBacklogLocalSeed } from '../fixtures/local-harness.js';

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

  // LIN-1208: backlog cards hidden from the orbit by default, with a control
  // to show them again. swimLocalSeed carries 8 started / 7 unstarted / 4
  // backlog cards across its 4 mixed projects (none of its backlog cards
  // block or parent anything, so none are exempt) — the baseline this and the
  // toggle test below assert against.
  test('backlog cards are hidden from the orbit by default; segment labels are unaffected', async ({ page }) => {
    await expect(page.locator('#ship-orbit .swim-box.state-backlog')).toHaveCount(0);
    // The 4 mixed projects each keep at least one non-backlog card, so all 4
    // segment labels still render (ship.spec.js:83's existing assertion).
    const labels = await page.locator('.ship-sector-label').allTextContents();
    expect(labels.sort()).toEqual([
      'API v2',
      'Authentication Overhaul',
      'Dashboard Redesign',
      'Infrastructure'
    ]);
    // Every unstarted card and the ship rect's started cards are unaffected.
    await expect(page.locator('#ship-orbit .swim-box.state-unstarted')).toHaveCount(7);
    await expect(page.locator('#ship-rect-cards .swim-box')).toHaveCount(8);
  });

  test('the backlog control toggles visibility and persists across reload', async ({ page }) => {
    const toggle = page.locator('#ship-backlog-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveText(/hidden/i);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveText(/shown/i);
    // Counts return to today's (pre-LIN-1208) baseline: all 4 backlog cards
    // plus the 7 unstarted cards, 11 orbit cards from these two states alone.
    await expect(page.locator('#ship-orbit .swim-box.state-backlog')).toHaveCount(4);
    await expect(page.locator('#ship-orbit .swim-box.state-unstarted')).toHaveCount(7);

    // Persists across reload (ship-settings localStorage, like heading/mode).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#ship-backlog-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ship-orbit .swim-box.state-backlog')).toHaveCount(4);

    // Toggling back off restores the default-hidden state.
    await page.locator('#ship-backlog-toggle').click();
    await expect(page.locator('#ship-orbit .swim-box.state-backlog')).toHaveCount(0);
  });

  // LIN-1208 review F1: the two fixed controls share one top band, and side by
  // side they only clear each other above ~381px. Below that the backlog
  // control overlapped the mode control and took the ORIENTATION button's
  // clicks — invisible to CI, whose narrowest existing viewport is 390px. Pin
  // both the geometry and the hit test at the two widths that regressed.
  for (const width of [375, 360, 320]) {
    test(`backlog and mode controls never overlap at ${width}px (F1)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await page.waitForLoadState('networkidle');

      const geom = await page.evaluate(() => {
        const modeEl = document.querySelector('.ship-mode-control');
        const backlogEl = document.querySelector('.ship-backlog-control');
        const mode = modeEl.getBoundingClientRect();
        const backlog = backlogEl.getBoundingClientRect();
        // Who actually receives a click near the right end of the mode
        // control — the strip the backlog control used to cover.
        const hit = document.elementFromPoint(mode.left + mode.width * 0.95, mode.top + mode.height / 2);
        return {
          overlaps: mode.right > backlog.left && mode.left < backlog.right &&
                    mode.bottom > backlog.top && mode.top < backlog.bottom,
          modeOwnsHit: !!(hit && modeEl.contains(hit)),
          backlogOnCanvas: backlog.left >= 0 && backlog.right <= window.innerWidth
        };
      });
      expect(geom.overlaps).toBe(false);
      expect(geom.modeOwnsHit).toBe(true);
      expect(geom.backlogOnCanvas).toBe(true);

      // And the stacked control is still a working toggle at this width.
      await page.locator('#ship-backlog-toggle').click();
      await expect(page.locator('#ship-backlog-toggle')).toHaveAttribute('aria-pressed', 'true');
    });
  }
});

// LIN-1208: blocker/parent exemption + the drained-project cleanup, on a
// dedicated minimal seed — swimLocalSeed's backlog cards block/parent
// nothing, so the exemption is untestable against it (per LIN-1208 research).
test.describe('Ship Page — backlog visibility exemption (LIN-1208)', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(shipBacklogLocalSeed(localWorkerUrlKey), { features: { ship: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/ship`);
    await page.waitForLoadState('networkidle');
  });

  test('a backlog card blocking in-progress work stays visible with the toggle off', async ({ page }) => {
    // Mixed project: SHIP-2 (unstarted) + SHIP-4 (exempt backlog blocker)
    // survive; SHIP-3 (plain backlog) is hidden. Dormant project (all
    // plain backlog, no exemption) is dropped entirely.
    const backlogCards = page.locator('#ship-orbit .swim-box.state-backlog');
    await expect(backlogCards).toHaveCount(1);
    await expect(backlogCards.first()).toContainText('SHIP-4');

    const labels = await page.locator('.ship-sector-label').allTextContents();
    expect(labels).toContain('Mixed');
    expect(labels).not.toContain('Dormant');
  });

  test('toggling the control on restores the plain backlog card and the drained project', async ({ page }) => {
    await page.locator('#ship-backlog-toggle').click();
    // All 4 backlog cards (plain + exempt blocker + the 2 dormant ones) return.
    await expect(page.locator('#ship-orbit .swim-box.state-backlog')).toHaveCount(4);
    const labels = await page.locator('.ship-sector-label').allTextContents();
    expect(labels).toContain('Dormant');
  });
});

// LIN-1208: an all-backlog workspace with the filter on must render an empty
// orbit safely — no collapsed canvas, no crash.
test.describe('Ship Page — all-backlog workspace (LIN-1208)', () => {
  test('renders an empty, non-degenerate orbit', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const seed = shipBacklogLocalSeed(localWorkerUrlKey);
    // Drop everything but the plain backlog cards (no started/unstarted/exempt
    // cards at all) so the whole orbit — and the ship rect — is empty.
    seed.issues = seed.issues.filter(i => i.identifier === 'SHIP-3' || i.identifier === 'SHIP-5' || i.identifier === 'SHIP-6');
    await seedLocal(seed, { features: { ship: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/ship`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#ship-orbit .swim-box')).toHaveCount(0);
    await expect(page.locator('.ship-sector-label')).toHaveCount(0);
    // The ship rect's own empty state still renders, unrelated to the orbit.
    await expect(page.locator('.ship-rect-empty')).toBeVisible();
    // The canvas itself is still sized sanely (not collapsed to 0).
    const canvasSize = await page.locator('#ship-canvas').evaluate(n => ({
      w: n.offsetWidth, h: n.offsetHeight
    }));
    expect(canvasSize.w).toBeGreaterThan(100);
    expect(canvasSize.h).toBeGreaterThan(100);
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
