import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, swimLocalSeed, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js';

// LIN-378: rides a seeded local workspace (no `test-token` mock) — the swim
// sample fixture converted to local shape, so the orientation identifiers
// (AUTH-3, API-4, …) still resolve.
const TEST_WORKSPACE_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
const SHIP_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/ship`;

// Orientation mode (LIN-301): the Ship view reads saved per-task compass
// bearings (from the report-history store, LIN-299/300) and offers a
// project ↔ orientation toggle with a pure angular tween. These tests exercise
// the consumer end-to-end: no LLM call is made on the ship side.

test.describe('Ship orientation mode (LIN-301)', () => {
  test('mode control renders; orientation is disabled without a saved report', async ({ page }) => {
    await page.goto(`/test/clear-report-history?urlKey=${TEST_WORKSPACE_URL_KEY}`);
    await seedLocalWorkspace(page, swimLocalSeed);
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#ship-mode-control')).toBeVisible();
    await expect(page.locator('#ship-mode-project')).toHaveAttribute('aria-pressed', 'true');
    // No saved report → orientation has nothing to read, so it's inert.
    await expect(page.locator('#ship-mode-orientation')).toBeDisabled();
    await expect(page.locator('#ship-mode-note')).toBeVisible();

    // Project mode is the default layout: cards carry their project sectors.
    const sectors = await page.locator('#ship-orbit .swim-box').evaluateAll(nodes =>
      nodes.map(n => n.getAttribute('data-sector'))
    );
    const allowed = new Set(['forward', 'starboard', 'aft', 'port', 'drift']);
    expect(sectors.length).toBeGreaterThan(0);
    for (const s of sectors) expect(allowed.has(s)).toBeTruthy();
  });

  test('with a saved report, toggling to orientation maps tasks to bearings', async ({ page }) => {
    await seedLocalWorkspace(page, swimLocalSeed, { features: { roadmap: true } });

    // Seed a report whose orientation covers swim-sample non-started tasks.
    const orientation = [
      { identifier: 'AUTH-3', bearing: 'N', reason: 'dead ahead', archived: false },
      { identifier: 'API-4', bearing: 'S', reason: 'drifting', archived: false },
      { identifier: 'API-5', bearing: 'E', reason: 'maintenance', archived: false },
      { identifier: 'DASH-2', bearing: 'S', reason: 'shouldn’t be aboard', archived: true }
    ];
    const resp = await page.request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/reports`, {
      data: { northStar: 'Ship the orientation instrument', narrative: { digest: 'x' }, orientation }
    });
    expect(resp.ok()).toBeTruthy();

    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');

    const orientBtn = page.locator('#ship-mode-orientation');
    await expect(orientBtn).toBeEnabled();
    // Before toggling, no card is tagged with a bearing.
    await expect(page.locator('#ship-orbit [data-bearing]')).toHaveCount(0);

    await orientBtn.click();

    // After the tween settles, orientation mode is active and bearings are tagged.
    await expect(orientBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ship-mode-project')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ship-orbit [data-bearing="N"]').first()).toBeVisible();
    // The archived task is flagged off-compass (overboard), not relocated.
    await expect(page.locator('#ship-orbit [data-overboard="true"]').first()).toBeVisible();
    // The compass rose replaces the project segment labels.
    await expect(page.locator('.ship-compass-label').first()).toBeVisible();

    // Toggling back to project clears the bearings and restores the default.
    await page.locator('#ship-mode-project').click();
    await expect(page.locator('#ship-mode-project')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ship-orbit [data-bearing]')).toHaveCount(0);
  });

  test('orientation preference persists across reloads', async ({ page }) => {
    await seedLocalWorkspace(page, swimLocalSeed, { features: { roadmap: true } });
    await page.request.post(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/roadmap/reports`, {
      data: {
        northStar: 'star',
        narrative: { digest: 'x' },
        orientation: [{ identifier: 'AUTH-3', bearing: 'N', reason: 'r', archived: false }]
      }
    });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');

    await page.locator('#ship-mode-orientation').click();
    await expect(page.locator('#ship-mode-orientation')).toHaveAttribute('aria-pressed', 'true');

    // Reload: the saved mode should re-apply on first render (no click needed).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#ship-mode-orientation')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ship-orbit [data-bearing="N"]').first()).toBeVisible();
  });
});
