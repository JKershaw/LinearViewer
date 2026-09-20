import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// Ship Journey (experimental, shipJourney flag, LIN-1675 P3): an animated
// replay of waypoints — completed tasks scored against a north star in a
// saved roadmap report — charted over the workspace's retained report
// history. No LLM call on page load: this exercises the real
// listFull()/fetchWorkspaceIssues/deriveJourney consumer wiring end to end
// against a genuine local-provider workspace (LIN-378), seeded via the new
// test-only `/test/seed-report-history` route (routes/test.js) so multiple
// runs with controlled `generatedAt`/`northStar` can be written directly.

function journeySeed(urlKey) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  return {
    projects: [{ id: id('sj-proj-1'), name: 'Journey Project', content: '', sortOrder: 1 }],
    issues: [
      {
        id: id('sj-issue-1'), identifier: 'LOCAL-1', title: 'First waypoint', description: '',
        projectId: id('sj-proj-1'), sortOrder: 1, state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-02T00:00:00Z', url: `/workspace/${urlKey}/issue/${id('sj-issue-1')}`,
      },
      {
        id: id('sj-issue-2'), identifier: 'LOCAL-2', title: 'Second waypoint', description: '',
        projectId: id('sj-proj-1'), sortOrder: 2, state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-06T00:00:00Z', url: `/workspace/${urlKey}/issue/${id('sj-issue-2')}`,
      },
      {
        id: id('sj-issue-3'), identifier: 'LOCAL-3', title: 'Third waypoint', description: '',
        projectId: id('sj-proj-1'), sortOrder: 3, state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-11T00:00:00Z', url: `/workspace/${urlKey}/issue/${id('sj-issue-3')}`,
      },
    ],
  };
}

/**
 * A many-waypoint seed plus its matching orientation entries (LIN-2089).
 *
 * `bearingAt(i)` picks each waypoint's bearing, which is what decides the
 * trail's EXTENT: cycling bearings turns the walk back on itself (a compact
 * rosette), a single bearing spans one unit per waypoint. Callers slice the
 * returned `orientation` across several reports to place north-star changes.
 *
 * completedAt is `2026-<month>-<day>`, one waypoint per day from 2026-01-01,
 * so a report's generatedAt can be placed between any two of them.
 */
function walkFixture(urlKey, count, bearingAt) {
  const id = (rawId) => localSeedId(urlKey, rawId);
  const issues = [];
  const orientation = [];
  for (let i = 0; i < count; i++) {
    const identifier = `LOCAL-${i + 1}`;
    const month = String(Math.floor(i / 27) + 1).padStart(2, '0');
    const day = String((i % 27) + 1).padStart(2, '0');
    issues.push({
      id: id(`sj-issue-${i + 1}`), identifier, title: `Waypoint ${i + 1}`, description: '',
      projectId: id('sj-proj-1'), sortOrder: i + 1, state: { name: 'Done', type: 'completed' },
      completedAt: `2026-${month}-${day}T00:00:00Z`,
      url: `/workspace/${urlKey}/issue/${id(`sj-issue-${i + 1}`)}`,
    });
    orientation.push({ identifier, bearing: bearingAt(i), reason: 'r', archived: false });
  }
  return {
    seed: {
      projects: [{ id: id('sj-proj-1'), name: 'Journey Project', content: '', sortOrder: 1 }],
      issues,
    },
    orientation,
  };
}

async function seedReports(page, urlKey, records) {
  const resp = await page.request.post(`/test/seed-report-history?urlKey=${urlKey}`, { data: { records } });
  expect(resp.ok(), `seed-report-history failed: ${await resp.text()}`).toBeTruthy();
}

test.describe('Ship Journey (LIN-1675 P3)', () => {
  // localWorkerUrlKey is worker-scoped (reused across every test in this file),
  // but report history is durable per-workspace state — clear it first so one
  // test's seeded runs never leak waypoints into the next.
  test.beforeEach(async ({ page, localWorkerUrlKey }) => {
    await page.request.get(`/test/clear-report-history?urlKey=${localWorkerUrlKey}`);
  });

  test('below the 2-waypoint threshold, the honest thin-data empty state renders — no map, no controls', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(journeySeed(localWorkerUrlKey), { features: { shipJourney: true } });
    await seedReports(page, localWorkerUrlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-1', bearing: 'N', reason: 'r', archived: false }] },
    ]);

    await page.goto(`/workspace/${localWorkerUrlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="ship-journey-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="ship-journey-controls"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ship-journey-map"]')).toHaveCount(0);
  });

  test('with three retained runs across a north-star change, waypoints render, the coverage figure shows, and a star-change marker appears', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(journeySeed(localWorkerUrlKey), { features: { shipJourney: true } });
    await seedReports(page, localWorkerUrlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-1', bearing: 'N', reason: 'r', archived: false }] },
      // North-star change here (Ship A -> Ship B), landing between LOCAL-1's
      // and LOCAL-2's completedAt — the trail must break at this boundary.
      { generatedAt: '2026-01-05T00:00:00Z', northStar: 'Ship B', orientation: [{ identifier: 'LOCAL-2', bearing: 'S', reason: 'r', archived: false }] },
      { generatedAt: '2026-01-10T00:00:00Z', northStar: 'Ship B', orientation: [{ identifier: 'LOCAL-3', bearing: 'E', reason: 'r', archived: false }] },
    ]);

    await page.goto(`/workspace/${localWorkerUrlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="ship-journey-empty"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ship-journey-coverage"]')).toBeVisible();
    await expect(page.locator('[data-testid="ship-journey-coverage"]')).toContainText('coverage');
    // Scoped to the retained window, not presented as the whole journey.
    await expect(page.locator('[data-testid="ship-journey-coverage"]')).toContainText('retained run');

    await expect(page.locator('[data-testid="ship-journey-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="ship-journey-star-marker"]')).toHaveCount(1);

    // LIN-1970 defect 2 regression: these 3 waypoints (bearings N/S/E — not
    // centred on the origin) are the exact scenario that previously scaled
    // the third waypoint to x=112 in the ±100 viewBox, clipping it. A DOM
    // count alone can't catch this (the clipped node is still present), so
    // assert each waypoint's own client rect lies inside the SVG's.
    const geometry = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      return Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          insideX: r.left >= svgRect.left - 0.5 && r.right <= svgRect.right + 0.5,
          insideY: r.top >= svgRect.top - 0.5 && r.bottom <= svgRect.bottom + 0.5,
        };
      });
    });
    expect(geometry).toHaveLength(3);
    for (const point of geometry) {
      expect(point.insideX).toBe(true);
      expect(point.insideY).toBe(true);
    }
  });

  test('playback controls step through the trail', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(journeySeed(localWorkerUrlKey), { features: { shipJourney: true } });
    await seedReports(page, localWorkerUrlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-1', bearing: 'N', reason: 'r', archived: false }] },
      { generatedAt: '2026-01-05T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-2', bearing: 'S', reason: 'r', archived: false }] },
    ]);

    await page.goto(`/workspace/${localWorkerUrlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');

    // Fully revealed on load (scrub starts at its max).
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(2);

    await page.locator('[data-testid="ship-journey-step-back"]').click();
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(1);

    await page.locator('[data-testid="ship-journey-step-forward"]').click();
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(2);
  });

  // LIN-2065 production-scale COUNT pin — and, per LIN-2089, a count pin only.
  // Cycling all 8 bearings makes the walk turn back on itself constantly, so
  // 130 waypoints span an extent of only ≈9.24 units: computeFitZoom's maxZoom
  // clamp binds and the fit never actually engages. This case therefore cannot
  // fail for the reason a containment test exists. The max-extent probe below
  // is the one that exercises the fit; keep both.
  test('a production-scale trail (130 waypoints, cycling bearings) stays fully contained in the map viewport', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const id = (rawId) => localSeedId(urlKey, rawId);
    const WAYPOINT_COUNT = 130;
    const CYCLE = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    const issues = [];
    const orientation = [];
    for (let i = 0; i < WAYPOINT_COUNT; i++) {
      const identifier = `LOCAL-${i + 1}`;
      const month = i < 27 ? '01' : i < 54 ? '02' : i < 81 ? '03' : i < 108 ? '04' : '05';
      const day = String((i % 27) + 1).padStart(2, '0');
      const completedAt = `2026-${month}-${day}T00:00:00Z`;
      issues.push({
        id: id(`sj-issue-${i + 1}`), identifier, title: `Waypoint ${i + 1}`, description: '',
        projectId: id('sj-proj-1'), sortOrder: i + 1, state: { name: 'Done', type: 'completed' },
        completedAt, url: `/workspace/${urlKey}/issue/${id(`sj-issue-${i + 1}`)}`,
      });
      orientation.push({ identifier, bearing: CYCLE[i % CYCLE.length], reason: 'r', archived: false });
    }

    await seedLocal({
      projects: [{ id: id('sj-proj-1'), name: 'Journey Project', content: '', sortOrder: 1 }],
      issues,
    }, { features: { shipJourney: true } });
    await seedReports(page, urlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
    ]);
    // This test seeds a materially different-sized issue set than the specs
    // above it — bypass fetchWorkspaceIssues's 30s memo (server.js) so the
    // dashboard-scale trail isn't read from another test's stale cache.
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);

    const geometry = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      return Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          insideX: r.left >= svgRect.left - 0.5 && r.right <= svgRect.right + 0.5,
          insideY: r.top >= svgRect.top - 0.5 && r.bottom <= svgRect.bottom + 0.5,
        };
      });
    });
    expect(geometry).toHaveLength(WAYPOINT_COUNT);
    for (const point of geometry) {
      expect(point.insideX).toBe(true);
      expect(point.insideY).toBe(true);
    }
  });

  // LIN-2089: the max-extent counterpart to the rosette above. A single
  // bearing never turns, so 130 waypoints span ≈130 units — the fit is fully
  // engaged and the marker geometry is under real pressure. This is where the
  // dot:step ratio is observable: it is scale-invariant (dot and step are both
  // inside the zoomed group), so measuring it in rendered CSS pixels at this
  // extent pins the failure John saw — 121 waypoints reading as ~8 blobs.
  test('a max-extent trail (130 waypoints, one bearing) stays contained and keeps its marks under 80% of a step', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const WAYPOINT_COUNT = 130;

    const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'N');
    await seedLocal(seed, { features: { shipJourney: true } });
    await seedReports(page, urlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
    ]);
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);

    const measured = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      const rects = Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]'))
        .map((el) => el.getBoundingClientRect());
      const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
      const steps = [];
      for (let i = 1; i < rects.length; i++) {
        const a = centre(rects[i - 1]);
        const b = centre(rects[i]);
        steps.push(Math.hypot(b.x - a.x, b.y - a.y));
      }
      steps.sort((a, b) => a - b);
      return {
        outside: rects.filter((r) => (
          r.left < svgRect.left - 0.5 || r.right > svgRect.right + 0.5
          || r.top < svgRect.top - 0.5 || r.bottom > svgRect.bottom + 0.5
        )).length,
        widestMark: Math.max(...rects.map((r) => r.width)),
        // Median rather than mean: immune to a single outlier step if the
        // heading-inertia walk ever varies one.
        medianStep: steps[Math.floor(steps.length / 2)],
      };
    });

    expect(measured.outside).toBe(0);
    expect(measured.medianStep).toBeGreaterThan(0);
    // The mark must stay under 80% of the step. Note the client rect reports
    // the FILL box — it excludes the halo stroke (this assertion measured
    // exactly 5.99996 against the pre-fix r=3, i.e. 2r/step, not the 6.75
    // painted figure) — so this is a real but conservative witness. The
    // painted 2r+halo rule itself is pinned arithmetically in
    // tests/unit/ship-journey-geometry.test.js.
    expect(measured.widestMark / measured.medianStep).toBeLessThanOrEqual(0.8);
  });

  // LIN-2089: a regression witness for a ★-clipping defect that was live on
  // main before this fix. Every segment break resets the walk to a berth one
  // unit from the shared origin, so the ★ anchors at an origin that is not
  // itself a plotted waypoint — a walk heading away from it fits a content box
  // the origin falls outside, and the marker renders past the SVG's own edge.
  test('the star marker stays inside the map when the trail walks away from the berth origin', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const WAYPOINT_COUNT = 35;

    // Every waypoint bears S, so the whole walk runs outbound from the berth:
    // the revealed box is y ∈ [1, 34] and the origin the ★ anchors to is
    // genuinely OUTSIDE it. Aim matters here — an `N` first waypoint would sit
    // at y = -1 (BEARING_TO_ANGLE puts N at 270°), straddling the origin and
    // making the fit's origin-union a no-op, so the case could not exercise
    // what it exists for.
    const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'S');
    await seedLocal(seed, { features: { shipJourney: true } });
    await seedReports(page, urlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: orientation.slice(0, 1) },
      // Lands between waypoint 1's and waypoint 2's completedAt, so the trail
      // breaks there and the walk restarts at a fresh berth.
      { generatedAt: '2026-01-01T12:00:00Z', northStar: 'Ship B', orientation: orientation.slice(1) },
    ]);
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);

    const star = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      const el = document.querySelector('[data-testid="ship-journey-star-marker"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const wps = Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]'))
        .map((w) => w.getBoundingClientRect());
      const starCentreY = (r.top + r.bottom) / 2;
      return {
        overflowLeft: svgRect.left - r.left,
        overflowRight: r.right - svgRect.right,
        overflowTop: svgRect.top - r.top,
        overflowBottom: r.bottom - svgRect.bottom,
        // Is the ★'s anchor (the origin) actually outside the waypoints' own
        // box? If it isn't, this fixture is not exercising what it claims to.
        originOutsideRevealedBox: starCentreY < Math.min(...wps.map((w) => (w.top + w.bottom) / 2)) - 0.5
          || starCentreY > Math.max(...wps.map((w) => (w.top + w.bottom) / 2)) + 0.5,
      };
    });

    expect(star).not.toBeNull();
    // Pin the fixture's AIM, not just its outcome: a future edit that lets the
    // walk straddle the origin would otherwise leave this test green while
    // silently no longer covering the outbound-walk case.
    expect(star.originOutsideRevealedBox).toBe(true);
    expect(star.overflowLeft).toBeLessThanOrEqual(0.5);
    expect(star.overflowRight).toBeLessThanOrEqual(0.5);
    expect(star.overflowTop).toBeLessThanOrEqual(0.5);
    expect(star.overflowBottom).toBeLessThanOrEqual(0.5);
  });

  // LIN-2089: derivePositions resets every segment to the SAME origin, so
  // per-segment ★ glyphs render at identical coordinates — a starburst, not
  // crowding, which no glyph size can separate. They collapse to one counted
  // marker instead.
  //
  // A double-digit count is deliberate: collapsing widens the marker past a
  // single glyph, and the counter's width — not the origin — is what the
  // 10-unit fit pad actually has to absorb, so the containment assertion here
  // is the guard on that (LIN-2089 review, F2).
  test('multiple north-star changes collapse to one counted star marker that stays contained', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const CHANGES = 13;
    const PER_SEGMENT = 2;
    const WAYPOINT_COUNT = (CHANGES + 1) * PER_SEGMENT;

    const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'E');
    await seedLocal(seed, { features: { shipJourney: true } });
    // One report per north star, each generatedAt landing mid-way between two
    // consecutive waypoints' completedAt so every change falls on a break.
    const reports = [];
    for (let s = 0; s <= CHANGES; s++) {
      const first = s * PER_SEGMENT;
      const day = String((first % 27) + 1).padStart(2, '0');
      const month = String(Math.floor(first / 27) + 1).padStart(2, '0');
      reports.push({
        // The first report predates every waypoint; each later one lands 12h
        // before the first waypoint of its own segment.
        generatedAt: s === 0 ? '2026-01-01T00:00:00Z' : `2026-${month}-${day}T00:00:00Z`,
        northStar: `Ship ${String.fromCharCode(65 + s)}`,
        orientation: orientation.slice(first, first + PER_SEGMENT),
      });
    }
    await seedReports(page, urlKey, reports);
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);

    const marker = page.locator('[data-testid="ship-journey-star-marker"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toContainText(`×${CHANGES}`);

    const fit = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      const r = document.querySelector('[data-testid="ship-journey-star-marker"]').getBoundingClientRect();
      return {
        // The marker's width in viewBox units — the figure the fit's 10-unit
        // pad has to absorb, and the one the code comment records.
        widthInViewBoxUnits: (r.width / svgRect.width) * 200,
        contained: r.left >= svgRect.left - 0.5 && r.right <= svgRect.right + 0.5
          && r.top >= svgRect.top - 0.5 && r.bottom <= svgRect.bottom + 0.5,
      };
    });

    expect(fit.contained).toBe(true);
    // Half-reach must stay inside computeFitZoom's pad: 10.
    expect(fit.widthInViewBoxUnits / 2).toBeLessThan(10);
  });

  test('redirects to settings when the flag is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(journeySeed(localWorkerUrlKey), { features: { shipJourney: false } });
    await page.goto(`/workspace/${localWorkerUrlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain(`/workspace/${localWorkerUrlKey}/settings`);
  });

  // ── LIN-2067 (P7): keyed reconcile, ship glyph, continuous animation ──────
  //
  // These cases are the first behavioural coverage this view has ever had of
  // play/pause (the research comment on LIN-2067 confirmed zero prior
  // clicks of data-testid="ship-journey-play" anywhere in tests/). They read
  // geometry straight off DOM attributes (dot cx/cy, the trail group's own
  // `transform`, the ship glyph's `transform`) rather than CSS pixels, so
  // they exercise the exact numbers paint() computes, not a rounded render.
  test.describe('keyed reconcile, ship glyph, and playback animation (LIN-2067)', () => {
    // A straight single-bearing walk: derivePositions has no turning to do
    // (every waypoint already bears the walk's current heading), so
    // consecutive points are exactly one content-unit apart on one axis —
    // predictable spacing for the tween-margin math below.
    function straightFixture(urlKey, count) {
      return walkFixture(urlKey, count, () => 'N');
    }

    async function loadJourney(page, seedLocal, urlKey, count) {
      const { seed, orientation } = straightFixture(urlKey, count);
      await seedLocal(seed, { features: { shipJourney: true } });
      await page.request.post(`/test/seed-report-history?urlKey=${urlKey}`, {
        data: { records: [{ generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation }] },
      });
      await page.request.get('/test/clear-workspace-issues-memo');
      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="ship-journey-ship"]')).toHaveCount(1);
    }

    // Reads the reconcile's own numbers straight from the DOM: every
    // revealed dot's content-space position, the trail group's transform
    // (translateX, translateY, zoom), and the ship glyph's own transform —
    // in the SAME outer-viewBox space the ship and the ★ share.
    function readGeom(page) {
      return page.evaluate(() => {
        const g = document.querySelector('[data-testid="ship-journey-trail"]');
        const gt = g.getAttribute('transform');
        const gm = /translate\(([-\d.eE]+),([-\d.eE]+)\) scale\(([-\d.eE]+)\)/.exec(gt);
        const tx = Number(gm[1]), ty = Number(gm[2]), zoom = Number(gm[3]);
        const dots = Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]')).map((el) => {
          const cx = Number(el.getAttribute('cx')), cy = Number(el.getAttribute('cy'));
          return { x: tx + zoom * cx, y: ty + zoom * cy };
        });
        const ship = document.querySelector('[data-testid="ship-journey-ship"]');
        const sm = /translate\(([-\d.eE]+),([-\d.eE]+)\)/.exec(ship.getAttribute('transform'));
        const shipPos = { x: Number(sm[1]), y: Number(sm[2]) };
        const segs = Array.from(document.querySelectorAll('.sj-trail-segment')).map((el) => el.getAttribute('d'));
        let lastSegScreenPoint = null;
        if (segs.length) {
          const last = segs[segs.length - 1];
          const pts = last.replace(/[ML]/g, '').trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
          const [px, py] = pts[pts.length - 1];
          lastSegScreenPoint = { x: tx + zoom * px, y: ty + zoom * py };
        }
        return { tx, ty, zoom, dots, shipPos, lastSegScreenPoint };
      });
    }

    async function sampleWhilePlaying(page, { samples = 12, intervalMs = 40 } = {}) {
      const out = [];
      for (let i = 0; i < samples; i++) {
        out.push(await readGeom(page));
        await page.waitForTimeout(intervalMs);
      }
      return out;
    }

    function minDistToAnyDot(point, dots) {
      return Math.min(...dots.map((d) => Math.hypot(point.x - d.x, point.y - d.y)));
    }

    // S1 + S2: node identity survives an update — the reconcile patches nodes
    // in place rather than tearing down and rebuilding the SVG. A "count
    // removals" observer would pass on a rebuild that happens to remove
    // nothing observable; identity cannot — this is also exactly the
    // property P8 (LIN-2068)'s focusable identity nodes need.
    test('stepping keeps the trail group and retained waypoint dots as the SAME DOM nodes (no full-SVG rebuild)', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 4);
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(4);

      // Tag the group and the two dots that will survive a step back+forward.
      await page.evaluate(() => {
        const g = document.querySelector('[data-testid="ship-journey-trail"]');
        g.__probe = true;
        const dots = document.querySelectorAll('[data-testid="ship-journey-waypoint"]');
        dots[0].__probe = 'dot0';
        dots[1].__probe = 'dot1';
      });

      await page.locator('[data-testid="ship-journey-step-back"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(3);
      await page.locator('[data-testid="ship-journey-step-forward"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(4);

      const survived = await page.evaluate(() => {
        const g = document.querySelector('[data-testid="ship-journey-trail"]');
        const dots = document.querySelectorAll('[data-testid="ship-journey-waypoint"]');
        return {
          gSurvived: g.__probe === true && g.isConnected,
          dot0Survived: dots[0].__probe === 'dot0' && dots[0].isConnected,
          dot1Survived: dots[1].__probe === 'dot1' && dots[1].isConnected,
          // The 4th dot was removed by the step-back and MUST be a fresh node
          // on step-forward, not a resurrected one — it never got tagged.
          dot3IsFresh: dots[3].__probe === undefined,
        };
      });
      expect(survived.gSurvived).toBe(true);
      expect(survived.dot0Survived).toBe(true);
      expect(survived.dot1Survived).toBe(true);
      expect(survived.dot3IsFresh).toBe(true);
    });

    // S3: standard-motion playback genuinely tweens the ship between
    // waypoints via requestAnimationFrame, rather than jumping discretely.
    test('standard-motion playback tweens the ship strictly between waypoints', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 5);
      // Rewind to the start so play() has room to tween across several waypoints.
      for (let i = 0; i < 4; i++) await page.locator('[data-testid="ship-journey-step-back"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(1);

      await page.locator('[data-testid="ship-journey-play"]').click();
      const samples = await sampleWhilePlaying(page, { samples: 14, intervalMs: 40 });
      await page.locator('[data-testid="ship-journey-play"]').click(); // stop before the test ends

      // One content-unit step (this fixture's consecutive-waypoint spacing)
      // renders as `zoom` screen units — 5% of that step is the margin a
      // genuine tween sample must clear from EVERY waypoint, revealed or not.
      const betweenSamples = samples.filter((s) => minDistToAnyDot(s.shipPos, s.dots) > 0.05 * s.zoom);
      expect(betweenSamples.length).toBeGreaterThan(0);
    });

    // S4: prefers-reduced-motion keeps the ship on discrete per-waypoint
    // steps — but through the SAME keyed reconcile (node identity survives
    // every step), never a fallback to a full rebuild. Revision 2 on
    // LIN-2067 requires this conjunction specifically so a future focusable
    // per-waypoint node (P8/LIN-2068) survives every reduced-motion step.
    test('reduced motion keeps the ship on discrete waypoints while preserving node identity across steps', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await loadJourney(page, seedLocal, localWorkerUrlKey, 5);
      for (let i = 0; i < 4; i++) await page.locator('[data-testid="ship-journey-step-back"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(1);

      await page.evaluate(() => {
        document.querySelector('[data-testid="ship-journey-trail"]').__probe = true;
      });

      await page.locator('[data-testid="ship-journey-play"]').click();
      const samples = await sampleWhilePlaying(page, { samples: 10, intervalMs: 150 });
      await page.locator('[data-testid="ship-journey-play"]').click();

      for (const s of samples) {
        expect(minDistToAnyDot(s.shipPos, s.dots)).toBeLessThan(0.01);
      }
      const gSurvived = await page.evaluate(() => document.querySelector('[data-testid="ship-journey-trail"]').__probe === true);
      expect(gSurvived).toBe(true);
    });

    // S5: the trail is drawn progressively — its leading segment's final
    // coordinate tracks the ship's own in-progress tween point, not just the
    // last fully-revealed waypoint.
    test('the trail\'s leading edge tracks the ship mid-tween', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 5);
      for (let i = 0; i < 4; i++) await page.locator('[data-testid="ship-journey-step-back"]').click();

      await page.locator('[data-testid="ship-journey-play"]').click();
      const samples = await sampleWhilePlaying(page, { samples: 12, intervalMs: 40 });
      await page.locator('[data-testid="ship-journey-play"]').click();

      const midTween = samples.find((s) => s.lastSegScreenPoint && minDistToAnyDot(s.shipPos, s.dots) > 0.1);
      expect(midTween).toBeTruthy();
      expect(Math.abs(midTween.lastSegScreenPoint.x - midTween.shipPos.x)).toBeLessThan(0.05);
      expect(Math.abs(midTween.lastSegScreenPoint.y - midTween.shipPos.y)).toBeLessThan(0.05);
    });

    // S6: auto-fit still recomputes from the revealed bounds as playback
    // advances, and does so on the SAME retained trail-group node — the fit
    // transform and node identity are not in tension.
    test('auto-fit zoom recomputes (shrinks) as more of the trail reveals, on the same trail-group node', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 60);
      for (let i = 0; i < 58; i++) await page.locator('[data-testid="ship-journey-step-back"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(2);

      await page.evaluate(() => { document.querySelector('[data-testid="ship-journey-trail"]').__probe = true; });
      const early = await readGeom(page);

      for (let i = 0; i < 58; i++) await page.locator('[data-testid="ship-journey-step-forward"]').click();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(60);
      const late = await readGeom(page);

      const gSurvived = await page.evaluate(() => document.querySelector('[data-testid="ship-journey-trail"]').__probe === true);
      expect(gSurvived).toBe(true);
      expect(late.zoom).toBeLessThan(early.zoom);
    });

    // S7: seeking mid-tween snaps the ship to an exact waypoint AND actually
    // cancels the in-flight animation frame — a snap-only assertion would
    // still pass with a stale rAF loop silently moving the ship afterwards.
    test('stepping mid-tween snaps the ship to a waypoint and the cancelled tween never resumes', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 5);
      for (let i = 0; i < 4; i++) await page.locator('[data-testid="ship-journey-step-back"]').click();

      await page.locator('[data-testid="ship-journey-play"]').click();
      await page.waitForTimeout(250); // partway into a 700ms tween, well clear of a waypoint boundary
      await page.locator('[data-testid="ship-journey-step-back"]').click();

      const snapped = await readGeom(page);
      expect(minDistToAnyDot(snapped.shipPos, snapped.dots)).toBeLessThan(0.01);

      await page.waitForTimeout(300); // longer than a stale rAF/interval tick would need to move it
      const after = await readGeom(page);
      expect(after.shipPos.x).toBeCloseTo(snapped.shipPos.x, 3);
      expect(after.shipPos.y).toBeCloseTo(snapped.shipPos.y, 3);
    });

    // S8 (review F1/F3): the trail must always paint BELOW the waypoint
    // dots, in document order, so a dot's halo visibly cuts the trail where
    // it passes underneath (LIN-2089's "beads on a thread" invariant, stated
    // in public/ship-journey.css). This checks the occlusion outcome
    // directly via document order (SVG has no z-index — later-painted wins),
    // not merely a node count, and re-checks after a step-back/step-forward
    // cycle, which is exactly when creation-order-dependent layering used to
    // flip (review F1: circles appended before segments; non-deterministic
    // across a session).
    test('trail segments always paint below waypoint dots, at initial paint and after a step-back/step-forward cycle', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await loadJourney(page, seedLocal, localWorkerUrlKey, 4);

      async function trailPaintsBelowDots() {
        return page.evaluate(() => {
          const segs = Array.from(document.querySelectorAll('.sj-trail-segment'));
          const dots = Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]'));
          if (!segs.length || !dots.length) return false;
          // A segment paints below a dot iff the segment comes EARLIER in
          // document order (SVG paints later nodes on top; there is no
          // z-index). DOCUMENT_POSITION_FOLLOWING on (seg, dot) means dot
          // follows seg, i.e. dot paints on top of seg.
          return segs.every((seg) => dots.every((dot) => Boolean(
            seg.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING
          )));
        });
      }

      expect(await trailPaintsBelowDots()).toBe(true);

      await page.locator('[data-testid="ship-journey-step-back"]').click();
      await page.locator('[data-testid="ship-journey-step-forward"]').click();

      expect(await trailPaintsBelowDots()).toBe(true);
    });
  });
});
