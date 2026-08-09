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

  test('redirects to settings when the flag is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(journeySeed(localWorkerUrlKey), { features: { shipJourney: false } });
    await page.goto(`/workspace/${localWorkerUrlKey}/ship-journey`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain(`/workspace/${localWorkerUrlKey}/settings`);
  });
});
