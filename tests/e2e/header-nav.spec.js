import { test, expect } from '../fixtures/test-base.js';
import { swimLocalSeed } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';

// The navigation's mechanics, rewritten for the rail (LIN-4568, LIN-4342 piece 7). This file pinned the old bar from
// LIN-978 on: the header view switcher, its `⋯ more` overflow, its actions, its sticky pin and the clearance under it.
// Pieces 2 to 6 moved every page onto the frame (lib/components/frame.js) and piece 7 deleted the bar, so each case is
// read on the rail now, the person's places in their groups from lib/places.js, or retired with what it tested:
//   - the view links and their gates → the rail's places for the owner, a new user and a member (the reach change the
//     parent plan states: a member no longer sees Runs, KPIs, Prompts or Connect an agent in the rail; the pages work);
//   - the 44px tap targets and "reachable at 390 without scrolling" → the drawer behind ☰ in the phone band;
//   - the actions' order → the rail's counts (questions beside Home, queued on Dispatch) and its foot;
//   - the sticky pin and its clearance → the rail at 1280 and the band at 390, whose height `--nav-sticky-h` is;
//   - the `⋯ more` collapse, the strip's focus scrolling, the measured bar height (LIN-1286, LIN-2179, LIN-2189,
//     LIN-4037) → retired: the rail does not collapse (a named exception of the parent plan) and nothing is measured.
// The filter line's sweeps (LIN-2523, LIN-2529, LIN-2551) are unchanged below. Every frame rule across every page, for
// each viewer and both widths, is tests/e2e/frame-rules.spec.js's walk.

// The roadmap flag on, so a flagged place is in the Views group; the owner's runner key gives run controls.
const FLAGS = { roadmap: true };

/** The person's rail, as place keys in order. */
const railKeys = (page) => page.locator(SELECTORS.nav.railItems).evaluateAll(els => els.map(el => el.getAttribute('data-place')));

test.describe('The rail\'s places (LIN-978, LIN-3849, LIN-1247 → LIN-4342)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS, runnerKey: true });
  });

  test('the owner with run controls sees every group, flagged places included, on every page', async ({ page, localWorkerUrlKey }) => {
    for (const path of ['project', 'settings']) {
      await page.goto(`/workspace/${localWorkerUrlKey}/${path}`);
      // Live is on for an owner with a runner (its flag is an opt-out, lib/run-controls.js liveConsoleOn).
      expect(await railKeys(page), path).toEqual(['home', 'backlog', 'live', 'runs', 'swipe', 'swim', 'roadmap', 'dispatch', 'connect', 'kpis', 'prompts', 'settings']);
    }
    // The old footer's cross-view links never came back: the footer is the same everywhere and names no place.
    await expect(page.locator(SELECTORS.nav.footer).locator('[data-place]')).toHaveCount(0);
  });

  test('a new user without a runner: no Watch or Tools, and no flagged place without its flag', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: {}, runnerKey: false });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    expect(await railKeys(page)).toEqual(['home', 'backlog', 'swipe', 'swim', 'settings']);
    // The reach change: Connect an agent leaves the rail, but its page still works by URL (Settings › Agent access links it).
    const proxy = await page.goto(`/workspace/${localWorkerUrlKey}/proxy`);
    expect(proxy.status()).toBe(200);
    await expect(page.locator(SELECTORS.nav.heading)).toHaveText('Connect an agent');
  });

  test('Dispatch needs the OWNER: a member of a workspace that has a runner key sees no Tools and no queue count', async ({ page, localWorkerUrlKey }) => {
    const res = await page.request.get(`/test/set-workspace-ownership?urlKey=${localWorkerUrlKey}&state=foreign`);
    expect(res.ok()).toBe(true);
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    const keys = await railKeys(page);
    for (const gated of ['runs', 'dispatch', 'connect', 'kpis', 'prompts']) expect(keys, gated).not.toContain(gated);
    await expect(page.locator('[data-queue-badge]')).toHaveCount(0);
  });

  test('experimental views are places ONLY when their flag is on, each in its own slot (LIN-1247)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const experimental = ['collective', 'task-chat', 'ship', 'flight-companion', 'passage-planner', 'ship-biscuit'];
    await seedLocal(swimLocalSeed, { features: {} });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    for (const key of experimental) await expect(page.locator(SELECTORS.nav.place(key))).toHaveCount(0);

    await seedLocal(swimLocalSeed, {
      features: { collective: true, taskChat: true, ship: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true },
    });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    const views = await page.locator('[data-group="views"] .frame-rail__item').evaluateAll(els => els.map(el => el.getAttribute('data-place')));
    expect(views).toEqual(['swipe', 'swim', ...experimental]);
    // The camelCase gating flags never leak in as place keys.
    for (const flag of ['taskChat', 'flightCompanion', 'passagePlanner', 'shipBiscuit']) await expect(page.locator(SELECTORS.nav.place(flag))).toHaveCount(0);
  });

  // LIN-3912: the Next run page, its suggest endpoint and its flag are retired. A stored `nextRun: true` is dropped by
  // the feature-flag filter, and both retired URLs fall through to Express's default 404.
  test('the retired next-run URLs 404, and no next-run place appears even with the old flag stored (LIN-3912)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: { ...FLAGS, nextRun: true, flightCompanion: true } });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    await expect(page.locator(SELECTORS.nav.place('next-run'))).toHaveCount(0);
    expect((await page.request.get(`/workspace/${localWorkerUrlKey}/next-run`)).status()).toBe(404);
    expect((await page.request.post(`/workspace/${localWorkerUrlKey}/api/next-run/suggest`, { data: {} })).status()).toBe(404);
  });

  test('at 390px every place is a comfortable 44px tap target in the drawer', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    await page.locator(SELECTORS.nav.bandMenu).click();
    await expect(page.locator(SELECTORS.nav.rail)).toBeVisible();
    const heights = await page.locator(SELECTORS.nav.railItems).evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(5);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('at 390px the places are reachable without scrolling the page: ☰ is in the band at the top', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const menu = await page.locator(SELECTORS.nav.bandMenu).boundingBox();
    expect(menu.y).toBeLessThan(80);
    await page.locator(SELECTORS.nav.bandMenu).click();
    const swim = await page.locator(SELECTORS.nav.place('swim')).boundingBox();
    expect(swim.y + swim.height).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('The rail\'s counts and foot (LIN-1149, LIN-1728, LIN-2298 → LIN-4342)', () => {
  test('questions sit beside Home, queued on Dispatch, and the feedback trigger at the foot after the AI status', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: { ...FLAGS, feedbackWidget: true }, runnerKey: true });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    const rail = page.locator(SELECTORS.nav.rail);
    await expect(rail.locator('[data-place="home"] + [data-rulings-badge]')).toBeAttached();
    await expect(page.locator(SELECTORS.nav.place('dispatch')).locator('[data-queue-badge]')).toBeAttached();
    const foot = await rail.locator('.frame-rail__foot').evaluate(el => [...el.querySelectorAll('[data-place], [data-testid="footer-ai-status"], [data-testid="nav-feedback-trigger"]')]
      .map(c => c.getAttribute('data-place') || c.getAttribute('data-testid')));
    expect(foot).toEqual(['settings', 'footer-ai-status', 'nav-feedback-trigger']);
  });

  test('no search toggle on Home, Backlog, Runs or the Project backlog (LIN-4563: search is the rail\'s form)', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS, runnerKey: true });
    for (const path of ['', 'backlog', 'observation', 'project']) {
      await page.goto(`/workspace/${localWorkerUrlKey}/${path}`);
      await expect(page.locator('.search-toggle'), path || 'home').toHaveCount(0);
      await expect(page.locator(SELECTORS.nav.railSearch), path || 'home').toHaveCount(1);
    }
  });

  test('both counts are absent when run controls are off', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(swimLocalSeed, { features: {}, runnerKey: false });
    await page.goto(`/workspace/${localWorkerUrlKey}/project`);
    // The questions count shares the queue count's gate, deliberately (LIN-1728 Phase 3).
    await expect(page.locator('[data-queue-badge]')).toHaveCount(0);
    await expect(page.locator('[data-rulings-badge]')).toHaveCount(0);
  });
});

// LIN-1068: sticky chrome must ACTUALLY PIN (an `overflow-x: hidden` root once left the old bar inert; the root is
// `overflow-x: clip`), and the clearance that matters only when it pins must hold against the real pinned chrome. On a
// framed page that is the rail at desktop widths and the band on a phone. The page is made tall enough to scroll by a
// spacer appended to its <main> after load (a control, then the spacer); the pins read only the chrome.
test.describe('Sticky chrome pin + clearance (LIN-1068, LIN-984 → LIN-4342)', () => {
  test.beforeEach(async ({ seedLocal }) => {
    await seedLocal(swimLocalSeed, { features: FLAGS, runnerKey: true });
  });

  async function openTallPage(page, urlKey) {
    await page.goto(`/workspace/${urlKey}/project`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const main = document.querySelector('main');
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = 'Below the fold';
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      main.append(control, spacer);
    });
  }

  for (const [width, chrome] of [[1280, SELECTORS.nav.rail], [390, SELECTORS.nav.band]]) {
    test(`the ${width === 1280 ? 'rail' : 'band'} pins to the viewport top after scroll at ${width}px`, async ({ page, localWorkerUrlKey }) => {
      await page.setViewportSize({ width, height: 700 });
      await openTallPage(page, localWorkerUrlKey);
      await page.evaluate(() => window.scrollTo(0, 600));
      expect(await page.evaluate(() => window.scrollY), 'page must scroll for the pin to mean anything').toBeGreaterThan(0);
      const top = await page.locator(chrome).evaluate(el => el.getBoundingClientRect().top);
      expect(Math.abs(top)).toBeLessThanOrEqual(1);
    });
  }

  test('at 390px the pinned band does not intercept a control scrolled to the top (scroll-margin-top: --nav-sticky-h)', async ({ page, localWorkerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openTallPage(page, localWorkerUrlKey);
    await page.evaluate(() => window.scrollTo(0, 400));
    const settle = await page.evaluate(() => {
      const band = document.querySelector('[data-testid="frame-band"]');
      const bandBottom = band.getBoundingClientRect().bottom;
      const target = [...document.querySelectorAll('main button, main a[href]')].filter(e => e.offsetParent !== null).sort((a, b) => b.offsetTop - a.offsetTop)[0];
      target.scrollIntoView({ block: 'start' });
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
      return { top: rect.top, bandBottom, clickable: target === hit || target.contains(hit) };
    });
    expect(settle.top, 'the control must not be tucked under the band').toBeGreaterThanOrEqual(settle.bandBottom - 1);
    expect(settle.clickable, 'the band must not click-intercept the control').toBe(true);
  });

  // The token page-level fixed controls and tests/fixed-overlay-sweep.js read: the band's height on a phone, 0 on a
  // desktop, where nothing sticky crosses the page. With no bar left there is nothing to measure (LIN-4037 retired).
  for (const width of [360, 390, 430, 1280]) {
    test(`--nav-sticky-h is the band's height at ${width}px`, async ({ page, localWorkerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${localWorkerUrlKey}/project`);
      const { clearance, band } = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'height: var(--nav-sticky-h); position: absolute; visibility: hidden';
        document.body.appendChild(probe);
        const px = probe.getBoundingClientRect().height;
        probe.remove();
        const el = document.querySelector('[data-testid="frame-band"]');
        return { clearance: px, band: el.offsetParent === null ? 0 : el.offsetHeight };
      });
      expect(clearance).toBe(band);
      if (width === 1280) expect(clearance).toBe(0);
    });
  }
});


// LIN-2210 close-out ledger item 2: `.nav-action.login` (Sign in / GitHub / Jira
// on the landing preview pages' shared nav bar) had no mobile tap target — the
// existing 44px rule above is written against `.nav-item`, which `.nav-action`
// never carries. This targets the unauthenticated `/swipe` preview directly (no
// seedLocal/session needed — it is the landing bar, not a workspace nav), the
// same surface the review measured 18.7px → 44.0px on.
// LIN-4564: the preview sits in the public frame, so its sign-in path is the band's (renderPreviewSignIn).
test.describe('Landing preview nav auth tap target (LIN-2210)', () => {
  test('the preview\'s sign-in actions clear 44px on /swipe at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/swipe');
    await page.waitForLoadState('networkidle');

    const heights = await page.locator('[data-testid="frame-public-band"] .frame-public__action').evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().height)
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});

// LIN-2523: `.nav-filters` goes from 1 item (workspace) to 2 (+ team; the wordmark
// leads the row, outside the strip, since LIN-4009); on the four newly-selectored pages (swipe/swim/ship/roadmap) now
// that they thread real teams/selectedTeamId into renderNavBar. PINNED on the
// Linear test-token session (mirrors tests/e2e/error-handling.spec.js's own
// "Team Filtering" block) — the local provider declares zero teams
// (`fetchTeams` returns `[]`), so `swimLocalSeed`'s session would never
// exercise the data-present branch this sweep is checking. Swept across the
// same mobile widths tests/e2e/header-nav.spec.js's other density sweep uses
// (360/390/412/430) so this rides the same "does the strip actually still
// fit" concern, not just a desktop-only assertion.
// LIN-4564: the four selectored pages sit in the frame, so the team item is the filter line's (`SELECTORS.nav.filters`),
// the frame's `filters` slot, at the top of <main>; the workspace is the rail's.
test.describe('.nav-filters team-item mobile sweep (LIN-2523)', () => {
  const MOBILE_SWEEP_WIDTHS = [360, 390, 412, 430];
  const NEWLY_SELECTORED_PAGES = ['swipe', 'swim', 'ship', 'roadmap'];
  const FEATURES = encodeURIComponent(JSON.stringify({ roadmap: true, ship: true }));

  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}&features=${FEATURES}`);
    // Reset any team selection persisted for this {account, urlKey} by an
    // earlier spec (LIN-2521's resolveTeamSelection remembers the choice
    // across requests, independent of this test's own session) — an explicit
    // ?team=all clears it (LIN-727), so every test below starts from the
    // genuine "all" default rather than inheriting a stale filter.
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
  });

  for (const width of MOBILE_SWEEP_WIDTHS) {
    for (const pagePath of NEWLY_SELECTORED_PAGES) {
      test(`${pagePath} at ${width}px: the filter line carries the team item, nothing scrolls sideways`, async ({ page, workerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/workspace/${workerUrlKey}/${pagePath}`);
        await page.waitForLoadState('networkidle');

        const line = page.locator(SELECTORS.nav.filters);
        await expect(line).toBeVisible();
        const items = await line.evaluate(el => [...el.children].filter(c => c.classList.contains('nav-item')).length);
        expect(items, `${pagePath} at ${width}px carries the team item alone (no assignee off Home and Backlog)`).toBe(1);
        await expect(page.locator(SELECTORS.nav.rail)).toHaveCount(1);
        await expect(line.locator('#team-toggle')).toHaveText('all');
        const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(scrolls, `no sideways scroll at ${width}px`).toBe(false);
      });
    }

    // LIN-4565 read this baseline on the old bar's page; LIN-4568 deleted the bar. A page that filters nothing draws no
    // filter line at all (Settings), and its workspace is the rail's.
    test(`a non-filterable page (Settings) at ${width}px draws no filter line — the baseline this sweep is measured against`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/settings`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.nav.filters)).toHaveCount(0);
      await expect(page.locator('#team-toggle')).toHaveCount(0);
    });
  }

  test('picking a team marks the selection in the filter line, on each newly-selectored page', async ({ page, workerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const pagePath of NEWLY_SELECTORED_PAGES) {
      await page.goto(`/workspace/${workerUrlKey}/${pagePath}?team=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator(`${SELECTORS.nav.filters} #team-toggle`), pagePath).toHaveText('Engineering');
    }
  });

  test.afterAll(async ({ browser, workerUrlKey }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
    await context.close();
  });
});

// LIN-2529: `.nav-filters` goes from 2 items (workspace + team) to 3 (+ assignee) on the DASHBOARD ONLY, now that renderPage threads
// availableAssignees/selectedAssignee/canFilterByMe into renderNavBar
// (LIN-2526 computed the values; LIN-2527 built the navbar functions; this is
// the first point real data actually reaches them). PINNED on the Linear
// test-token session — same reasoning as the LIN-2523 sweep above: testMockData
// carries real assignee names (Alice/Bob/Charlie), so the dashboard-only
// data-present branch this sweep checks is actually exercised. Swept across
// the same mobile widths as the density sweeps above, plus a same-width
// regression guard that /swim (team-reached, NOT assignee-reached) stays at 3
// — proving the dashboard-only boundary holds under the same viewport.
test.describe('.nav-filters assignee-item mobile sweep (LIN-2529)', () => {
  const MOBILE_SWEEP_WIDTHS = [360, 390, 412, 430];

  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    // Reset any team selection persisted by an earlier spec (same reasoning as
    // the LIN-2523 block above — resolveTeamSelection remembers choices across
    // requests independent of this test's own session).
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
  });

  for (const width of MOBILE_SWEEP_WIDTHS) {
    // The wrap question this sweep deliberately left open (LIN-2527 AC5's "no
    // .nav-primary-row wrap" assertion) is now CLOSED by the LIN-2551 block
    // at the bottom of this file, which measures the strip rather than
    // counting it. This sweep keeps asserting item COUNT — a distinct
    // property (the assignee item is PRESENT on the dashboard and absent
    // elsewhere), which a wrap measurement does not cover.
    // LIN-4563: Home's selectors are its filter line's now (the workspace is the rail's), so the count there is team +
    // assignee (2 items), and no old bar is drawn.
    test(`dashboard at ${width}px: the filter line carries the assignee item beside the team item (2 items)`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/`);
      await page.waitForLoadState('networkidle');

      const line = page.locator(SELECTORS.nav.filters);
      await expect(line).toBeVisible();
      const items = await line.evaluate(el => [...el.children].filter(c => c.classList.contains('nav-item')).length);
      expect(items, `dashboard at ${width}px must carry team + assignee (2) in its filter line`).toBe(2);
      await expect(page.locator(SELECTORS.nav.rail)).toHaveCount(1);

      await expect(line.locator('#assignee-toggle')).toBeVisible();
      await expect(line.locator('#assignee-toggle')).toHaveText('all');
    });

    // LIN-4564: Swim sits in the frame; its filter line carries the team alone.
    test(`/swim at ${width}px carries the team alone — assignee must not leak onto a team-reached, non-dashboard page`, async ({ page, workerUrlKey }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace/${workerUrlKey}/swim`);
      await page.waitForLoadState('networkidle');

      const line = page.locator(SELECTORS.nav.filters);
      const items = await line.evaluate(el => [...el.children].filter(c => c.classList.contains('nav-item')).length);
      expect(items).toBe(1);
      await expect(page.locator('#assignee-toggle')).toHaveCount(0);
    });
  }

  test('picking an assignee marks the selection and keeps the filter line at 2 items', async ({ page, workerUrlKey }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/workspace/${workerUrlKey}/?assignee=Alice`);
    await page.waitForLoadState('networkidle');

    const line = page.locator(SELECTORS.nav.filters);
    const items = await line.evaluate(el => [...el.children].filter(c => c.classList.contains('nav-item')).length);
    expect(items).toBe(2);
    await expect(line.locator('#assignee-toggle')).toHaveText('Alice');
  });
});

// LIN-2551 — the mobile density budget, measured rather than counted.
//
// This discharges LIN-2516 ledger item L4. The LIN-2529 sweep above asserts
// `.nav-filters` CHILD COUNTS at these widths and never wrap-freedom, which is
// exactly why CI stayed green while the strip rendered three rows deep on
// every phone-sized viewport: a count of 4 is satisfied whether those four
// items sit on one row or four. What is asserted here is the property the
// count cannot see: how many rows the strip's items actually take.
//
// LIN-4024 (John's ruling `lin4024-header-name`) changed the shape this block
// pins. At phone widths (every width swept here is inside the 480px phone
// block) the workspace name has a FULL LINE OF ITS OWN under the wordmark and
// is shown in full; before, it shared the strip and was cut to 8ch ("Local W…").
// Team and assignee keep ONE row below it, and that row is what the budget now
// measures. Rows are read from the items' own tops, not from the strip's
// height, because the strip is two lines by design.
//
// SCOPE, stated precisely so it is not read as more than it is: this pins
// `.nav-filters`. It does NOT pin `.nav-primary-row`, which puts `.nav-actions`
// on the wordmark's line at these widths (LIN-4009). The 481-640px band keeps
// the strip on one row with every value capped at 8ch, and is not swept here.
//
// EVERY FILTER STATE IS SWEPT, and that is the load-bearing part. A budget
// tuned against the default `all`/`all` fits and then overflows the moment a
// real value replaces either one — measured, not theorised: an earlier
// revision of this fix passed at all four widths with `all`/`all` while still
// rendering three rows at 412px and 430px with a team selected. Sweeping only
// the default state is how a sweep passes over the very bug it exists for.

// The Engineering team from lib/sample-data/mock-data.js — the ID, not the
// name: `?team=` resolves through matchTeamId, and a bare name silently
// degrades to unfiltered, which would quietly hand a "team selected" test the
// `all` state it was written to avoid.
const TEST_TEAM_ENGINEERING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const DENSITY_FILTER_STATES = [
  { label: 'no filters', team: 'all', assignee: 'all' },
  { label: 'assignee only', team: 'all', assignee: 'Charlie' },
  { label: 'team only', team: TEST_TEAM_ENGINEERING_ID, assignee: 'all' },
  { label: 'team + assignee (worst case)', team: TEST_TEAM_ENGINEERING_ID, assignee: 'Charlie' }
];

// The four LIN-2529 sweep widths, plus 375px — between two of them, guarding
// the assumption that passing at 360 and 390 implies passing in between — and
// 480px, the top of the phone budget's own media query.
const DENSITY_SWEEP_WIDTHS = [360, 375, 390, 412, 430, 480];

// One row of `.nav-item`s, whose mobile `min-height` is 44px (the tap-target
// rule above). The allowance over 44 absorbs line-height and baseline-
// alignment jitter without being loose enough to admit a second row, which
// lands near 88px and which the pre-fix three-row state measured at 94-101px.
const SINGLE_ROW_MAX_HEIGHT = 60;

// The test session's workspace (routes/test.js `/test/set-session`). It is 14
// characters, so the old 8ch cap cut it, the way it cut "Local Workspace".
const TEST_WORKSPACE_NAME = 'Test Workspace';

// LIN-4563: `path` '' is Home (its filter line). The assignee applies on Home and Backlog.
function densityUrl(urlKey, state, path = '') {
  return `/workspace/${urlKey}/${path}?team=${encodeURIComponent(state.team)}&assignee=${encodeURIComponent(state.assignee)}`;
}

// LIN-4563: Home's filter line (the frame's `filters` slot): its team and assignee items, the rows they take (distinct
// tops, within a few px of baseline jitter), their height, whether a value sits past the viewport, and sideways scroll.
function readFilterLineShape() {
  const box = (el) => el.getBoundingClientRect();
  const line = document.querySelector('[data-testid="frame-filters"]');
  const items = [...line.querySelectorAll(':scope > .nav-item')];
  const tops = items.map(i => Math.round(box(i).top)).sort((a, b) => a - b);
  const rows = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 4).length;
  const viewport = document.documentElement.clientWidth;
  return {
    items: items.length,
    rows,
    height: items.length ? Math.round(Math.max(...items.map(i => box(i).bottom)) - Math.min(...items.map(i => box(i).top))) : 0,
    offscreen: [...line.querySelectorAll('.nav-value')].filter(v => box(v).right > viewport + 1).map(v => v.id || v.className),
    scrolls: document.documentElement.scrollWidth > window.innerWidth,
  };
}

// LIN-4563: the budget is swept on Home's filter line (team and assignee share one row, no control off the viewport,
// values legible). LIN-4568: the old bar's half of it (the workspace name on a line of its own, and the clearance under
// the bar) went with the bar; the workspace is the rail's, behind ☰ on a phone.
test.describe('.nav-filters mobile density budget (LIN-2551, reshaped by LIN-4024)', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
  });

  test.afterAll(async ({ browser, workerUrlKey }) => {
    // The `?team=` visits are remembered per account and workspace; restore the default for later specs on this key.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await page.goto(`/workspace/${workerUrlKey}/?team=all`);
    await context.close();
  });

  for (const width of DENSITY_SWEEP_WIDTHS) {
    for (const state of DENSITY_FILTER_STATES) {
      test(`dashboard at ${width}px, ${state.label}: team and assignee share one row in the filter line, nothing scrolls sideways`, async ({ page, workerUrlKey }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(densityUrl(workerUrlKey, state));
        await page.waitForLoadState('networkidle');

        await expect(page.locator(SELECTORS.nav.filters)).toBeVisible();
        const shape = await page.evaluate(readFilterLineShape);
        expect(shape.items, 'the filter line carries team and assignee').toBe(2);
        expect(shape.rows, `team and assignee must share one row at ${width}px with ${state.label}`).toBe(1);
        expect(shape.height, `the filter row at ${width}px with ${state.label} measured ${shape.height}px against a ${SINGLE_ROW_MAX_HEIGHT}px single-row bound`).toBeLessThanOrEqual(SINGLE_ROW_MAX_HEIGHT);
        expect(shape.offscreen, `every filter control must sit inside the ${width}px viewport`).toEqual([]);
        expect(shape.scrolls, `no sideways scroll at ${width}px`).toBe(false);
      });
    }

  }

  test('the filter line still shows what it is showing — values are not crushed away to fit', async ({ page, workerUrlKey }) => {
    // The guard against "passing" the assertions above by shrinking every value to nothing. A `nowrap` revision of the
    // LIN-2551 fix rendered team and assignee values 0px and 4px wide at 360px, and would have satisfied both a height
    // and an off-viewport check.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(densityUrl(workerUrlKey, DENSITY_FILTER_STATES[3]));
    await page.waitForLoadState('networkidle');

    const values = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="frame-filters"] .nav-value')].map(v => ({
        text: v.textContent.trim(),
        width: Math.round(v.getBoundingClientRect().width),
        truncated: v.scrollWidth > v.clientWidth + 1
      }))
    );

    expect(values.length).toBe(2);
    const LEGIBLE_MIN_PX = 30;
    for (const v of values) {
      expect(v.width, `"${v.text}" must still render legibly, not be shrunk to nothing`).toBeGreaterThanOrEqual(LEGIBLE_MIN_PX);
    }
    // The real selected values under test, not the defaults: `?team=` resolves by id, and a value that silently degraded
    // to `all` would quietly measure the wrong thing.
    const [team, assignee] = values;
    expect(team.text, 'the selected team must be the value under test, not the `all` default').toBe('Engineering');
    expect(assignee.text, 'the selected assignee must be the value under test').toBe('Charlie');
    expect(assignee.truncated, 'a short real assignee name should sit under the cap, not at it').toBe(false);
  });

  test('320px — below the swept range, the filter line degrades by wrapping rather than by clipping', async ({ page, workerUrlKey }) => {
    // 320px is narrower than any width this block covers: a second row is allowed, a third is not, and nothing clips.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(densityUrl(workerUrlKey, DENSITY_FILTER_STATES[3]));
    await page.waitForLoadState('networkidle');
    const line = await page.evaluate(readFilterLineShape);
    expect(line.rows, 'at 320px team and assignee may take a second row, but never a third').toBeLessThanOrEqual(2);
    expect(line.offscreen, 'wrapping is the degradation; clipping a control is not').toEqual([]);

  });
});
