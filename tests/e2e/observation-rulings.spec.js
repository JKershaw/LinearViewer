import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';
import { seedQuestion } from '../fixtures/question-records.js';

// LIN-1728 Phase 3/4 — the escalation surface: the ambient "waiting on you" nav badge and the Rulings tab. LIN-4541: a
// ruling is an open question record addressed to the person (the old decision rows, their option buttons, the proposed
// answers and the bulk bar retired with the ruling machinery), so these specs seed a question record through the test seam
// (tests/fixtures/question-records.js) and the card's answer path is covered by tests/e2e/lin-4532-question-surfaces.spec.js.

let URL_KEY;
let OBSERVATION_URL;

test.beforeEach(async ({ page, workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;
  // LIN-4541: a ruling is a question record, so each test starts with none.
  await page.request.get(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

// One open question the signed-in account was asked, filed under `ticket` (no run behind it: the badge and the tab read the
// question records, not a run).
const seedRulingQuestion = (page, ticket) => seedQuestion(page, URL_KEY, { ticket, asks: `Proceed with ${ticket}?`, options: ['Approve', 'Reject'], recommended: 'Approve' });

test.describe('Rulings tab (LIN-1728 Phase 4)', () => {
  test('the Rulings tab renders alongside Runs (LIN-3983)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    const tabs = page.locator('[data-testid^="obs-tab-"]');
    await expect(tabs).toHaveCount(2);
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).toBeVisible();
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).not.toHaveClass(/is-active/);
  });
});

test.describe('Ambient rulings nav badge (LIN-1728 Phase 3)', () => {
  // The badge's poll (public/common.js's initRulingsBadge/updateRulingsBadge)
  // is loaded on EVERY page that renders the badge markup, including
  // Observation (LIN-1728 review F7 — it used to live in public/app.js,
  // which Observation never loads, so the badge there was permanently dead:
  // no initial count, no live updates, and the two `window.updateRulingsBadge`
  // guards in the press handler could never fire). Exercised on the projects
  // page here; the Observation-specific coverage is below.
  test('hidden with no rulings, shows a workspace-scoped count once one exists, gated on the dispatch flag like the queue badge', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toBeAttached();
    await expect(badge).toHaveClass(/hidden/);

    await seedRulingQuestion(page, 'LIN-1728-B');
    // The page's own initRulingsBadge() already read+cached a count-0 result on
    // load (before the seed above) — drop the server-side sessionsFeedCache
    // entry so the next read is a cold miss (fresh, synchronous) rather than a
    // stale-while-revalidate hit inside the still-warm 5s TTL window
    // (lib/sessions-feed-cache.js).
    await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);

    // Drive the real client function directly rather than waiting out the 5s
    // RULINGS_POLL_INTERVAL_MS timer — same determinism trade the existing
    // queue-badge e2e coverage makes.
    await page.evaluate((urlKey) => window.updateRulingsBadge(urlKey), URL_KEY);
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.rulings-count')).toHaveText('1 question');

    // Server-side scoping check: the count comes from `req.session.workspaces`,
    // never fleet-wide.
    const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/rulings`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.workspaces.map(w => w.urlKey)).toContain(URL_KEY);
  });

  test('absent when the workspace has no way to run (LIN-3849)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=0`);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-rulings-badge]')).toHaveCount(0);
  });

  test('LIN-1728 review F7: the badge actually initializes and updates on the Observation page itself', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await seedRulingQuestion(page, 'LIN-1728-B7');

    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');

    // Before the fix this was permanently dead on Observation: no seeded
    // count on load (initRulingsBadge lived in app.js, which Observation
    // never loads).
    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toBeAttached();
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.rulings-count')).toHaveText('1 question');
    expect(await page.evaluate(() => typeof window.updateRulingsBadge)).toBe('function');
  });

  test('LIN-1728 review F6: the badge is a real link into the Rulings tab, not a button that does nothing', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await seedRulingQuestion(page, 'LIN-1728-B6');

    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator('[data-rulings-badge]');
    await expect(badge).toHaveJSProperty('tagName', 'A');
    await expect(badge).toHaveAttribute('href', `/workspace/${URL_KEY}/observation?view=rulings`);

    await badge.click();
    await page.waitForURL(`**/workspace/${URL_KEY}/observation?view=rulings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator(SELECTORS.observation.tab('rulings'))).toHaveClass(/is-active/);
    await expect(page.locator(SELECTORS.observation.rulingsSection)).toBeVisible();
    await expect(page.locator('[data-testid="ruling-question-row"]').filter({ hasText: 'LIN-1728-B6' })).toBeVisible();
  });
});

// LIN-2191 (open question from the LIN-1728 plan): a second badge in
// `.nav-primary-row`'s `.nav-actions` risks reproducing/worsening the
// pre-existing ≤320px header-clearance breach that ticket already tracks.
// Measured here, not assumed — see the test body for the verdict this feeds.
//
// LIN-1728 review (`2d47a7c8`, test-quality note) + re-review (`9c5b22f6`,
// G2): the original version of this test only counted distinct
// `.nav-primary-row > *` top positions. Both badges live inside
// `.nav-actions`, a SINGLE direct child of `.nav-primary-row`, so that metric
// can see `.nav-actions` as a whole wrapping onto row 2 of the two-row header
// (`.nav-primary-row` is `flex-wrap: wrap`, public/style.css) but is blind to
// growth/overflow happening INSIDE `.nav-actions` itself — the actual risk a
// second badge adds, since `.nav-actions` is `display:flex` with NO
// `flex-wrap` set anywhere, so its own children can only overflow, never
// wrap onto their own line. The two failure modes are independent, so this
// measures BOTH: the parent row's wrap count (restored) and `.nav-actions`'
// own internal child-row count plus horizontal overflow (`scrollWidth` vs
// `clientWidth`).
//
// LIN-1728 close-out (review `5ac8e83f`, H1): the three metrics above are all
// pinned by CSS structure and cannot move, so none of them is the guard —
// keep them for the shape they document, but do not read them as coverage.
// `parentRows` is already at its structural maximum of 2 at 320px (the row has
// three children, the wordmark, `.nav-filters` and `.nav-actions`, over two lines: LIN-4009);
// `.nav-actions` sets no width and no `overflow-x` (`public/style.css:616-620`),
// so `scrollWidth === clientWidth` by construction and `overflowPx` is always
// exactly 0; and `align-items: baseline` puts the `<a>` badge ~2px above the
// `<button>` badges, so `childRows` reads 2 in every state — rounding noise
// compared against rounding noise. The review injected `min-width: 900px` on
// the rulings badge and all three numbers were unchanged (2 / 2 / 0) while the
// page itself blew out from 320px to 1029px.
//
// `document.body.scrollWidth` is the metric that actually moves, so THAT is the
// assertion carrying this test: a second badge must not widen the page beyond
// the zero-badge baseline. The `pageWidth` case below is the one a regression
// fails on; the other three are descriptive.
test.describe('.nav-actions width at ≤320px with both badges visible (LIN-2191 follow-up check)', () => {
  test('two visible badges do not add wrapping or overflow beyond the pre-existing zero-badge shape', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const measure = () => {
      const primaryRow = document.querySelector('.nav-primary-row');
      const parentRows = primaryRow
        ? new Set(
            Array.from(primaryRow.children).map(el => Math.round(el.getBoundingClientRect().top))
          ).size
        : 0;
      const actions = document.querySelector('.nav-actions');
      if (!actions) return { parentRows, childRows: 0, overflowPx: 0, pageWidth: document.body.scrollWidth };
      const childRows = new Set(
        Array.from(actions.children).map(el => Math.round(el.getBoundingClientRect().top))
      ).size;
      const overflowPx = Math.max(0, actions.scrollWidth - actions.clientWidth);
      // The load-bearing metric (H1): unlike the three above, this one moves
      // when a badge grows past what the viewport can hold.
      const pageWidth = document.body.scrollWidth;
      return { parentRows, childRows, overflowPx, pageWidth };
    };

    // Baseline: both badges hidden (0 queued, 0 rulings) — today's shipped
    // zero-badge shape (NOT a single-badge shape — both are hidden here).
    const baseline = await page.evaluate(measure);

    // Force both badges visible (as if there were 1 queued item and 1 ruling) —
    // the worst case this ticket's plan flags, without needing a real queued
    // dispatch item seeded too.
    await page.evaluate(() => {
      document.querySelectorAll('[data-queue-badge], [data-rulings-badge]').forEach(b => b.classList.remove('hidden'));
    });
    const bothVisible = await page.evaluate(measure);

    // Not a strict "must never overflow/wrap" assertion — LIN-2191 already
    // tracks whatever header-clearance breach exists at ≤320px independent
    // of any badge (captured in `baseline` itself, not this comparison).
    // This guards specifically against a SECOND badge making the header
    // WORSE than the zero-badge shape already shipped, on both independent
    // failure modes: `.nav-primary-row` wrapping onto a second header row,
    // and `.nav-actions` overflowing internally. A bare reproduction of the
    // pre-existing breach is recorded (not silently absorbed) by this test's
    // own existence rather than by failing it.
    expect(bothVisible.parentRows, `.nav-primary-row grew from ${baseline.parentRows} row(s) to ${bothVisible.parentRows} at 320px with both badges visible`).toBeLessThanOrEqual(baseline.parentRows);
    expect(bothVisible.childRows, `.nav-actions grew from ${baseline.childRows} internal row(s) to ${bothVisible.childRows} at 320px with both badges visible`).toBeLessThanOrEqual(baseline.childRows);
    expect(bothVisible.overflowPx, `.nav-actions overflow grew from ${baseline.overflowPx}px to ${bothVisible.overflowPx}px at 320px with both badges visible`).toBeLessThanOrEqual(baseline.overflowPx);
    // The assertion that can actually fail (H1). `.nav-actions` grows 38px →
    // 218px inside the 320px viewport when both badges appear, and the page
    // width must stay put; a badge wide enough to push the document past the
    // viewport fails here and nowhere else.
    expect(bothVisible.pageWidth, `the page grew from ${baseline.pageWidth}px to ${bothVisible.pageWidth}px at a 320px viewport with both badges visible`).toBeLessThanOrEqual(baseline.pageWidth);
  });
});

// LIN-4009: on a phone the wordmark stays, and it leads the first line beside the actions, with the filters
// on a line of their own. The worst case for that line is both badges visible, so this asserts the wordmark
// and `.nav-actions` overlap vertically at every phone width the LIN-2191 guard covers and above.
test.describe('Phone header: the wordmark shares the first line with the actions (LIN-4009)', () => {
  test('both badges visible at 320-480px: the wordmark is visible and on the actions line', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    for (const width of [320, 360, 390, 412, 430, 480]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${URL_KEY}/`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => {
        document.querySelectorAll('[data-queue-badge], [data-rulings-badge]').forEach(b => b.classList.remove('hidden'));
      });
      const { visible, sameLine } = await page.evaluate(() => {
        const wordmark = document.querySelector('.nav-bar .wordmark').getBoundingClientRect();
        const actions = document.querySelector('.nav-actions').getBoundingClientRect();
        return {
          visible: wordmark.width > 0 && wordmark.height > 0,
          sameLine: wordmark.top < actions.bottom && actions.top < wordmark.bottom,
        };
      });
      expect(visible, `the wordmark must stay visible at ${width}px`).toBe(true);
      expect(sameLine, `the wordmark must share a line with .nav-actions at ${width}px`).toBe(true);
    }
  });
});
