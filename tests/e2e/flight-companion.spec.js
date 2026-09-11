import { test, expect } from '../fixtures/test-base.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';

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
 * Fulfils a turn endpoint's POST with a synthetic SSE body before it
 * reaches Express — no model call is possible. Rendered through the SAME
 * `renderSSEFrames` helper the unit suite pins byte-for-byte against the
 * real `sendSSE` (lib/sse.js) — LIN-2453/LIN-2620 — so this mock cannot drift
 * from the wire format the real turn endpoint (session or proxy) emits.
 *
 * LIN-2622: `endpoint` defaults to `'turn'` (unchanged for every existing
 * caller) and also accepts `'boot'` — beat 2 made the boot's SSE frame set
 * byte-identical to /turn's precisely so ONE mock harness covers both; a
 * second, forked mocking helper would be exactly the duplication that frame
 * parity claim exists to avoid.
 *
 * LIN-2621 beat 3: `usage`, when given, rides on the `done` frame exactly
 * like the real turn core's summed hop usage does (LIN-2631) — omitted by
 * default so every pre-existing caller stays byte-identical (a `done` with
 * no `usage` key at all, not `usage: undefined`).
 */
async function mockTurn(page, { token, endpoint = 'turn', usage, toolFrames } = {}) {
  await page.route(`**/api/flight-companion/${endpoint}`, (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const doneData = usage ? { usage } : {};
    // LIN-2621 beat 4: `toolFrames`, when given, are spliced in before the
    // narrated/silent tail — e.g. a `list_pending_decisions` tool result —
    // additive to the existing token/no-token shapes below.
    const pre = Array.isArray(toolFrames) ? toolFrames : [];
    const frames = token
      ? renderSSEFrames([...pre, ['token', { token }], ['done', doneData]])
      : renderSSEFrames([...pre, ['done', doneData]]);
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

    // LIN-2621 beat 3: the ticket's own item 1 — a visible turn's bubble
    // renders its OWN meta line (tokens + cost), read from the final `done`
    // frame's usage. Renders exactly what the frame carries — no caveat
    // string, per beat 3's explicit instruction not to hedge the known
    // lib/openrouter.js tool-hop gap.
    test('a visible turn\'s bubble renders its own meta line with tokens and cost', async ({ page }) => {
      await mockTurn(page, {
        token: 'ack',
        usage: { prompt_tokens: 100, completion_tokens: 47, total_tokens: 147, cost: 0.00042 },
      });

      await page.locator('#flight-companion-question').fill('are you there?');
      await page.locator('#flight-companion-send').click();

      const meta = page.locator('.fc-msg-meta');
      await expect(meta).toHaveCount(1);
      await expect(meta).toHaveText('147 tokens · $0.0004');
    });

    // LIN-2621 beat 3: a turn with no usage at all (the model call resolved,
    // but no cost information reached this client — a defensive shape, not
    // one the real turn core produces) renders no meta line, never a
    // fabricated "0 tokens · $0.00".
    test('a visible turn with no usage on its done frame renders no meta line', async ({ page }) => {
      await mockTurn(page, { token: 'ack' });

      await page.locator('#flight-companion-question').fill('are you there?');
      await page.locator('#flight-companion-send').click();

      await expect(page.locator('.fc-msg-who')).toHaveCount(1);
      await expect(page.locator('.fc-msg-meta')).toHaveCount(0);
    });

    // LIN-2670: the ticket's own headline acceptance criterion — a completed
    // answer's Markdown renders as real markup, not raw `**`/`- ` syntax.
    test('LIN-2670: a completed answer containing **bold** and a "- " list renders <strong> and <li>, not raw markdown syntax', async ({ page }) => {
      await mockTurn(page, { token: 'Summary:\n\n**bold point**\n\n- one\n- two' });

      await page.locator('#flight-companion-question').fill('what changed?');
      await page.locator('#flight-companion-send').click();

      const body = page.locator('.fc-msg-body').nth(1);
      await expect(body).toHaveClass(/chat-md/);
      await expect(body.locator('strong')).toHaveCount(1);
      await expect(body.locator('li')).toHaveCount(2);
      await expect(body).not.toContainText('**bold point**');
    });

    // LIN-2670: the sanitisation spec. Assert the REAL security property
    // (handler stripped, script dropped, nothing executes) — not the
    // ticket's original "no img element" wording, which is wrong: it has
    // now been demonstrated twice in real Chromium against the vendored
    // DOMPurify 3.2.4 that a handler-less <img> is kept by default.
    test('LIN-2670: a completed answer carrying a handler-less <img> and a <script> renders neither the handler nor the script, and executes nothing', async ({ page }) => {
      await mockTurn(page, {
        token: '<img src=x onerror="window.__pwned = true"><script>window.__pwned2 = true;</script><p>after</p>',
      });

      await page.locator('#flight-companion-question').fill('render this');
      await page.locator('#flight-companion-send').click();

      const body = page.locator('.fc-msg-body').nth(1);
      await expect(body).toContainText('after');
      await expect(body.locator('script')).toHaveCount(0);
      const img = body.locator('img');
      await expect(img).toHaveCount(1);
      expect(await img.getAttribute('onerror')).toBeNull();
      expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
      expect(await page.evaluate(() => window.__pwned2)).toBeUndefined();
    });

    // LIN-2670 finding 1: the whole-answer-fence ruling. Without this test
    // the regression the keepWholeFence opt-out exists to prevent can
    // silently return.
    test('LIN-2670 finding 1: an answer that is entirely one fenced code block renders as <pre><code>, its contents NOT Markdown-interpreted', async ({ page }) => {
      await mockTurn(page, { token: '```js\nconst a = 1; // # not a heading\n**not bold**\n```' });

      await page.locator('#flight-companion-question').fill('show me the fix');
      await page.locator('#flight-companion-send').click();

      const body = page.locator('.fc-msg-body').nth(1);
      await expect(body.locator('pre code')).toHaveCount(1);
      await expect(body.locator('strong')).toHaveCount(0);
      await expect(body.locator('h1')).toHaveCount(0);
      await expect(body.locator('pre code')).toContainText('**not bold**');
    });

    // LIN-2622: the start button, driving a mocked boot SSE turn through to a
    // rendered readout — the ticket's own acceptance bullet. Nested inside
    // this same describe (rather than a fresh top-level one) so its
    // beforeEach's mockTurn(page) for /turn is already installed too — belt
    // and braces against a stray auto-wake tick firing during the test,
    // matching the file's own "no test can slip through to a live turn
    // request" discipline; the cadence's 30s floor means one shouldn't fire
    // regardless, but the mock costs nothing to have in place.
    test('the start control exists in the empty state and drives a mocked boot SSE turn through to a rendered readout', async ({ page }) => {
      await mockTurn(page, { endpoint: 'boot', token: 'orient complete — nothing needs you right now' });

      const startBtn = page.locator('#flight-companion-start');
      const reorientBtn = page.locator('#flight-companion-reorient');
      const emptyState = page.locator('#flight-companion-chat-empty');

      // The empty state IS the initial state — this is what makes it "the
      // start button in the empty state", not merely a button that happens
      // to exist somewhere on the page.
      await expect(emptyState).toBeVisible();
      await expect(startBtn).toBeVisible();
      await expect(reorientBtn).toBeHidden();

      await startBtn.click();

      // The synthetic "Start" user row — the human sees what they asked for,
      // not a turn that appears from nowhere (LIN-2622's own acceptance).
      await expect(page.locator('.fc-msg-body').first()).toHaveText('Start');

      // The mocked boot turn's readout renders as the companion's reply,
      // through the SAME SSE reader /turn already uses — no boot-specific
      // rendering path exists to diverge.
      const pill = page.locator('.fc-msg-who');
      await expect(pill).toHaveCount(1);
      await expect(pill).toHaveClass(/status-pill--done/);
      await expect(page.locator('.fc-msg-body').nth(1)).toHaveText('orient complete — nothing needs you right now');

      // The start/reorient pair flips once the thread has content.
      await expect(startBtn).toBeHidden();
      await expect(reorientBtn).toBeVisible();
      await expect(emptyState).toBeHidden();
    });

    test('LIN-2622: a boot error mid-stream settles the pill failed rather than stranding it in-progress', async ({ page }) => {
      await page.route('**/api/flight-companion/boot', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
          status: 200, contentType: 'text/event-stream',
          body: `event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n`,
        });
      });

      await page.locator('#flight-companion-start').click();

      const pill = page.locator('.fc-msg-who');
      await expect(pill).toHaveClass(/status-pill--failed/);
      await expect(pill).not.toHaveClass(/status-pill--in-progress/);

      // The failed attempt's bubble stays in the thread (a record of "you
      // asked, it failed" — LIN-2443's precedent), so the empty state stays
      // hidden and re-orient (not start) is the affordance offered next.
      await expect(page.locator('#flight-companion-chat-empty')).toBeHidden();
      await expect(page.locator('#flight-companion-reorient')).toBeVisible();
    });

    // LIN-2632 beat 4 — the phone shape (Shape B, LIN-1412 D2). Below 600px
    // (public/flight-companion.css, the same @media (max-width: 600px)
    // breakpoint public/chat.css already establishes) `.flight-companion-
    // chat-section` becomes an ordinary (non-positioned) `height: 100dvh;`
    // flex column: the thread/empty-state pair (chat.css's
    // `--chat-thread-max-height` overridden to `none`, `flex: 1`) fills the
    // remaining space, and the composer — simply the last flex child — ends
    // up flush with the viewport's own bottom edge once the section is
    // scrolled into view. An earlier revision made the section
    // `position: sticky; top: 0` to close that same gap; the independent
    // review on PR #1401 (finding F2) found that this section is the first
    // of four siblings sharing one container, so sticky's containing block
    // for release purposes was that whole container — it stayed pinned
    // across nearly the entire page scroll, overlaying How-to/Kickoff/
    // Observer below and intercepting clicks meant for them. No `position`
    // is needed at all: the page's own shared `.nav-bar` (public/style.css)
    // is already `position: sticky; top: 0`, and scrolling the section into
    // view naturally lands the composer flush with the viewport bottom, with
    // the nav's own sticky band overlapping only the section's own top edge
    // — never anything below it. Was Shape A by accident before this beat:
    // `.chat-thread` sat at chat.css's 40vh default (337.6px at this
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

      test('the composer is genuinely reachable (visible AND clickable) once scrolled into view, and stays that way through a viewport shrink (keyboard-open proxy)', async ({ page }) => {
        await mockTurn(page, { token: 'ack' });
        await page.locator('#flight-companion-question').fill('are you there?');
        await page.locator('#flight-companion-send').click();
        await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

        // Scroll the composer into view the way a user reaching for the
        // input (or focusing it) naturally would. LIN-2632 review F2:
        // an earlier revision relied on `position: sticky` so that ANY
        // scroll position past the header pinned the section to the
        // viewport top — but that same mechanism pinned the section over
        // the ENTIRE rest of the page too (see the "Below the fold" describe
        // below), since its containing block was the shared parent of all
        // four page sections, not its own box. The fix drops the extra
        // "pinned across an arbitrary scroll range" claim entirely: the
        // composer only needs to be visible+clickable once scrolled to,
        // which needs no `position` at all (see public/flight-companion.css).
        await page.locator('#flight-companion-send').scrollIntoViewIfNeeded();
        await expect(page.locator('#flight-companion-send')).toBeInViewport();
        // A real click, not just geometric intersection — `toBeInViewport()`
        // alone is true of an element hidden under an opaque overlay too,
        // which is exactly how F2's regression escaped the old assertion.
        await page.locator('#flight-companion-send').click({ trial: true, timeout: 2000 });

        // Playwright cannot drive a real OS software keyboard, so a viewport
        // shrink is the closest faithful proxy for "the keyboard opened,
        // shrinking the visual viewport" — exactly the case `100dvh` (vs.
        // `100vh`) exists to handle.
        await page.setViewportSize({ width: 390, height: 500 });
        await expect(page.locator('#flight-companion-send')).toBeInViewport();
        await page.locator('#flight-companion-send').click({ trial: true, timeout: 2000 });
      });

      // LIN-2717 (beat 1 finding, not in the original plan): focusing a
      // <textarea> reveals it via CENTER alignment in Chromium, unlike
      // <input>'s edge alignment — which this page's 100dvh phone-shape
      // column (flight-companion.css) depends on landing the composer flush
      // with the viewport's bottom edge. public/flight-companion.js's own
      // `focus` listener re-aligns to compensate. Isolated from the sibling
      // test above (which exercises it only as a side effect of `.fill()`
      // implicitly focusing before a full send/scroll/shrink sequence): here
      // a bare `.click()` focus, with NO prior scroll and NO explicit
      // scrollIntoView call, is the whole action under test.
      test('focusing the composer directly reveals it flush with the viewport bottom (Chromium\'s textarea center-align quirk, compensated)', async ({ page }) => {
        const send = page.locator('#flight-companion-send');
        // Positive control: the composer starts off-screen at load, so
        // anything that follows is caused by the focus, not by the initial
        // page load already having it in view.
        await expect(send).not.toBeInViewport();

        await page.locator('#flight-companion-question').click();
        await expect(send).toBeInViewport();

        // Not merely intersecting somewhere — genuinely flush with the
        // viewport's bottom edge, the way the phone-shape column design
        // requires. A naive center-aligned reveal would land it mid-screen,
        // which would still satisfy toBeInViewport() but fail this.
        const sendBox = await send.boundingBox();
        const viewportHeight = page.viewportSize().height;
        expect(sendBox.y + sendBox.height).toBeGreaterThan(viewportHeight - 40);
      });
    });

    // LIN-2717 review F1: the focus listener's `scrollIntoView({block:'end'})`
    // re-align only exists to compensate for the phone-shape column, which
    // flight-companion.css scopes to `@media (max-width: 600px)` — outside
    // that width the listener ran unconditionally anyway and yanked a
    // mid-page scroll position back to the top on every composer focus,
    // e.g. scroll down to read the kickoff prompt or the latest observer
    // report, click the composer to ask about it, and the page jumps away.
    // Desktop-width witness, deliberately outside the 390x844 describe above
    // (that describe proves the mobile reveal; nothing there exercises any
    // other width). Viewport matches the review's own measurement.
    test.describe('Desktop viewport (1280x800) — focus must not move the scroll position', () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      test('focusing the composer after a mid-page scroll leaves scrollY unchanged', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 200));
        const before = await page.evaluate(() => window.scrollY);
        expect(before).toBeGreaterThan(0);

        await page.locator('#flight-companion-question').click();

        const after = await page.evaluate(() => window.scrollY);
        expect(after).toBe(before);
      });
    });

    test.describe('Below the fold on a phone viewport (LIN-2632 beat 4)', () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test('How to use / Kickoff prompt / Latest observer report — and the copy-prompt controls — are genuinely clickable after scrolling past the chat section, not merely geometrically in the viewport', async ({ page }) => {
        const howTo = page.locator('.flight-companion-page .section-header', { hasText: 'How to use' });
        const copyBtn = page.locator('#flight-companion-copy');
        const observer = page.locator('.flight-companion-page .section-header', { hasText: 'Latest observer report' });

        // Not reachable without scrolling past the one-viewport-tall chat
        // section — proves they genuinely fold below, not merely
        // "elsewhere on an unaffected page".
        await expect(howTo).not.toBeInViewport();

        // LIN-2632 review F2: `toBeInViewport()` alone is a pure geometry
        // check — true of an element completely covered by an opaque
        // overlay. The sticky chat section (before this fix) satisfied
        // exactly that assertion while a real click on the same locator
        // timed out, because `.flight-companion-chat-section`'s subtree
        // intercepted the pointer event (its own DOM comment claimed
        // scrolling past it released the section; measurement showed
        // otherwise — the containing block for a sticky release is the
        // shared parent of all four sections, not the section's own box).
        // `click({ trial: true })` performs every real-click actionability
        // step (scroll into view, wait, hit-test the target point) without
        // dispatching the event, so it only resolves if the browser would
        // actually deliver the click here — the assertion review named as
        // the fix.
        await copyBtn.click({ trial: true, timeout: 2000 });
        // elementFromPoint identity is the same claim from the other
        // direction: the point at the control's own centre must resolve to
        // the control itself (or a descendant), never to something stacked
        // on top of it — this is the literal browser API the independent
        // review used to reproduce F2. Checked immediately after the trial
        // click above (which scrolled the button into view) rather than
        // after the other two below, which scroll the page elsewhere first.
        const copyIsHit = await copyBtn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === el || el.contains(hit);
        });
        expect(copyIsHit).toBe(true);

        await observer.click({ trial: true, timeout: 2000 });
        await howTo.click({ trial: true, timeout: 2000 });
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

    test('the same Shape B layout holds — thread fill, reachable composer — under dark theme and prefers-reduced-motion', async ({ page }) => {
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

      await page.locator('#flight-companion-send').scrollIntoViewIfNeeded();
      await expect(page.locator('#flight-companion-send')).toBeInViewport();
      await page.locator('#flight-companion-send').click({ trial: true, timeout: 2000 });
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

    // LIN-2621 beat 3: "otherwise the page's biggest spender is its only
    // invisible one" — a silent tick still carries real usage (a tool-using
    // auto-wake turn that narrated nothing), and the strip's running total +
    // check-in count are the ONLY other visible effect, alongside the
    // unchanged check-in line above. No bubble paints either way (LIN-2443
    // AC1 unchanged).
    test('a silent tick with usage updates the strip\'s running total and check-in count, still with no bubble', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      await page.clock.install();
      await mockTurn(page, { usage: { prompt_tokens: 200, completion_tokens: 10, total_tokens: 210, cost: 0.0009 } });

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      const tabTotal = page.locator('#flight-companion-strip-tab-total');
      await expect(tabTotal).toHaveText('0 check-ins · $0.00 this tab');

      await page.clock.fastForward(30000);

      await expect(tabTotal).toHaveText('1 check-in · $0.0009 this tab');
      await expect(page.locator('.fc-msg-who')).toHaveCount(0);
      await expect(page.locator('.fc-msg-meta')).toHaveCount(0);
    });
  });

  // LIN-2718: John's own complaint — "focus shifts from the input box when
  // the feed checks/loads", which on a phone collapses the keyboard and
  // loses the caret mid-sentence. Same installation-order discipline as the
  // silent-tick block above (page.clock before the flag-on navigation, its
  // own describe so it never shares the layout block's beforeEach — that
  // beforeEach navigates before any clock could be installed).
  test.describe('Auto-wake preserves composer focus, draft, and caret (LIN-2718)', () => {
    test('focus, draft value, and caret position all survive a silent auto-wake tick', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      await page.clock.install();
      await mockTurn(page); // no token -> an empty `done`, the silent-tick shape a real check-in takes.

      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      const input = page.locator('#flight-companion-question');
      await input.fill('this is a partial dra');
      // Caret placed mid-sentence, not at the end — fill() alone would leave
      // it at the string's length, which can't distinguish "the caret was
      // genuinely preserved" from "it always ends up at the end anyway" (a
      // weaker, coincidentally-passing claim).
      await input.evaluate((el) => el.setSelectionRange(4, 4));

      const before = await input.evaluate((el) => ({
        active: document.activeElement === el,
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      }));
      expect(before.active).toBe(true);
      expect(before.selectionStart).toBe(4);
      expect(before.selectionEnd).toBe(4);

      // CADENCE_BASE_MS (public/flight-companion.js) is 30s — this fires the
      // auto-wake tick.
      await page.clock.fastForward(30000);

      // Proof the tick genuinely ran (not that nothing happened at all) —
      // the check-in line is the auto-wake's own visible progress surface.
      await expect(page.locator('#flight-companion-checkin')).toContainText('nothing new');

      const after = await input.evaluate((el) => ({
        active: document.activeElement === el,
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      }));
      expect(after.active).toBe(true);
      expect(after.value).toBe(before.value);
      expect(after.selectionStart).toBe(before.selectionStart);
      expect(after.selectionEnd).toBe(before.selectionEnd);
    });

    test('focus and caret also survive a mid-stream auto-wake error and a gate-silent (non-stream) outcome', async ({ page }) => {
      let respondMode = 'error';
      await page.route('**/api/flight-companion/turn', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        if (respondMode === 'error') {
          return route.fulfill({
            status: 200, contentType: 'text/event-stream',
            body: `event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n`,
          });
        }
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ turnKind: 'auto-wake', spent: false, reason: 'floor' }),
        });
      });
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

      await page.clock.install();
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');

      const input = page.locator('#flight-companion-question');
      await input.fill('draft across a failing tick');
      await input.evaluate((el) => el.setSelectionRange(5, 5));

      await page.clock.fastForward(30000); // mid-stream error tick

      let state = await input.evaluate((el) => ({
        active: document.activeElement === el, value: el.value,
        selectionStart: el.selectionStart, selectionEnd: el.selectionEnd,
      }));
      expect(state.active).toBe(true);
      expect(state.value).toBe('draft across a failing tick');
      expect(state.selectionStart).toBe(5);
      expect(state.selectionEnd).toBe(5);

      respondMode = 'gate-silent';
      await page.clock.fastForward(60000); // next tick, doubled interval after the error

      state = await input.evaluate((el) => ({
        active: document.activeElement === el, value: el.value,
        selectionStart: el.selectionStart, selectionEnd: el.selectionEnd,
      }));
      expect(state.active).toBe(true);
      expect(state.value).toBe('draft across a failing tick');
      expect(state.selectionStart).toBe(5);
      expect(state.selectionEnd).toBe(5);
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

// LIN-2717: the composer keyboard contract. `fill()` sets `.value` directly
// and fires only `input`, never `keydown` — none of this file's 13 existing
// composer sites (all `fill()` + button `click()`) exercises the key handler
// at `public/flight-companion.js:1305` (`Enter && !shiftKey`). Every test
// below uses `keyboard.type`/`press` instead, never `fill()`, for exactly
// that reason.
test.describe('Flight Companion — LIN-2717 composer keyboard contract (Enter sends, Shift+Enter newlines)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('Shift+Enter inserts a newline and does not send', async ({ page }) => {
    let posted = null;
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: renderSSEFrames([['done', {}]]) });
    });

    const input = page.locator('#flight-companion-question');
    await input.click();
    await page.keyboard.type('line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');

    await expect(input).toHaveValue('line one\nline two');
    // The negative assertion is the point: without it, this test would pass
    // even if Shift+Enter also sent.
    await page.waitForTimeout(200);
    expect(posted).toBeNull();
  });

  test('Enter sends; the posted message carries the interior newline', async ({ page }) => {
    let posted = null;
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: renderSSEFrames([['done', {}]]) });
    });

    const input = page.locator('#flight-companion-question');
    await input.click();
    await page.keyboard.type('line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');

    await expect.poll(() => posted).not.toBeNull();
    // Interior, never trailing — routes/flight-companion.js:575 trims, so a
    // trailing newline would fail here for a reason unrelated to the AC.
    expect(posted.message).toBe('line one\nline two');
    await expect(input).toHaveValue('');
  });

  test('whitespace-only never sends, from either entry point (client-side-only guarantee)', async ({ page }) => {
    let posted = null;
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: renderSSEFrames([['done', {}]]) });
    });

    const input = page.locator('#flight-companion-question');
    await input.click();
    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(posted).toBeNull();

    // Same guard, the other entry point: the send button shares :1288.
    await page.locator('#flight-companion-send').click();
    await page.waitForTimeout(200);
    expect(posted).toBeNull();
  });
});

// LIN-2717: auto-grow + the CSS-owned cap. The unit seam's FakeElement layout
// model proves the arithmetic; this is where the real layout engine is the
// authority.
test.describe('Flight Companion — LIN-2717 composer auto-grow (browser truth)', () => {
  test.beforeEach(async ({ page }) => {
    await mockTurn(page, { token: 'ack' });
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('grows with content and stops at the stylesheet-owned max-height, then scrolls', async ({ page }) => {
    const input = page.locator('#flight-companion-question');
    const restingHeight = await input.evaluate((el) => el.getBoundingClientRect().height);

    await input.click();
    // Explicit Shift+Enter newlines, not wrapped-word growth — deterministic
    // regardless of the composer's rendered width (a wrap-only approach
    // would need enough words to fill several visual lines, which varies by
    // viewport). Twelve lines guarantees past the ~6-line cap.
    for (let i = 0; i < 12; i += 1) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.type(`line ${i}`);
    }

    const maxHeight = await input.evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
    const { height, scrollHeight, clientHeight, overflowY } = await input.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));

    expect(height).toBeGreaterThan(restingHeight);
    // Read the computed cap, don't hard-code 136px — the CSS owns it.
    expect(height).toBeLessThanOrEqual(maxHeight + 1);
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    expect(overflowY).toBe('auto');
  });

  test('height resets to one row after Enter sends — the witness for the seven-sites .value chokepoint', async ({ page }) => {
    const input = page.locator('#flight-companion-question');
    const restingHeight = await input.evaluate((el) => el.getBoundingClientRect().height);

    await input.click();
    for (let i = 0; i < 4; i += 1) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      await page.keyboard.type(`line ${i}`);
    }
    const grownHeight = await input.evaluate((el) => el.getBoundingClientRect().height);
    expect(grownHeight).toBeGreaterThan(restingHeight);

    await page.keyboard.press('Enter');
    await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

    const clearedHeight = await input.evaluate((el) => el.getBoundingClientRect().height);
    expect(clearedHeight).toBeCloseTo(restingHeight, 0);
  });
});

// LIN-2717: the shared 375×812 coordination point with LIN-2715. LIN-2715
// owns pre-start inter-sibling VERTICAL collisions; LIN-2717 owns this
// row's intra-row HORIZONTAL criterion, because the <input>-to-<textarea>
// swap carries the min-content floor across (`size` -> `cols`, both default
// 20). Whichever of the two tickets lands first creates this describe; the
// second joins it rather than forking a second mobile block. The file's
// existing mobile blocks are 390×844 (:371, :430, :499 above) — this is a
// distinct viewport, per the AC's own literal wording.
test.describe('Flight Companion — 375×812 (LIN-2717 / LIN-2715 shared mobile coordination point)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await mockTurn(page, { token: 'ack' });
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
  });

  async function assertNoOverlapOrOverflow(page) {
    const input = page.locator('#flight-companion-question');
    const send = page.locator('#flight-companion-send');
    // The phone-shape column puts the composer below the fold at first
    // paint (LIN-2632) — scroll it into view the way a reaching user would,
    // same idiom as the 390×844 reachability tests above.
    await send.scrollIntoViewIfNeeded();
    const [inputBox, sendBox] = await Promise.all([input.boundingBox(), send.boundingBox()]);
    // The AC's literal wording: the composer must not overlap the send button.
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(sendBox.x + 1);
    // The actual failure mechanism (a flex min-width:auto blowout) is
    // overflow, not overlap in the CSS sense — assert that directly too.
    const row = page.locator('.fc-chat-composer');
    const { scrollWidth, clientWidth } = await row.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    // Geometric intersection alone is also true of a button under an opaque
    // overlay — a real (trial) click is the decisive check.
    await expect(send).toBeInViewport();
    await send.click({ trial: true, timeout: 2000 });
  }

  test('the composer and send button do not overlap, at rest', async ({ page }) => {
    await assertNoOverlapOrOverflow(page);
  });

  test('the composer and send button do not overlap once the composer has grown to the cap', async ({ page }) => {
    const input = page.locator('#flight-companion-question');
    await input.click();
    await page.keyboard.type(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '));
    await assertNoOverlapOrOverflow(page);
  });

  // LIN-2717 review F5/ledger L8: finishTurn's caret-restore `.focus()`
  // fires the SAME `focus` listener a human tap does, so below the 600px gate
  // a completed user-initiated turn yanked the page back to the composer even
  // when the user scrolled away to read while it was in flight.
  //
  // Every figure below is measured by THIS test, in THIS scenario (moderate
  // scroll to "How to use" at 375x812) — the earlier ~126px / ~826px / ~9px
  // numbers came from a DEEPER-scroll variant and do not describe what runs
  // here, which is why the bound they justified was far looser than the
  // behaviour warrants (ledger L9):
  //
  //   as shipped, with the flag guard   Chromium 0px  WebKit 0px  Firefox 0px
  //   with `if (restoringFocusProgrammatically) return;` deleted
  //                                     Chromium 481px WebKit 480px Firefox 480px
  //
  // So the guarded path does not move the page at all, and the regression it
  // guards against moves it ~480px. The 10px bound below is therefore ~48x
  // below the regression while still refusing a PARTIAL one: an assertion
  // loose enough to tolerate 126px of yank would pass on a half-broken fix
  // against a true value of zero.
  test('a completed turn does not yank the page back to the composer if the user scrolled away while it was in flight (LIN-2717 F5)', async ({ page }) => {
    let resolveTurn;
    const turnGate = new Promise((resolve) => { resolveTurn = resolve; });
    await page.route('**/api/flight-companion/turn', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await turnGate;
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: renderSSEFrames([['token', { token: 'ack' }], ['done', {}]]),
      });
    });

    const input = page.locator('#flight-companion-question');
    await input.click();
    // Enter-to-send (not a click on #flight-companion-send) so the input —
    // not the send button — genuinely holds focus at turn start, matching
    // the scenario finishTurn's `questionHadFocusAtTurnStart` gate exists for.
    await page.keyboard.type('are you there?');
    await page.keyboard.press('Enter');

    // The turn is now in flight (held open by turnGate) — scroll down to
    // read "How to use" while waiting, the way the review's own scenario
    // does. Deliberately a moderate scroll, not a jump to the very bottom of
    // the page: scrolling arbitrarily far away would trigger the browser's
    // OWN native "bring a newly-focused off-screen element into view"
    // behaviour regardless of this listener, which is not what this test is
    // isolating.
    const howTo = page.locator('.flight-companion-page .section-header', { hasText: 'How to use' });
    await howTo.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    // Let the answer land.
    resolveTurn();
    await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

    const after = await page.evaluate(() => window.scrollY);
    const moved = before - after;
    // eslint-disable-next-line no-console
    console.log(`LIN-2717 F5 witness: scrollY ${before} -> ${after} (moved ${moved}px)`);
    // 10px, not 126: the measured behaviour is exactly 0px on all three
    // engines, so this is headroom for sub-pixel/UA rounding, not for a
    // regression. Verified red at ~480px with the flag guard removed.
    expect(moved).toBeLessThanOrEqual(10);
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

// LIN-2621 beat 4: waiting-on-you decisions as option buttons, reused
// verbatim from the rulings tab's own primitive (public/chat.css's
// `.chat-options*` rules, public/chat.js's window.ChatUI.appendOptions) — a
// tap answers through window.ReplyDelivery.postComment, the existing
// session-auth comment path, never a new write surface. Real DOM, real
// client; the comment POST is intercepted here (never reaches Express) —
// same "no model calls, no live writes" discipline as the rest of this file.
test.describe('Decisions as option buttons (LIN-2621 beat 4)', () => {
  const decisionsToolFrame = (decisions) => (
    ['tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: JSON.stringify({ count: decisions.length, truncated: false, decisions }) }]
  );

  test('an interactive decision renders its options with the recommended star; a tap posts a comment and the row settles', async ({ page }) => {
    const decision = {
      decisionId: 'dec-42', issueIdentifier: 'LIN-42', loopId: 'loop-42', sessionId: 'sess-42',
      question: 'Ship the fix now?', options: [{ id: 'yes', label: 'Ship it' }, { id: 'no', label: 'Hold' }],
      optionsTotal: 2, recommended: 'yes', since: null, disposition: 'resumable', canReply: true, shelvedLapseCount: 0,
    };
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

    await page.clock.install();
    await mockTurn(page, { toolFrames: [decisionsToolFrame([decision])] });

    let commentRequest = null;
    await page.route('**/api/comments/**', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      commentRequest = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'c1' }) });
    });

    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
    await page.clock.fastForward(30000);

    const card = page.locator('.fc-decision');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.fc-decision-question')).toHaveText('Ship the fix now?');
    const buttons = card.locator('.chat-options-row .chat-option-btn');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveClass(/chat-option--recommended/);
    await expect(buttons.nth(1)).not.toHaveClass(/chat-option--recommended/);

    await buttons.nth(0).click();
    await expect.poll(() => commentRequest).not.toBeNull();
    expect(commentRequest.body).toBe('Ship it');
    expect(commentRequest.decisionLoopId).toBe('loop-42');
    expect(commentRequest.decisionId).toBe('dec-42');

    await expect(card).toHaveClass(/fc-decision--resolved/);
    await expect(buttons.nth(0)).toBeDisabled();
    await expect(buttons.nth(1)).toBeDisabled();
    await expect(card.locator('.fc-decision-feedback')).toContainText('Replied');
  });

  test('canReply: false / a read-only disposition renders the caption only — no tappable buttons', async ({ page }) => {
    const decision = {
      decisionId: 'dec-43', issueIdentifier: 'LIN-43', loopId: 'loop-43', sessionId: 'sess-43',
      question: 'Still running', options: [{ id: 'yes', label: 'Ship it' }],
      optionsTotal: 1, recommended: null, since: null, disposition: 'mid-turn', canReply: false, shelvedLapseCount: 0,
    };
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

    await page.clock.install();
    await mockTurn(page, { toolFrames: [decisionsToolFrame([decision])] });
    await page.route('**/api/comments/**', (route) => {
      if (route.request().method() === 'POST') throw new Error('a read-only decision must never post a comment');
      return route.continue();
    });

    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
    await page.clock.fastForward(30000);

    const card = page.locator('.fc-decision');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.chat-options--readonly')).toHaveCount(1);
    await expect(card.locator('.chat-options-row')).toHaveCount(0);
  });
});

// LIN-2716: before this landed, a page reload threw the conversation away —
// chatHistory lived only in a browser-memory array, never written to
// sessionStorage. These are the ticket's own headline acceptance criteria,
// written RED-FIRST against the unfixed client in beat 2 (verbatim red
// output posted as a Linear comment on LIN-2716) and made to pass by beat
// 3's production change (public/flight-companion.js's sessionStorageKey/
// loadStoredSession/saveStoredSession/clearStoredSession + the finishTurn/
// reorientClick/rehydrate-on-load wiring).
test.describe('LIN-2716: reload persists and resumes the session', () => {
  test.beforeEach(async ({ page }) => {
    await mockTurn(page);
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('send a turn, reload: the thread is visible AND the next turn\'s body.history includes the prior exchange', async ({ page }) => {
    await mockTurn(page, { token: 'ack' });
    await page.locator('#flight-companion-question').fill('are you there?');
    await page.locator('#flight-companion-send').click();
    await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Half 1 (the ticket's own wording): "the thread is visible" — both the
    // prior user line and the prior companion reply, not just a truthy
    // thread element.
    await expect(page.locator('#flight-companion-thread')).toBeVisible();
    await expect(page.locator('#flight-companion-chat-empty')).toBeHidden();
    await expect(page.locator('.fc-msg-body').first()).toHaveText('are you there?');
    await expect(page.locator('.fc-msg-body').nth(1)).toHaveText('ack');

    // Half 2 (the ticket's own wording): "the next turn's body.history
    // includes the prior exchange" — captured via a route intercept (needs
    // the REQUEST body, which mockTurn's fulfil-only helper doesn't expose).
    // Playwright runs the most-recently-registered handler for a matching
    // pattern first, so this takes over from beforeEach's/the line above's
    // mockTurn registrations without needing to unroute them.
    let capturedBody = null;
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      capturedBody = JSON.parse(route.request().postData());
      const frames = renderSSEFrames([['token', { token: 'still here' }], ['done', {}]]);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
    });
    await page.locator('#flight-companion-question').fill('still there?');
    await page.locator('#flight-companion-send').click();
    await expect(page.locator('.fc-msg-body').nth(3)).toHaveText('still here');

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.history).toEqual([
      { role: 'user', content: 'are you there?' },
      { role: 'assistant', content: 'ack' },
    ]);
  });

  // LIN-2716's original acceptance bullet here was "reorient clears the
  // stored session" — withdrawn by John's ruling on LIN-2770: reorient is
  // NOT a fresh start (LIN-2622's boot turn already carries the prior
  // exchange on the wire), so clearing storage on reorient was wrong on its
  // own premise. The review that filed LIN-2770 found the clear "undid
  // itself" one turn later anyway (the next ordinary turn re-saved the whole
  // pre-reorient chatHistory), which is what made the withdrawn behaviour
  // incoherent rather than merely conservative.
  //
  // This regression instead pins the CORRECTED behaviour end to end, and is
  // written to be genuinely red against the withdrawn "clear on reorient"
  // code: reloading immediately after reorient — before any further turn —
  // is exactly the window where the old code had already cleared storage
  // but the new code has not touched it. (Reloading only AFTER a further
  // turn would pass either way, since that later turn's own save
  // re-populates storage regardless of what reorient did — that ordering
  // cannot distinguish the two behaviours, which is why the reload sits
  // directly after reorient here, not after a follow-up turn.)
  test('reorient does not clear the stored session: a reload right after reorient keeps the continuing conversation, and the next turn carries it forward', async ({ page }) => {
    await mockTurn(page, { token: 'ack' });
    await page.locator('#flight-companion-question').fill('are you there?');
    await page.locator('#flight-companion-send').click();
    await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

    await mockTurn(page, { endpoint: 'boot', token: 'orienting fresh' });
    await page.locator('#flight-companion-reorient').click();
    await expect(page.locator('.fc-msg-who').last()).toHaveClass(/status-pill--done/);

    // Reload with NO further turn sent — under the withdrawn behaviour this
    // is where storage was already cleared, so the thread would come back
    // empty even though reorient was never meant to be a fresh start.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#flight-companion-thread')).toBeVisible();
    await expect(page.locator('#flight-companion-chat-empty')).toBeHidden();
    await expect(page.locator('.fc-msg-body').first()).toHaveText('are you there?');
    await expect(page.locator('.fc-msg-body').nth(1)).toHaveText('ack');

    // Continue with a later turn post-reload: the next turn's body.history
    // must carry the pre-reorient exchange forward too, not just the
    // visible thread — this is the "next-turn history" half of the ticket's
    // corrected acceptance.
    let capturedBody = null;
    await page.route('**/api/flight-companion/turn', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      capturedBody = JSON.parse(route.request().postData());
      const frames = renderSSEFrames([['token', { token: 'still here' }], ['done', {}]]);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
    });
    await page.locator('#flight-companion-question').fill('still there?');
    await page.locator('#flight-companion-send').click();
    await expect(page.locator('.fc-msg-body').last()).toHaveText('still here');

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.history).toEqual([
      { role: 'user', content: 'are you there?' },
      { role: 'assistant', content: 'ack' },
    ]);
  });
});
