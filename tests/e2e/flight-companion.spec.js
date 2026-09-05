import { test, expect } from '../fixtures/test-base.js';

// LIN-971: Flight Companion route-gating + settings exposure, plus the
// LIN-2443-ledger layout/client behaviours routed into this ticket. Mirrors
// tests/e2e/next-run.spec.js / task-chat.spec.js in shape (local featuresParam
// helper, workerUrlKey per-worker isolation, no teardown/clear calls).
//
// Deliberately NOT covered here (owned elsewhere, do not duplicate):
//   - nav-overflow exposure of flight-companion -> tests/e2e/header-nav.spec.js
//   - +proxy one-click copy behaviour -> tests/e2e/flight-companion-proxy-copy.spec.js
//   - real SSE / turn-endpoint contract over a real HTTP client -> named gap,
//     recorded on LIN-971 (LIN-2432/LIN-2443 close-outs), no new obligation here.
//
// No model calls anywhere in this file: the turn endpoint has no server-side
// mock seam (unlike task-chat/next-run/ship-biscuit's shouldMockAi), so the
// completed-pill and silent-auto-wake tests intercept the turn POST in the
// browser via page.route before it ever reaches Express (mockTurn below).

let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/flight-companion`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
});

/**
 * Fulfils the turn endpoint's POST with a synthetic SSE body before it
 * reaches Express — no model call is possible. Wire format read from
 * routes/flight-companion.js's sendSSE / public/flight-companion.js's
 * readSSEStream: `event: <type>\ndata: <json>\n\n` frames.
 */
async function mockTurn(page, { token } = {}) {
  await page.route('**/api/flight-companion/turn', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const frames = token
      ? `event: token\ndata: ${JSON.stringify({ token })}\n\nevent: done\ndata: {}\n\n`
      : `event: done\ndata: {}\n\n`;
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
}

test.describe('Flight Companion Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);

      const res = await page.request.get(PAGE_URL, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers()['location']).toBe(`/workspace/${URL_KEY}/settings`);

      // Negative control: a real browser navigation lands on Settings, not a
      // flight-companion page shell (idiom: ship.spec.js:463-470).
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.locator('.flight-companion-page')).toHaveCount(0);
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      const res = await page.request.get(PAGE_URL, { maxRedirects: 0 });
      expect(res.status()).toBe(200);

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      // Title routes through the shared renderPageHeader primitive (LIN-975).
      await expect(page.locator('.page-header h1')).toHaveText('Flight Companion');

      // The kickoff prompt carries the FULL runtime origin, not just the path.
      const origin = new URL(page.url()).origin;
      await expect(page.locator('#flight-companion-prompt')).toContainText(`${origin}/api/proxy`);
    });

    test('settings toggle exists exactly once and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      // Positive control — the Experimental section actually rendered.
      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();

      // lib/render-settings.js emits data-feature="<key>" from TWO distinct
      // renderers (renderFeatureToggle + renderWorkspaceFeatureToggle) — pin
      // the count so a future collision on this key is caught.
      const toggle = page.locator('[data-feature="flightCompanion"]');
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link is hidden when off, visible when on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      // Positive control — Settings actually rendered, so the zero-count
      // check below is not vacuous.
      await expect(page.locator('[data-testid="settings-section-experimental"]')).toBeVisible();
      await expect(page.locator('.settings-action:has-text("open the flight companion")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the flight companion")')).toBeVisible();
    });
  });

  test.describe('LIN-2443 layout + client behaviour (real DOM, no model call)', () => {
    test.beforeEach(async ({ page }) => {
      // Installed before the flag-on page load, structurally, so no test in
      // this block can slip through to a live turn request even if its own
      // scenario doesn't touch the composer (plan-review F3).
      await mockTurn(page);
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('section order: Chat -> How to use -> Kickoff prompt -> Latest observer report', async ({ page }) => {
      // Scoped to .flight-companion-page so this can't pick up an unrelated
      // .section-header from the nav or footer.
      const titles = await page.locator('.flight-companion-page .section-header').allTextContents();
      expect(titles.map((t) => t.trim())).toEqual([
        'Chat',
        'How to use',
        'Kickoff prompt',
        'Latest observer report (read-only)',
      ]);
    });

    test('kickoff prompt disclosure is collapsed by default; copy/+proxy actions stay usable without expanding it', async ({ page }) => {
      // This one test also needs the proxy flag, layered locally without
      // perturbing the shared beforeEach's flag-on-only session for the rest
      // of this block.
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true, proxy: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      const details = page.locator('details.disclosure');
      await expect(details).toHaveCount(1);
      expect(await details.getAttribute('open')).toBeNull();

      // .flight-companion-actions sits outside the <details> — a native
      // closed <details> hides its descendants, so this genuinely fails if
      // the actions were ever moved inside the disclosure. Not clicking
      // either control here: that's flight-companion-proxy-copy.spec.js's job.
      await expect(page.locator('#flight-companion-copy')).toBeVisible();
      await expect(page.locator('.prompt-proxy-toggle')).toBeVisible();
    });

    test('a completed companion message shows the real done status pill in the DOM', async ({ page }) => {
      // Override this test's mock with a token-bearing one so the assistant
      // bubble is actually created (an empty done never creates one).
      await mockTurn(page, { token: 'ack' });

      await page.locator('#flight-companion-question').fill('are you there?');
      await page.locator('#flight-companion-send').click();

      // .fc-msg-who is unique to the companion bubble (the whoClass passed
      // only by appendAssistantBubble; appendUserBubble carries no status
      // class) — no data-feature-style collision risk.
      const pill = page.locator('.fc-msg-who');
      await expect(pill).toHaveCount(1);
      await expect(pill).toHaveClass(/status-pill--done/);
      // False-positive guard: not still showing the class the bubble is
      // created with.
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);
    });

    // LIN-2632 beat 4 — the phone shape (Shape B, LIN-1412 D2). Below 600px
    // (public/flight-companion.css, the same @media (max-width: 600px)
    // breakpoint public/chat.css already establishes) `.flight-companion-
    // chat-section` becomes a `position: sticky; top: 0; height: 100dvh;`
    // flex column: the thread/empty-state pair (chat.css's
    // `--chat-thread-max-height` overridden to `none`, `flex: 1`) fills the
    // remaining space, and the composer — simply the last flex child — ends
    // up flush with the viewport's own bottom edge once the section is
    // scrolled to (stickiness is what lets a fixed-height section pin to the
    // viewport despite starting below the page's own nav/header, which this
    // page does not otherwise touch). Was Shape A by accident before this
    // beat: `.chat-thread` sat at chat.css's 40vh default (337.6px at this
    // viewport) inside an ordinary scrolling page.
    test.describe('Mobile viewport (390x844) — the phone shape (Shape B)', () => {
      // Scoped to only this test via test.use inside its own nested describe
      // — a file-wide override would silently change every other test's
      // layout, including nav-overflow rendering (owned by header-nav.spec.js).
      test.use({ viewport: { width: 390, height: 844 } });

      test('the thread fills far more than the old 40vh cap, and still scrolls once genuinely overflowed', async ({ page }) => {
        for (let i = 0; i < 6; i += 1) {
          await mockTurn(page, { token: `reply number ${i} — this is a longer synthetic companion message so the thread genuinely grows past the old 40vh cap.` });
          await page.locator('#flight-companion-question').fill(`question number ${i} about the current work in flight`);
          await page.locator('#flight-companion-send').click();
          await expect(page.locator('.fc-msg-who').nth(i)).toHaveClass(/status-pill--done/);
        }

        const thread = page.locator('#flight-companion-thread');
        const { scrollHeight, clientHeight } = await thread.evaluate((el) => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }));
        // The old cap was 337.6px (40vh @ 844). Shape B's thread fills the
        // remaining space in a ~one-viewport-tall column instead — genuinely
        // taller, not just "not smaller".
        expect(clientHeight).toBeGreaterThan(500);
        // Six long turns still outgrow even the taller box, so the thread's
        // OWN internal scroll (chat.css's overflow-y: auto) is still real.
        expect(scrollHeight).toBeGreaterThan(clientHeight);
      });

      test('the composer stays pinned to the viewport bottom across a whole range of scroll positions, not just one exact alignment, and survives a viewport shrink (keyboard-open proxy)', async ({ page }) => {
        await mockTurn(page, { token: 'ack' });
        await page.locator('#flight-companion-question').fill('are you there?');
        await page.locator('#flight-companion-send').click();
        await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

        // Scroll by an ARBITRARY amount past the header — not
        // scrollIntoViewIfNeeded's precise top-alignment, which would land
        // the composer in the same place whether or not the section is
        // actually sticky (a single top-aligned scroll always makes an
        // exactly-one-viewport-tall element fill the viewport, sticky or
        // not). `position: sticky` is what a real one-finger swipe needs:
        // ANY scroll position past the header pins the section to the
        // viewport top for the rest of its own height, so the composer ends
        // up flush with the viewport bottom regardless of exactly how far
        // the user scrolled — not just at one precise stopping point.
        await page.mouse.wheel(0, 350);
        await page.waitForTimeout(50);
        await expect(page.locator('#flight-companion-send')).toBeInViewport();

        // A different, larger arbitrary scroll — still within the sticky
        // section's own height, so it must still be pinned.
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(50);
        await expect(page.locator('#flight-companion-send')).toBeInViewport();

        // Playwright cannot drive a real OS software keyboard, so a viewport
        // shrink is the closest faithful proxy for "the keyboard opened,
        // shrinking the visual viewport" — exactly the case `100dvh` (vs.
        // `100vh`) exists to handle. Before beat 4 this had no meaning: a
        // 40vh-capped thread inside an ordinary page never needed to react
        // to viewport height at all.
        await page.setViewportSize({ width: 390, height: 500 });
        await expect(page.locator('#flight-companion-send')).toBeInViewport();
      });
    });

    test.describe('Below the fold on a phone viewport (LIN-2632 beat 4)', () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test('How to use / Kickoff prompt / Latest observer report — and the copy-prompt controls — are reachable by scrolling past the sticky chat section', async ({ page }) => {
        const howTo = page.locator('.flight-companion-page .section-header', { hasText: 'How to use' });
        const copyBtn = page.locator('#flight-companion-copy');
        const observer = page.locator('.flight-companion-page .section-header', { hasText: 'Latest observer report' });

        // Not reachable without scrolling past the sticky, viewport-tall
        // chat section — proves they genuinely fold below, not merely
        // "elsewhere on an unaffected page".
        await expect(howTo).not.toBeInViewport();

        await howTo.scrollIntoViewIfNeeded();
        await expect(howTo).toBeInViewport();
        await copyBtn.scrollIntoViewIfNeeded();
        await expect(copyBtn).toBeInViewport();
        await observer.scrollIntoViewIfNeeded();
        await expect(observer).toBeInViewport();
      });
    });
  });

  // LIN-2632 beat 4 acceptance: "dark theme and reduced motion checked". The
  // phone-shape CSS (public/flight-companion.css's `@media (max-width: 600px)`
  // block) declares no color and no animation/transition — layout only — so
  // there is nothing for either to diverge on; this proves that rather than
  // asserting it. Deliberately its own describe (not sharing the shared
  // beforeEach above): the `theme` cookie must be set BEFORE the flag-on
  // navigation, same ordering constraint as tests/e2e/account-merge.spec.js.
  test.describe('The phone shape under dark theme + reduced motion (LIN-2632 beat 4)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the same Shape B layout holds — thread fill, sticky composer — under dark theme and prefers-reduced-motion', async ({ page }) => {
      await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockTurn(page);
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveClass(/theme-dark/);

      for (let i = 0; i < 6; i += 1) {
        await mockTurn(page, { token: `reply number ${i} — long enough that six of these still overflow the taller Shape B box.` });
        await page.locator('#flight-companion-question').fill(`question number ${i}`);
        await page.locator('#flight-companion-send').click();
        await expect(page.locator('.fc-msg-who').nth(i)).toHaveClass(/status-pill--done/);
      }

      const { scrollHeight, clientHeight } = await page.locator('#flight-companion-thread').evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(clientHeight).toBeGreaterThan(500);
      expect(scrollHeight).toBeGreaterThan(clientHeight);

      await page.mouse.wheel(0, 350);
      await page.waitForTimeout(50);
      await expect(page.locator('#flight-companion-send')).toBeInViewport();
    });
  });

  test.describe('Silent auto-wake tick (page.clock)', () => {
    // page.clock must be installed BEFORE the flag-on page navigates —
    // public/flight-companion.js schedules its first auto-wake timer on
    // load. Deliberately NOT sharing the block above's beforeEach, which
    // navigates before any clock could be installed (plan-review F1/F2).
    test('updates the check-in line without creating a bubble', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      await page.clock.install();
      await mockTurn(page); // no token -> an empty `done`, the silent-tick shape.

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      // CADENCE_BASE_MS (public/flight-companion.js) is 30s. The intercepted
      // fetch is still a real round trip through Playwright's router; only
      // Date/setTimeout inside the page are virtualized, so this does not
      // race the mocked response.
      await page.clock.fastForward(30000);

      const checkin = page.locator('#flight-companion-checkin');
      await expect(checkin).toBeVisible();
      await expect(checkin).toContainText('nothing new');

      await expect(page.locator('.fc-msg-who')).toHaveCount(0);
      await expect(page.locator('#flight-companion-chat-empty')).toBeVisible();
    });
  });

  test.describe('Sweep-liveness gate-silent tick (LIN-2438, page.clock)', () => {
    // Same installation-order discipline as the plain silent-tick block
    // above: page.clock before the flag-on navigation, its own describe so
    // it never shares the layout block's beforeEach.
    test('a gate-silent sweep-not-seen response updates the check-in line with the warning class and creates no bubble', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      await page.clock.install();
      await page.route('**/api/flight-companion/turn', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            turnKind: 'auto-wake',
            spent: false,
            reason: 'sweep-not-seen',
            sweepLastSeenAt: '2026-09-02T20:00:00.000Z',
          }),
        });
      });

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      await page.clock.fastForward(30000);

      const checkin = page.locator('#flight-companion-checkin');
      await expect(checkin).toBeVisible();
      await expect(checkin).toContainText('sweep last seen');
      await expect(checkin).toHaveClass(/fc-checkin--warning/);

      await expect(page.locator('.fc-msg-who')).toHaveCount(0);
      await expect(page.locator('#flight-companion-chat-empty')).toBeVisible();
    });

  });
});

// LIN-2487 — `no-census` is the gate-silent reason that is NOT about sweep
// liveness: there is no census document at all, so there is no last-seen stamp
// to be stale. Its own describe rather than the LIN-2438 sweep-liveness block
// above, because putting it there would imply the opposite of the ticket's
// whole premise — LIN-2438 deliberately left this reason un-relabelled, which
// is exactly why it reached the client with no branch of its own.
test.describe('Flight Companion — no-census check-in (LIN-2487, page.clock)', () => {
  // LIN-2487 — the same shape for the OTHER gate-silent reason that does not
  // mean "checked, nothing new". LIN-2438 left `no-census` un-relabelled in
  // the gate (correctly — it is an honest reason), and the client had no
  // branch for it, so a fleet that has never been scanned reported a
  // successful quiet scan. Real DOM, real client, no model call.
  test('a gate-silent no-census response says no scan has happened, rather than reporting a quiet one', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

    await page.clock.install();
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
      });
    });

    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');

    await page.clock.fastForward(30000);

    const checkin = page.locator('#flight-companion-checkin');
    await expect(checkin).toBeVisible();
    await expect(checkin).toContainText('no fleet scan yet');
    // The defect, asserted directly: this line used to claim a scan happened.
    await expect(checkin).not.toContainText('nothing new');
    // Not styled as a warning — the common case is a brand-new workspace
    // inside the sweep's own interval, which is not a fault.
    await expect(checkin).not.toHaveClass(/fc-checkin--warning/);

    await expect(page.locator('.fc-msg-who')).toHaveCount(0);
    await expect(page.locator('#flight-companion-chat-empty')).toBeVisible();
  });
});
