import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed } from '../fixtures/local-harness.js';

// LIN-1217 (follow-up to LIN-1068): VERIFY the swim flow-board sticky column
// headers (`.swim-fcol-head`, `position: sticky; top: 0`) after LIN-1068 switched
// the html/body BASE overflow reset from `overflow-x: hidden` to `overflow-x: clip`.
//
// Verified runtime behavior (measured, not assumed — see the LIN-1217 investigation):
//  - 1280px: the headers render but do NOT pin — they scroll off with the board.
//    Their nearest scroll-container ancestor is `.swim-container` (overflow-x:auto,
//    which forces the intended `overflow-y: visible` to compute to `auto`), with
//    `body:has(.swim-page){overflow-x:auto}` a SECOND trapping scroll container above
//    it. The vertical sticky therefore sticks to a box that never scrolls internally
//    (the viewport scrolls), so it rides off-screen.
//  - 390px: the headers are `display: none` by design — the ≤400px flow-grid reflow
//    (LIN-977) collapses the board to a single band-ordered column and the per-project
//    column headers are intentionally dropped (the state-band labels carry grouping).
//
// This non-pin is INDEPENDENT of LIN-1068: neither `.swim-container`'s overflow nor
// the swim `body` override was touched by that commit, so LIN-1068 neither broke nor
// fixed swim column-header pinning. Restoring a genuine pin requires turning
// `.swim-container` into a bounded inner scroll-pane (a scroll-model change), which is
// out of scope for this verification and tracked as a follow-up.
//
// These assertions lock the two INTENDED invariants so the surface can't silently
// drift (and so a future pin-fix can't restore pinning by clipping the container and
// silently killing its horizontal drag-scroll):
//  1) desktop: headers present, labelled, and inside the horizontally-scrollable
//     `.swim-container` (overflow-x stays a real scroll value — the drag-scroll seam).
//  2) mobile: headers hidden (the deliberate LIN-977 reflow).

test.describe('Swim flow-board column headers (LIN-1217)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, {});
  });

  test('desktop (1280): column headers render, are labelled, and live in the horizontally-scrollable container', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await page.waitForLoadState('networkidle');

    // Default orientation is flow, so the flow grid + its column headers exist.
    await expect(page.locator('.swim-page[data-orientation="flow"]')).toBeVisible();
    const heads = page.locator('.swim-fcol-head');
    expect(await heads.count()).toBeGreaterThan(0);

    const first = heads.first();
    await expect(first).toBeVisible();
    await expect(first).not.toBeEmpty(); // carries the project label

    // The header is a grid item inside `.swim-container`, and that container keeps a
    // real horizontal-scroll overflow (the drag-scroll + wide-board substrate). This
    // guards against a future "fix" that clips the container to force a vertical pin
    // and silently removes horizontal navigation of a wide board.
    const containerOverflowX = await page.evaluate(() => {
      const c = document.querySelector('.swim-page[data-orientation="flow"] .swim-container');
      return c ? getComputedStyle(c).overflowX : null;
    });
    expect(['auto', 'scroll']).toContain(containerOverflowX);
    await expect(page.locator('.swim-container .swim-fcol-head').first()).toBeAttached();
  });

  test('mobile (390): per-project column headers are intentionally hidden (LIN-977 single-column reflow)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`/workspace/${localWorkerUrlKey}/swim`);
    await page.waitForLoadState('networkidle');

    const heads = page.locator('.swim-fcol-head');
    // The elements are still in the DOM but display:none at this width.
    expect(await heads.count()).toBeGreaterThan(0);
    for (let i = 0; i < await heads.count(); i++) {
      await expect(heads.nth(i)).toBeHidden();
    }
    const display = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.swim-fcol-head')).display);
    expect(display).toBe('none');
  });
});
