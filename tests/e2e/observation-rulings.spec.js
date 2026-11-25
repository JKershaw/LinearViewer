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

test.describe('Questions tab (LIN-1728 Phase 4, named for questions by LIN-4553)', () => {
  test('the Questions tab renders alongside Runs (LIN-3983)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    const tabs = page.locator('[data-testid^="obs-tab-"]');
    await expect(tabs).toHaveCount(2);
    await expect(page.locator(SELECTORS.observation.tab('questions'))).toHaveText('Questions');
    await expect(page.locator(SELECTORS.observation.tab('questions'))).not.toHaveClass(/is-active/);
  });
});

const HOME_BADGE = '[data-rulings-badge]:not([data-testid="band-questions"])';

test.describe('Ambient rulings nav badge (LIN-1728 Phase 3)', () => {
  // The badge's poll (public/common.js's initRulingsBadge/updateRulingsBadge)
  // is loaded on EVERY page that renders the badge markup, including
  // Observation (LIN-1728 review F7 — it used to live in public/app.js,
  // which Observation never loads, so the badge there was permanently dead:
  // no initial count, no live updates, and the two `window.updateRulingsBadge`
  // guards in the press handler could never fire). Exercised on the projects
  // page here; the Observation-specific coverage is below. LIN-4563: Home sits in
  // the frame, which draws the count on Home's rail item and in the phone band;
  // HOME_BADGE is the rail's (updateRulingsBadge writes every copy).
  test('hidden with no rulings, shows a workspace-scoped count once one exists, gated on the dispatch flag like the queue badge', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await page.goto(`/workspace/${URL_KEY}/`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator(HOME_BADGE);
    await expect(badge).toBeAttached();
    await expect(badge).toHaveClass(/hidden/);
    await expect(page.locator(SELECTORS.nav.bandQuestions)).toHaveClass(/hidden/);

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
    await expect(page.locator(`${SELECTORS.nav.bandQuestions} .rulings-count`), 'every copy is written').toHaveText('1 question');

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
    // LIN-4564: Observation (Runs) sits in the frame; its count is the rail's, beside Home.
    const badge = page.locator(SELECTORS.nav.railQuestions);
    await expect(badge).toBeAttached();
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge.locator('.rulings-count')).toHaveText('1 question');
    expect(await page.evaluate(() => typeof window.updateRulingsBadge)).toBe('function');
  });

  // LIN-4563: on the bar (a page not yet moved; Home's rail count leads to Home's questions instead, frame-rules.spec.js).
  // LIN-4564: Swim moved onto the frame, so the old bar was read on Settings. LIN-4566: Settings moved onto the frame
  // too, the last page whose bar ran a script, so F6 is read on the rail's count: still a real link, now to the questions
  // on Home (the plan's "waiting" rule), not the Runs page's Questions tab.
  test('LIN-1728 review F6: the badge is a real link to the questions, not a button that does nothing', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    await seedRulingQuestion(page, 'LIN-1728-B6');

    await page.goto(`/workspace/${URL_KEY}/settings`);
    await page.waitForLoadState('networkidle');

    const badge = page.locator(SELECTORS.nav.railQuestions);
    await expect(badge).toHaveJSProperty('tagName', 'A');
    await expect(badge).toHaveAttribute('href', `/workspace/${URL_KEY}/#waiting-on-you`);
    await expect(badge).not.toHaveClass(/hidden/);

    await badge.click();
    await page.waitForURL(`**/workspace/${URL_KEY}/#waiting-on-you`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#waiting-on-you')).toBeVisible();
  });
});

// LIN-2191 and LIN-4009 guarded the old bar's phone header: a second badge must not wrap `.nav-actions` or push the page
// wider, and the wordmark must share the actions' line. LIN-4568 deleted the bar (it was last drawn on the Project
// backlog). On a phone the frame's band is the header: ☰, the page's name, the questions count and Search, one row.
// The worst case is the count shown, so this asserts the band stays one line and the page does not grow sideways
// with it, at every phone width those guards covered.
test.describe('Phone band with the questions count shown (LIN-2191, LIN-4009, as LIN-4568 left them)', () => {
  test('at 320-480px the band holds one line and the page does not widen when the count shows', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}&runnerKey=1`);
    await clearRuns(page);
    for (const width of [320, 360, 390, 412, 430, 480]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${URL_KEY}/project`);
      await page.waitForLoadState('networkidle');
      // One line: every shown child of the band crosses the band's middle (they are centred, so their tops differ by
      // height), none spills past its right edge, and the band does not overflow its own box.
      const measure = () => page.evaluate(() => {
        const band = document.querySelector('[data-testid="frame-band"]');
        const b = band.getBoundingClientRect();
        const mid = b.top + b.height / 2;
        const shown = [...band.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
        const offLine = shown.filter((r) => !(r.top < mid && r.bottom > mid) || r.right > b.right + 1).length;
        const overflow = band.scrollHeight > band.clientHeight + 1 || band.scrollWidth > band.clientWidth + 1;
        return { rows: offLine === 0 && !overflow ? 1 : 1 + offLine, pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
      });
      const hidden = await measure();
      await page.evaluate(() => {
        document.querySelectorAll('[data-rulings-badge]').forEach((b) => { b.classList.remove('hidden'); b.querySelector('.rulings-count').textContent = '12 questions'; });
      });
      const shown = await measure();
      expect(shown.rows, `the band wraps at ${width}px with the count shown`).toBe(1);
      expect(shown.pageWidth, `the page grew sideways at ${width}px when the count showed`).toBeLessThanOrEqual(Math.max(hidden.pageWidth, shown.viewport));
    }
  });
});
