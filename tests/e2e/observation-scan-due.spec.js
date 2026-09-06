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
    // The bar appears as soon as ROWS load, independent of selection
    // (`syncDueBulkBar` keys its `hidden` off `dueLoadedItems.length`, not the
    // selection) — a freshly painted list already reads `0 selected (exact) ·
    // est. unknown`, which the closing lines of this test assert directly.
    // Selecting here is what gives the count something non-zero to show and
    // what puts the estimate beside it; it is not a precondition for the bar
    // being painted at all. (Review N4, LIN-2706 PR #1424: the previous
    // comment here claimed the opposite and was the same species of defect as
    // finding 2 — prose that misdescribes what renders.)
    await expect(bar).toBeVisible();
    await expect(page.locator('#obs-due-selected-count')).toHaveText('0 selected (exact)');
    await page.locator('#obs-due-select-all').check();
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('display', 'flex');
    await expect(page.locator('#obs-due-selected-count')).toHaveText('3 selected (exact)');

    // Review finding 3 / N2 (LIN-2706 PR #1424) — the STYLING witness. The
    // fix for finding 3 (the count/estimate/refusal/quota-note rendering as
    // 16px near-black body copy, outshouting the disclaimer they sit beside)
    // had no assertion at any level: deleting `.obs-bulk-scan-count` &
    // friends from public/observation.css left the whole unit suite and this
    // spec green. Only a real stylesheet in a real browser can see it, so it
    // is pinned here, on the page this spec already has open.
    //
    // 12.48px is `font-size: 0.78rem` against the 16px root — the shared
    // small-print size .obs-due-limits/.obs-due-progress already use. Pinned
    // rather than a colour because it is theme-independent: an unstyled span
    // inherits the body's own 16px, so the assertion fails the moment the
    // rule is gone, in either colour scheme.
    await expect(page.locator('#obs-due-selected-count')).toHaveCSS('font-size', '12.48px');
    await expect(page.locator('#obs-due-selected-cost')).toHaveCSS('font-size', '12.48px');

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

  test('an over-ceiling selection refuses and leaves every row checked, and clicking Scan anyway never issues a single scan call', async ({ page }) => {
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
    // The refusal's own share of the finding-3 styling fix (see the note in
    // the previous test): muted small print with a measured line length, not
    // 16px full-width body copy shouting over the disclaimer above it.
    await expect(refusal).toHaveCSS('font-size', '12.48px');
    // `max-width: 62ch` resolves against the rendered font's own advance
    // width, so it is asserted as "measured, not unbounded" rather than as an
    // exact pixel value — pinning 464.256px would make this spec fail on a
    // font-metric change or a slow webfont load without the styling having
    // regressed at all.
    await expect(refusal).not.toHaveCSS('max-width', 'none');

    const checkedCount = await page.locator('#obs-due-list .obs-due-select:checked').count();
    expect(checkedCount, 'a refusal must never truncate the selection').toBe(45);

    // LIN-2701 §B.7 adds the "Scan selected (N)"/Stop controls this session
    // — the safety property is no longer "no control exists" (this test's
    // original assertion, from before those controls existed) but "clicking
    // it while over-ceiling never issues a single billed call": the pool's
    // own function-level refusal (startBulkScan, checkBulkScanSelection) is
    // what's authoritative here, never button absence. The button itself is
    // NOT ceiling-gated (enablement is only selection-non-empty AND no-live-
    // run — the ceiling is surfaced via the refusal message above, never
    // mirrored into UI enablement), so it is clickable, and a click must
    // still refuse before touching the network.
    let scanCalls = 0;
    await page.route(`**/workspace/${URL_KEY}/api/scan/*`, (route) => {
      scanCalls++;
      route.fulfill({ json: {} });
    });
    const scanBtn = page.locator('#obs-due-scan-selected');
    await expect(scanBtn).toBeEnabled();
    await scanBtn.click();
    await expect(refusal).toContainText('scan 40 at a time');
    expect(scanCalls, 'an over-ceiling click must never issue a single scan call').toBe(0);
    await expect(page.locator('#obs-due-stop')).toBeHidden();
  });

  // The fourth element the finding-3 styling fix covers, and the one the
  // review named explicitly: `.obs-bulk-scan-quota-note` renders only on the
  // free-tier branch of renderBulkScanDisclaimer, so it needs its own session.
  // `/test/set-session?freeTierEnabled=true` sets `session.freeTierEnabled`,
  // and the Playwright web server starts with `OPENROUTER_API_KEY=` and
  // `OPENROUTER_FREE_TIER_KEY=` explicitly empty (playwright.config.js), so
  // `getOpenRouterSource` deterministically returns 'free' here — no
  // dependence on the developer's own .env.
  test('the free-tier quota note renders as its own muted small-print paragraph, not 16px body copy', async ({ page }) => {
    await page.route(SCAN_DUE_ROUTE, (route) => route.fulfill({
      json: {
        items: [{ issueId: 'issue-1', issueIdentifier: 'LIN-1', dueStatus: true }],
        nextCursor: null,
        pageCandidateCount: 1,
        totalCandidateCount: 1,
      },
    }));
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&freeTierEnabled=true`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.click('#obs-tabs [data-view="due"]');

    const quotaNote = page.locator('#obs-due-bulk-quota-note');
    await expect(quotaNote).toBeVisible();
    await expect(quotaNote).toContainText('free tier');
    await expect(quotaNote).toHaveCSS('font-size', '12.48px');
    await expect(quotaNote).not.toHaveCSS('max-width', 'none');

    // Two budget gates, disclosed as two separate paragraphs (§B.9) — the
    // quota note must not have been folded into the dollar-estimate
    // disclaimer, and both must stay small print beside each other.
    await expect(page.locator('#obs-due-bulk-disclaimer')).toHaveCSS('font-size', '12.48px');
    await expect(page.locator('#obs-due-bulk-quota-note')).not.toHaveText(
      await page.locator('#obs-due-bulk-disclaimer').innerText()
    );

    // LIN-2701 §B.7: the control now exists on both tiers — it is not
    // itself free-tier-gated; only the quota disclosure above is.
    await expect(page.locator('#obs-due-scan-selected')).toBeVisible();
  });

  // Review N3 (LIN-2706 PR #1424): the per-row checkbox's accessible name,
  // asserted against the real accessibility tree rather than the HTML string
  // the unit test can see.
  test('every per-row checkbox has an accessible name naming the task it selects', async ({ page }) => {
    await page.route(SCAN_DUE_ROUTE, (route) => route.fulfill({
      json: {
        items: [
          { issueId: 'issue-1', issueIdentifier: 'LIN-1', dueStatus: true },
          { issueId: 'issue-2', issueIdentifier: 'LIN-2', dueStatus: false },
        ],
        nextCursor: null,
        pageCandidateCount: 2,
        totalCandidateCount: 2,
      },
    }));
    await openDueTab(page);
    await expect(page.locator('#obs-due-list .obs-due-select')).toHaveCount(2);

    await expect(page.getByRole('checkbox', { name: 'select LIN-1' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'select LIN-2' })).toBeVisible();

    // The name survives a repaint (select-all re-renders every row from
    // dueLoadedItems), so it is a property of the renderer, not of first paint.
    await page.locator('#obs-due-select-all').check();
    await expect(page.getByRole('checkbox', { name: 'select LIN-1' })).toBeChecked();
  });
});
