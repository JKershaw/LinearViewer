import { test, expect } from '../fixtures/test-base.js';

// LIN-2706 review (PR #1424) — the browser-level witness the ticket's plan
// called for and delivery skipped. Both blocking findings were invisible to
// every existing test because they are CSS-cascade / real-layout defects:
//
//   Finding 1: `#obs-due-bulk-bar` carries the bare `hidden` attribute, but
//   `.obs-bulk-scan-bar { display: flex }` (an author-origin rule) silently
//   beat the UA sheet's `[hidden] { display: none }` — the vm-sandboxed unit
//   suite (tests/unit/observation-scan-due.test.js) asserts the JS `hidden`
//   PROPERTY, which a fake DOM with no stylesheet cannot see is defeated.
//   This test renders the REAL page + REAL public/observation.css and reads
//   getComputedStyle, the only level at which the defect is visible at all.
//
//   Finding 2: the bulk-scan disclaimer said the estimate was rendered
//   "above" it while the bar carrying the estimate actually sits below it in
//   the real layout — a claim only a real rendered page can check.
//
// This one spec discharges both ledger rows plus the "DOM test structurally
// exercises the new CSS classes" gap noted in the plan's own witness list —
// there is still no other e2e coverage of the Scan-due selection surface, so
// this also covers checkbox/select-all/estimate/refusal end to end.

let URL_KEY;
let OBSERVATION_URL;
let SCAN_DUE_ROUTE;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  SCAN_DUE_ROUTE = `**/workspace/${URL_KEY}/api/scan-due*`;
});

async function openDueTab(page) {
  await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
  await page.goto(OBSERVATION_URL);
  await page.waitForLoadState('networkidle');
  await page.click('#obs-tabs [data-view="due"]');
}

test.describe('Scan-due bulk-scan bar — real render + real stylesheet (LIN-2706 review, PR #1424)', () => {
  test('the bulk bar stays visually hidden when the due list is empty, not just JS-hidden', async ({ page }) => {
    await page.route(SCAN_DUE_ROUTE, (route) => route.fulfill({
      json: { items: [], nextCursor: null, pageCandidateCount: 0, totalCandidateCount: 0 },
    }));
    await openDueTab(page);
    await expect(page.locator('#obs-due-empty')).toBeVisible();

    const bar = page.locator('#obs-due-bulk-bar');
    await expect(bar).toHaveJSProperty('hidden', true);
    // The defect: `hidden:true` alone does not prove nothing is painted — the
    // author-origin `.obs-bulk-scan-bar { display: flex }` rule can beat the
    // UA's `[hidden] { display: none }`. Read the CASCADE RESULT, not the
    // property.
    await expect(bar).toBeHidden();
    await expect(bar).toHaveCSS('display', 'none');

    // No interactive control anywhere in the due section while it's empty —
    // the Session 1 constraint (no scan-triggering, no visible-but-inert
    // control) holds structurally, not just for the bar itself.
    const dueSection = page.locator('#obs-due-section');
    await expect(dueSection.locator('#obs-due-select-all')).toBeHidden();
  });

  test('selecting rows shows the bar, and the disclaimer correctly points at the estimate below it', async ({ page }) => {
    await page.route(SCAN_DUE_ROUTE, (route) => route.fulfill({
      json: {
        items: [
          { issueId: 'issue-1', issueIdentifier: 'LIN-1', dueStatus: true },
          { issueId: 'issue-2', issueIdentifier: 'LIN-2', dueStatus: false },
          { issueId: 'issue-3', issueIdentifier: 'LIN-3', dueStatus: true },
        ],
        nextCursor: null,
        pageCandidateCount: 3,
        totalCandidateCount: 3,
      },
    }));
    await openDueTab(page);
    await expect(page.locator('#obs-due-list .obs-due-select').first()).toBeVisible();

    const bar = page.locator('#obs-due-bulk-bar');
    // At least one row must be selected before the bar shows anything —
    // the initial paint alone must not have flashed it.
    await page.locator('#obs-due-select-all').check();
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('display', 'flex');
    await expect(page.locator('#obs-due-selected-count')).toHaveText('3 selected (exact)');

    // Finding 2: the disclaimer must name the estimate's real position.
    const disclaimer = page.locator('#obs-due-bulk-disclaimer');
    await expect(disclaimer).toContainText(/estimate below/i);
    await expect(disclaimer).not.toContainText(/estimate above/i);

    // Confirm the real layout actually matches the corrected wording: the
    // element carrying the estimate (#obs-due-bulk-bar) sits BELOW the
    // disclaimer that describes it, top-to-top.
    const disclaimerBox = await disclaimer.boundingBox();
    const barBox = await bar.boundingBox();
    expect(disclaimerBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(barBox.y).toBeGreaterThan(disclaimerBox.y);

    // The bar stays visible once rows are loaded (it hides only on an empty
    // list, per the previous test) — but the tri-state degrades cleanly.
    await page.locator('#obs-due-select-all').uncheck();
    await expect(bar).toBeVisible();
    await expect(page.locator('#obs-due-selected-count')).toHaveText('0 selected (exact)');
  });

  test('an over-ceiling selection refuses and leaves every row checked, with no scan-triggering control anywhere', async ({ page }) => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      issueId: `issue-${i}`,
      issueIdentifier: `LIN-${i}`,
      dueStatus: true,
    }));
    await page.route(SCAN_DUE_ROUTE, (route) => route.fulfill({
      json: { items, nextCursor: null, pageCandidateCount: items.length, totalCandidateCount: items.length },
    }));
    await openDueTab(page);
    await expect(page.locator('#obs-due-list .obs-due-select')).toHaveCount(45);

    await page.locator('#obs-due-select-all').check();
    const refusal = page.locator('#obs-due-bulk-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('scan 40 at a time');

    const checkedCount = await page.locator('#obs-due-list .obs-due-select:checked').count();
    expect(checkedCount, 'a refusal must never truncate the selection').toBe(45);

    // No path to a billed call anywhere on this tab, in any state.
    await expect(page.locator('#obs-due-section button:has-text("Scan")')).toHaveCount(0);
    await expect(page.locator('#obs-due-section button:has-text("Stop")')).toHaveCount(0);
  });
});
