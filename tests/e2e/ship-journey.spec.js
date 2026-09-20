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

  // LIN-2956: with the reset-to-origin removed, a break's ★ now anchors at
  // its own junction point on the trail (the first waypoint of the new
  // segment) rather than at the shared origin — this is the regression
  // witness for that placement, plus containment (the LIN-2089 concern this
  // partly supersedes: an anchor outside the revealed content box would clip).
  test('the star marker sits at its junction point, not the origin, and stays contained', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const WAYPOINT_COUNT = 35;

    const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'S');
    await seedLocal(seed, { features: { shipJourney: true } });
    await seedReports(page, urlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: orientation.slice(0, 1) },
      // Lands between waypoint 1's and waypoint 2's completedAt, so the trail
      // breaks there — the walk continues, but the break is still marked.
      { generatedAt: '2026-01-01T12:00:00Z', northStar: 'Ship B', orientation: orientation.slice(1) },
    ]);
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);
    await expect(page.locator('[data-testid="ship-journey-star-marker"]')).toHaveCount(1);

    const result = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="ship-journey-trail"]');
      const m = /translate\(([-\d.eE]+),([-\d.eE]+)\)\s*scale\(([-\d.eE]+)\)/.exec(g.getAttribute('transform'));
      const translateX = parseFloat(m[1]);
      const translateY = parseFloat(m[2]);
      const zoom = parseFloat(m[3]);

      // The junction is the SECOND waypoint (index 1) — the first waypoint
      // AFTER the break — not the origin.
      const junctionDot = document.querySelectorAll('[data-testid="ship-journey-waypoint"]')[1];
      const junctionX = translateX + zoom * parseFloat(junctionDot.getAttribute('cx'));
      const junctionY = translateY + zoom * parseFloat(junctionDot.getAttribute('cy'));

      const star = document.querySelector('[data-testid="ship-journey-star-marker"]');
      const starX = parseFloat(star.getAttribute('x'));
      const starY = parseFloat(star.getAttribute('y'));

      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      const starRect = star.getBoundingClientRect();

      return {
        starAtJunction: Math.abs(starX - junctionX) < 1e-6 && Math.abs(starY - junctionY) < 1e-6,
        starAtOrigin: Math.abs(starX) < 1e-6 && Math.abs(starY) < 1e-6,
        overflowLeft: svgRect.left - starRect.left,
        overflowRight: starRect.right - svgRect.right,
        overflowTop: svgRect.top - starRect.top,
        overflowBottom: starRect.bottom - svgRect.bottom,
      };
    });

    expect(result.starAtJunction).toBe(true);
    expect(result.starAtOrigin).toBe(false);
    expect(result.overflowLeft).toBeLessThanOrEqual(0.5);
    expect(result.overflowRight).toBeLessThanOrEqual(0.5);
    expect(result.overflowTop).toBeLessThanOrEqual(0.5);
    expect(result.overflowBottom).toBeLessThanOrEqual(0.5);
  });

  // LIN-2956 reverts LIN-2089's collapse: once breaks no longer share one
  // origin, each renders its own ★ at its own junction — a double-digit break
  // count pins that N distinct, contained markers render, not one counted glyph.
  test('multiple north-star changes render one distinct, contained star marker per junction', async ({ page, seedLocal, localWorkerUrlKey }) => {
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
    await expect(page.locator('[data-testid="ship-journey-star-marker"]')).toHaveCount(CHANGES);

    const result = await page.evaluate(() => {
      const svg = document.getElementById('ship-journey-map');
      const svgRect = svg.getBoundingClientRect();
      const rects = Array.from(document.querySelectorAll('[data-testid="ship-journey-star-marker"]'))
        .map((el) => el.getBoundingClientRect());
      const contained = rects.every((r) => r.left >= svgRect.left - 0.5 && r.right <= svgRect.right + 0.5
        && r.top >= svgRect.top - 0.5 && r.bottom <= svgRect.bottom + 0.5);
      let distinct = true;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (Math.abs(rects[i].left - rects[j].left) < 0.5 && Math.abs(rects[i].top - rects[j].top) < 0.5) {
            distinct = false;
          }
        }
      }
      return { contained, distinct };
    });

    expect(result.contained).toBe(true);
    expect(result.distinct).toBe(true);
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

      // Tag the group, the two dots, and the two paired labels (P8 /
      // LIN-2068's label layer is keyed by the same index as the dots, so
      // the same two positions survive the same step back+forward cycle).
      await page.evaluate(() => {
        const g = document.querySelector('[data-testid="ship-journey-trail"]');
        g.__probe = true;
        const dots = document.querySelectorAll('[data-testid="ship-journey-waypoint"]');
        dots[0].__probe = 'dot0';
        dots[1].__probe = 'dot1';
        const labels = document.querySelectorAll('.sj-waypoint-label');
        labels[0].__probe = 'label0';
        labels[1].__probe = 'label1';
      });

      // P8 / LIN-2068: focus dot1 before stepping — it is retained (not
      // culled) by the step-back/step-forward cycle below, so this is the
      // direct regression witness that a repaint never rebuilds (and so
      // never un-focuses) a node that survives it. The cycle is driven
      // through the scrub input's own `input` event, dispatched
      // programmatically (not a real pointer interaction), rather than
      // clicking the step buttons: clicking a <button> moves focus to that
      // button as part of its own native mousedown handling, before its
      // `click` listener (and this repaint) ever runs — an unrelated browser
      // behaviour that would confound this specific assertion. That
      // button-click focus-steal is exactly what paint()'s
      // lastBlurredWaypointIdx tracking is FOR (see the separate
      // backward-cull/replay-wipe reassignment cases below); this case
      // isolates the other half of the guarantee — an UNCULLED, retained
      // node's focus is never disturbed by the reconcile itself.
      await page.locator('[data-testid="ship-journey-waypoint"]').nth(1).focus();
      await expect(page.locator('[data-testid="ship-journey-waypoint"]').nth(1)).toBeFocused();

      await page.evaluate(() => {
        const scrub = document.getElementById('ship-journey-scrub');
        scrub.value = '2';
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(3);
      // P8 / LIN-2068: the label layer is culled in the same revealIndex pass
      // as the dots, so a backward scrub must never leave an orphaned label
      // (or a missing one) behind — pin the two counts in lockstep, not just
      // the dot count, so a broken/missing label-cull loop shows up here.
      await expect(page.locator('.sj-waypoint-label')).toHaveCount(3);
      await page.evaluate(() => {
        const scrub = document.getElementById('ship-journey-scrub');
        scrub.value = '3';
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(4);
      await expect(page.locator('.sj-waypoint-label')).toHaveCount(4);

      const survived = await page.evaluate(() => {
        const g = document.querySelector('[data-testid="ship-journey-trail"]');
        const dots = document.querySelectorAll('[data-testid="ship-journey-waypoint"]');
        const labels = document.querySelectorAll('.sj-waypoint-label');
        return {
          gSurvived: g.__probe === true && g.isConnected,
          dot0Survived: dots[0].__probe === 'dot0' && dots[0].isConnected,
          dot1Survived: dots[1].__probe === 'dot1' && dots[1].isConnected,
          // The 4th dot was removed by the step-back and MUST be a fresh node
          // on step-forward, not a resurrected one — it never got tagged.
          dot3IsFresh: dots[3].__probe === undefined,
          dot1StillFocused: dots[1] === document.activeElement,
          // Same identity property as the dots, but for the label layer's
          // own keyed reconcile (P8 / LIN-2068) — a rebuild-per-frame label
          // node would lose this tag even though the dot-count assertions
          // above stay green.
          label0Survived: labels[0].__probe === 'label0' && labels[0].isConnected,
          label1Survived: labels[1].__probe === 'label1' && labels[1].isConnected,
          label3IsFresh: labels[3].__probe === undefined,
        };
      });
      expect(survived.gSurvived).toBe(true);
      expect(survived.dot0Survived).toBe(true);
      expect(survived.dot1Survived).toBe(true);
      expect(survived.dot3IsFresh).toBe(true);
      expect(survived.dot1StillFocused).toBe(true);
      expect(survived.label0Survived).toBe(true);
      expect(survived.label1Survived).toBe(true);
      expect(survived.label3IsFresh).toBe(true);
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

  // ── LIN-2068 (P8): waypoint identity, labels, and run provenance ─────────
  test.describe('waypoint identity, reveal-on-focus/hover labels, and run provenance (LIN-2068)', () => {
    // A small fixture giving full control over title/reason text (walkFixture
    // above hardcodes reason: 'r', too short to usefully assert substring
    // containment against).
    function identityFixture(urlKey, entries) {
      const id = (rawId) => localSeedId(urlKey, rawId);
      const issues = [];
      const orientation = [];
      entries.forEach((e, i) => {
        const day = String(i + 1).padStart(2, '0');
        issues.push({
          id: id(`sj-id-issue-${i + 1}`), identifier: e.identifier, title: e.title, description: '',
          projectId: id('sj-id-proj-1'), sortOrder: i + 1, state: { name: 'Done', type: 'completed' },
          completedAt: `2026-01-${day}T00:00:00Z`,
          url: `/workspace/${urlKey}/issue/${id(`sj-id-issue-${i + 1}`)}`,
        });
        orientation.push({ identifier: e.identifier, bearing: e.bearing, reason: e.reason, archived: false });
      });
      return {
        seed: {
          projects: [{ id: id('sj-id-proj-1'), name: 'Journey Project', content: '', sortOrder: 1 }],
          issues,
        },
        orientation,
      };
    }

    // 9a: keyboard reachability + accessible name (role="img", tabindex="0",
    // aria-label AND a matching SVG <title> child naming identifier/title/
    // topic/reason).
    test('a waypoint circle is keyboard-focusable with role="img" and an accessible name naming identifier/title/topic/reason', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = identityFixture(urlKey, [
        { identifier: 'LOCAL-1', bearing: 'N', reason: 'closes the onboarding gap the north star flagged', title: 'Ship onboarding fix' },
        { identifier: 'LOCAL-2', bearing: 'S', reason: 'unblocks the next milestone', title: 'Second task' },
      ]);
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');

      const circle = page.locator('[data-testid="ship-journey-waypoint"]').first();
      await expect(circle).toHaveAttribute('tabindex', '0');
      await expect(circle).toHaveAttribute('role', 'img');

      const ariaLabel = await circle.getAttribute('aria-label');
      expect(ariaLabel).toContain('LOCAL-1');
      expect(ariaLabel).toContain('Ship onboarding fix');
      expect(ariaLabel).toContain('Journey Project');
      expect(ariaLabel).toContain('closes the onboarding gap the north star flagged');

      // The native pointer-hover tooltip (SVG <title>) carries the same text.
      const titleText = await circle.locator('title').textContent();
      expect(titleText).toBe(ariaLabel);

      await circle.focus();
      await expect(circle).toBeFocused();

      // Keyboard reachability must also reveal the paired label — the
      // circle carries the accessible name, but the label is what makes
      // the identity visibly readable to a sighted keyboard user (the
      // `focusin` reveal path, mirroring the pointer-reveal case below).
      const idx = await circle.getAttribute('data-idx');
      const label = page.locator(`.sj-waypoint-label[data-idx="${idx}"]`);
      await expect(label).toHaveAttribute('data-revealed', 'true');
    });

    // 9b: pointer reveal — hovering the dot reveals its paired label (matched
    // by data-idx, not sibling order); moving away hides it again. The label
    // itself must never become the hover target (pointer-events: none). The
    // reveal is witnessed via the browser's computed `opacity`, not text
    // presence or Playwright's actionability-driven visibility alone, since
    // the CSS rule that makes a revealed label opaque is what actually makes
    // it readable.
    //
    // NOT exercised here: the label's `lwp.title || lwp.identifier` identifier
    // fallback (public/ship-journey.js:421). Investigated and found genuinely
    // unreachable from this suite's seeding surface — `LocalStore#createIssue`
    // (lib/local-store.js:118) unconditionally defaults a falsy `data.title`
    // to `'Untitled'`, and `seedLocal`/`seedLocalWorkspace` route every fixture
    // issue through it, so `wp.title` can never come out null/empty here; it
    // is always at least `'Untitled'`, which is truthy and never reaches the
    // fallback. Exercising it for real would mean changing `lib/local-store.js`
    // (production behavior) or exporting the inline label-building logic as a
    // testable pure function from `public/ship-journey.js` — both out of scope
    // for this test-only follow-up. Recorded as a discrepancy rather than
    // silently claimed as covered.
    test('hovering a waypoint circle reveals its paired label; moving the pointer away hides it again', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = identityFixture(urlKey, [
        { identifier: 'LOCAL-1', bearing: 'N', reason: 'r', title: 'First' },
        { identifier: 'LOCAL-2', bearing: 'S', reason: 'r', title: 'Second' },
      ]);
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');

      const circle = page.locator('[data-testid="ship-journey-waypoint"]').first();
      const idx = await circle.getAttribute('data-idx');
      const label = page.locator(`.sj-waypoint-label[data-idx="${idx}"]`);
      await expect(label).toHaveAttribute('data-revealed', 'false');
      await expect(label).toHaveCSS('opacity', '0');

      await circle.hover();
      await expect(label).toHaveAttribute('data-revealed', 'true');
      await expect(label).toHaveCSS('opacity', '1');
      // The reveal must show the waypoint's actual title — not just the
      // attribute flip. identityFixture above set this waypoint's title to
      // 'First'.
      await expect(label).toHaveText('First');

      // Move the pointer well clear of the map to fire pointerout.
      await page.mouse.move(5, 5);
      await expect(label).toHaveAttribute('data-revealed', 'false');
      await expect(label).toHaveCSS('opacity', '0');
    });

    // 9d: backward-cull focus reassignment. Stepping back culls the leading
    // (highest-index) waypoint; if it was focused, focus must move to the new
    // leading waypoint, never fall to <body>.
    test('stepping back reassigns focus from a culled leading waypoint to the new leading waypoint, never to <body>', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = walkFixture(urlKey, 4, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      const dots = page.locator('[data-testid="ship-journey-waypoint"]');
      await expect(dots).toHaveCount(4);

      await dots.nth(3).focus(); // the leading (highest-index) waypoint
      await expect(dots.nth(3)).toBeFocused();

      await page.locator('[data-testid="ship-journey-step-back"]').click();
      await expect(dots).toHaveCount(3);

      const focusedIdx = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-idx'));
      expect(focusedIdx).toBe('2'); // the new leading waypoint
      const focusedIsBody = await page.evaluate(() => document.activeElement === document.body);
      expect(focusedIsBody).toBe(false);
    });

    // 9e: replay-wipe focus reassignment. play()'s replay-from-start branch
    // (applyPosition(0), fired because the journey loads fully revealed) must
    // reassign a focused mid-walk waypoint to the new leading waypoint (dot
    // 0), never <body>. Reduced motion keeps the first tick's cull/reassign
    // synchronous with the click and the next tick 700ms away, so there is a
    // stable window to assert in before playback advances further.
    test('replay-to-start reassigns focus from a mid-walk waypoint to the new leading waypoint (dot 0), never to <body>', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = walkFixture(urlKey, 4, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      const dots = page.locator('[data-testid="ship-journey-waypoint"]');
      await expect(dots).toHaveCount(4);

      await dots.nth(1).focus();
      await expect(dots.nth(1)).toBeFocused();

      // Already fully revealed (currentIndex === length-1), so clicking Play
      // immediately takes the replay-from-start branch and culls to dot 0.
      await page.locator('[data-testid="ship-journey-play"]').click();
      await expect(dots).toHaveCount(1);

      const focusedIdx = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-idx'));
      expect(focusedIdx).toBe('0');
      const focusedIsBody = await page.evaluate(() => document.activeElement === document.body);
      expect(focusedIsBody).toBe(false);

      await page.locator('[data-testid="ship-journey-play"]').click(); // stop before the test ends
    });

    // 9f: provenance attributes. data-source-run must carry the real report
    // id losslessly (not merely "some non-empty string"); waypoints sourced
    // from different runs must receive different data-source-rank values.
    // Attribute-level only — colour legibility is unmeasurable from this
    // suite (research §5).
    test('the dot fill channel carries run provenance losslessly via data-source-run/data-source-rank', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = walkFixture(urlKey, 4, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });

      const resp = await page.request.post(`/test/seed-report-history?urlKey=${urlKey}`, {
        data: {
          records: [
            { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: orientation.slice(0, 2) },
            { generatedAt: '2026-01-05T00:00:00Z', northStar: 'Ship A', orientation: orientation.slice(2, 4) },
          ],
        },
      });
      expect(resp.ok(), `seed-report-history failed: ${await resp.text()}`).toBeTruthy();
      const { inserted } = await resp.json();
      expect(inserted).toHaveLength(2);
      const [firstRunId, secondRunId] = inserted;
      expect(firstRunId).not.toBe(secondRunId);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      const dots = page.locator('[data-testid="ship-journey-waypoint"]');
      await expect(dots).toHaveCount(4);

      const attrs = await dots.evaluateAll((els) => els.map((el) => ({
        run: el.getAttribute('data-source-run'),
        rank: el.getAttribute('data-source-rank'),
      })));

      // Waypoints are ordered by completedAt ascending, matching walkFixture's
      // issue order — dots 0-1 came from the first report, dots 2-3 from the
      // second.
      expect(attrs[0].run).toBe(firstRunId);
      expect(attrs[1].run).toBe(firstRunId);
      expect(attrs[2].run).toBe(secondRunId);
      expect(attrs[3].run).toBe(secondRunId);
      expect(attrs[0].rank).toBe(attrs[1].rank);
      expect(attrs[2].rank).toBe(attrs[3].rank);
      expect(attrs[0].rank).not.toBe(attrs[2].rank);
    });

    // 9g: focus-ring bounded size (LIN-2962 F1). The pre-fix global
    // outline-based :focus-visible rule resolved `outline`/`outline-offset`
    // in the waypoint's own local SVG user space, which the zoomed <g>'s
    // scale(...) transform then scaled again — measured at ~13x the dot's
    // own rendered size (a ~127px ring around a ~9.5px dot), a solid block
    // covering most of the map. The fixed local-stroke ring must stay
    // proportionate to the dot instead: assert a hard, bounded ratio rather
    // than a screenshot, as a direct, named contrast with that measurement.
    test('focusing a waypoint enlarges its rendered size by a bounded ratio, not the ~13x oversized global outline', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = walkFixture(urlKey, 4, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');

      const circle = page.locator('[data-testid="ship-journey-waypoint"]').first();
      const unfocused = await circle.boundingBox();

      await circle.focus();
      await expect(circle).toBeFocused();
      const focused = await circle.boundingBox();

      const ratio = focused.width / unfocused.width;
      expect(ratio).toBeGreaterThan(1); // a focus indicator is actually present
      expect(ratio).toBeLessThanOrEqual(2); // and stays proportionate to the dot, nowhere near ~13x

      // The ratio above measures getBoundingClientRect, which CSS `outline`
      // never contributes to — it cannot see the global :focus-visible
      // outline rule reappearing, only the local stroke. Assert the
      // computed outline is actually suppressed too, so this witness covers
      // the named defect (the reintroduced outline) directly, not just a
      // proxy it happens to correlate with today.
      const outlineStyle = await circle.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outlineStyle).toBe('none');
    });

    // 9h: scrub-focus negative witness (LIN-2962 F2). The pre-fix
    // `lastBlurredWaypointIdx` fallback armed on EVERY waypoint blur,
    // wherever focus was actually going, one-shot-cleared only by the next
    // paint() — so a legitimate blur away from a waypoint left it armed for
    // whatever paint() ran next. Covers both of the ticket's repro paths:
    // (1) focusing the scrub control and then scrubbing backward must never
    // pull focus off the scrub and into the map; (2) focusing a waypoint,
    // then legitimately blurring to <body> (a non-focusable click target),
    // then clicking step-back must not steal focus into the map either —
    // the narrowed relatedTarget allowlist only arms for the three playback
    // buttons themselves.
    test('the scrub control keeps focus during backward scrubbing, and a later step-back does not steal focus after a legitimate blur elsewhere', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const { seed, orientation } = walkFixture(urlKey, 4, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      const dots = page.locator('[data-testid="ship-journey-waypoint"]');
      const scrubInput = page.locator('[data-testid="ship-journey-scrub"]');
      await expect(dots).toHaveCount(4);

      // Repro path 1: focus a waypoint, then focus the scrub (blurring the
      // circle straight to the scrub, which is never on the allowlist), then
      // scrub backward — the leading waypoint gets culled, but focus must
      // stay on the scrub throughout.
      await dots.nth(3).focus();
      await expect(dots.nth(3)).toBeFocused();

      await scrubInput.focus();
      await expect(scrubInput).toBeFocused();

      await scrubInput.press('ArrowLeft'); // native backward scrub, fires `input`
      await expect(dots).toHaveCount(3); // the leading waypoint was culled
      await expect(scrubInput).toBeFocused(); // ...but focus never left the scrub

      // Repro path 2 reloads the same fixture rather than continuing from
      // path 1's now-culled 3-waypoint state — kept isolated so this leg
      // exercises its own repro (and can be observed failing/passing on its
      // own) without depending on path 1 first culling a waypoint.
      // navigating resets ship-journey.js's module state (lastBlurredWaypointIdx
      // included), so this is a clean slate, not a carried-over one.
      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      await expect(dots).toHaveCount(4);

      // Focus a (still-live) waypoint, click a non-focusable element so
      // focus legitimately rests on <body>, then click step-back — the cull
      // must not pull focus into the map. dots.nth(3) is the waypoint the
      // step-back actually culls (revealIndex 3 -> 2); dots.nth(1) survives
      // that cull and so can never expose the steal.
      await dots.nth(3).focus();
      await expect(dots.nth(3)).toBeFocused();

      await page.locator('[data-testid="ship-journey-coverage"]').click();
      const bodyFocused = await page.evaluate(() => document.activeElement === document.body);
      expect(bodyFocused).toBe(true);

      await page.locator('[data-testid="ship-journey-step-back"]').click();
      const focusedTestId = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
      expect(focusedTestId).not.toBe('ship-journey-waypoint');
    });
  });

  // LIN-2959: the max-extent ratio witness above (:282) reads 0.640 on BOTH a
  // 390px phone and a 1280px desktop — the mark:step ratio is scale-invariant
  // (LIN-2089), so it passes identically on the broken viewport and cannot be
  // the mobile witness. medianStep in measured css px is the durable pin
  // instead: it fails today, pre-window, at ~2.38px on this exact fixture.
  test.describe('Mobile viewport (390x844) — narrow trail window (LIN-2959)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('windows the trail to the most recent 50 waypoints and restores the painted-mark pixel floor', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const WAYPOINT_COUNT = 121;
      const NARROW_TRAIL_WINDOW = 50;

      // Max-extent, single-bearing fixture (LIN-2070 F1) — never the bearing
      // cycle, whose extent never engages the fit at all.
      const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');

      // Windowed create/cull loops, not just the fit-box input: only the
      // most recent NARROW_TRAIL_WINDOW waypoints exist in the DOM at all.
      // If the fit box alone were narrowed, off-window dots would stay in
      // the DOM — clipped visually but still tabindex="0" and reachable by
      // keyboard, a silent accessibility regression this assertion catches.
      const waypoints = page.locator('[data-testid="ship-journey-waypoint"]');
      await expect(waypoints).toHaveCount(NARROW_TRAIL_WINDOW);

      const measured = await page.evaluate(() => {
        const svg = document.getElementById('ship-journey-map');
        const svgRect = svg.getBoundingClientRect();
        const waypointEls = Array.from(document.querySelectorAll('[data-testid="ship-journey-waypoint"]'));
        const rects = waypointEls.map((el) => el.getBoundingClientRect());
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
          medianStep: steps[Math.floor(steps.length / 2)],
          minDataIdx: Math.min(...waypointEls.map((el) => parseInt(el.getAttribute('data-idx'), 10))),
          labelCount: document.querySelectorAll('[data-testid="ship-journey-waypoint-label"]').length,
        };
      });

      // The pixel-budget pin (research: windowing at K<=~52 restores the
      // ~4px painted-glyph floor on a 319px-wide phone map; the maxZoom:4
      // clamp puts the windowed step at 6.38px, comfortably above 4).
      expect(measured.medianStep).toBeGreaterThanOrEqual(4);
      expect(measured.outside).toBe(0);
      // Tab order / accessibility: the window floor for a fully-revealed
      // 121-waypoint trail is 121 - 50 = 71 — no dot (and no label node,
      // culled in the same pass) exists below it.
      expect(measured.minDataIdx).toBe(WAYPOINT_COUNT - NARROW_TRAIL_WINDOW);
      expect(measured.labelCount).toBe(NARROW_TRAIL_WINDOW);
    });

    test('crossing the 640px breakpoint on resize repaints the window without a new reveal', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const urlKey = localWorkerUrlKey;
      const WAYPOINT_COUNT = 121;
      const NARROW_TRAIL_WINDOW = 50;

      const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'N');
      await seedLocal(seed, { features: { shipJourney: true } });
      await seedReports(page, urlKey, [
        { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
      ]);
      await page.request.get('/test/clear-workspace-issues-memo');

      await page.goto(`/workspace/${urlKey}/ship-journey`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(NARROW_TRAIL_WINDOW);

      // No scrub/step/play interaction crosses the breakpoint — the resize
      // itself, via narrowMq's own change listener, must trigger the repaint.
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(page.locator('[data-testid="ship-journey-waypoint"]')).toHaveCount(WAYPOINT_COUNT);
    });
  });

  // LIN-2959: desktop regression witness — the narrow-viewport branch must be
  // a no-op above the breakpoint. Same fixture and measurements as the
  // existing max-extent test above (:234), at the same unset-viewport
  // (Playwright default 1280x720) so a mobile fix can never quietly become a
  // desktop regression.
  test('above the 640px breakpoint, a max-extent trail (121 waypoints) is unwindowed and unchanged', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const WAYPOINT_COUNT = 121;

    const { seed, orientation } = walkFixture(urlKey, WAYPOINT_COUNT, () => 'N');
    await seedLocal(seed, { features: { shipJourney: true } });
    await seedReports(page, urlKey, [
      { generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation },
    ]);
    await page.request.get('/test/clear-workspace-issues-memo');

    await page.goto(`/workspace/${urlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');

    // windowFloor is always 0 above the breakpoint — every waypoint is still
    // created (not just the most recent 50).
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
        medianStep: steps[Math.floor(steps.length / 2)],
      };
    });

    // The LIN-2089 containment/ratio guarantees hold exactly as before —
    // proof this ticket did not trade desktop legibility away to buy mobile.
    expect(measured.outside).toBe(0);
    expect(measured.widestMark / measured.medianStep).toBeLessThanOrEqual(0.8);
  });
});
