import { test, expect } from '../fixtures/test-base.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';

// LIN-2715: regression witness for the pre-start mobile overflow.
//
// `.flight-companion-chat-empty` (public/flight-companion.css's
// `@media (max-width: 600px)` block) is a flex child explicitly authorised to
// shrink below its content (`flex: 1 1 auto; min-height: 0`) inside the
// `.flight-companion-chat-section`'s `height: 100dvh` column. When the
// client-loaded playbook (public/flight-companion.js's
// `loadPlaybookEmptyState`, fed by `GET .../api/flight-companion/playbook`,
// LIN-2625) is long enough, the box's content outgrows its own height and —
// with no `overflow` rule — paints straight out of the box onto the next
// siblings in flow: `#flight-companion-start` first, then the composer. The
// seeded test workspace normally has no playbook, which is why a short/empty
// fixture is a false negative for this bug (see the length guard below).
//
// Two naive metrics were shown, during the LIN-2715 investigation, to be
// misleading for this specific failure and are deliberately NOT used here:
//   - a box-vs-box getBoundingClientRect() comparison reports a clean page
//     even when broken — the empty state's own border box stays small while
//     its TEXT paints outside it, so box intersection never fires;
//   - an UNCLIPPED Range.getClientRects() comparison reports a false RED once
//     a candidate fix turns the element into a scroll container — it returns
//     each line's layout position and knows nothing about clipping, so a
//     line the browser is actually clipping away still counts as painted.
// This spec instead measures PAINTED text via Range.getClientRects(), each
// rect clipped to the source element's own border box ONLY when that
// element's computed overflow says it actually clips (so a scrolled-away
// line under the fix is correctly excluded, and an escaping line on the
// unfixed page is correctly counted).
//
// It also guards against a fix that merely MOVES the collision rather than
// removing it: two measured candidates (`min-height: auto`, `flex: 0 0 auto`)
// stop the paint-through by letting the empty state grow past the section's
// own `100dvh` box, which pushes Start/the composer into the NEXT section
// ("How to use") and makes Start un-clickable (hit-testing its former
// position resolves to the next section's own paragraph). A witness that
// only checked "no text over Start" would pass that broken fix — so this one
// also asserts Start/composer stay inside their own section, and that Start
// is a genuine (trial) click target, not just geometrically unobstructed.

let URL_KEY;
let PAGE_URL;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

// Real prose, several open promises — the shape a live companion's `remember`
// tool actually accumulates (LIN-2625), not a synthetic token run. Comfortably
// past the ~1,020-1,032 char threshold the LIN-2715 investigation measured as
// the first line box that cannot fit in the empty state's box at 375x812, so
// this reliably reproduces rather than sitting on the boundary.
const PLAYBOOK_PROMISES = [
  'follow up with the deploy team about whether the staging environment refresh script still respects the per-workspace feature flag defaults after the last infrastructure migration completed',
  'confirm the observer sweep census correctly reports a no-census state when a brand new workspace has never had a sweep tick run against it yet, and that the check-in line reflects that honestly',
  'check whether the composer auto-grow cap interacts badly with very long single-line pastes on narrow phone viewports, especially when the device keyboard is also open at the same time',
  'verify the status strip model id field stays accurate after a workspace changes its preferred model, since the strip resolves it once per page load rather than live',
  'revisit whether the playbook empty-state scroll affordance is worth adding once real usage data shows how often people actually scroll to read the hidden lines',
  'make sure the mid-session rendering and the desktop 1024px rendering both stay clean once this fix lands, not only the specific mobile pre-start case that was reported',
  'ask whether the notes field backing this playbook should get a server-side length cap similar to the observer attention list cap, or whether that is out of scope for now',
  'double check the kickoff prompt copy path still appends the proxy access block correctly after the shared brief module was last touched by an unrelated change',
];
const PLAYBOOK = PLAYBOOK_PROMISES.join(' ');
const PLAYBOOK_OVERFLOW_THRESHOLD_CHARS = 1032;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/flight-companion`;
});

async function seedPlaybook(page, urlKey) {
  const response = await page.request.post('/test/set-flight-companion-playbook', {
    data: { urlKey, playbook: PLAYBOOK },
  });
  expect(response.ok()).toBeTruthy();
}

// Minimal local mock of the boot SSE turn — mirrors flight-companion.spec.js's
// own `mockTurn` helper (not exported, so not imported) for the one mid-session
// case here that needs to press Start.
async function mockBootTurn(page, token) {
  await page.route('**/api/flight-companion/boot', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: renderSSEFrames([['token', { token }], ['done', {}]]),
    });
  });
}

// Waits for the post-paint async playbook fetch (public/flight-companion.js's
// `loadPlaybookEmptyState`, fired from DOMContentLoaded) to have replaced the
// short server-rendered default, and for the real webfont to be in — swapping
// the fallback face for JetBrains Mono changes line wrapping, and therefore
// the line count this spec's metric depends on.
async function waitForPlaybookPainted(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('flight-companion-chat-empty');
    return !!el && (el.textContent || '').length > 1000;
  });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Painted-text-vs-target overlap, clipping-aware (LIN-2715). Walks every line
 * box of `sourceSelector`'s text content via Range.getClientRects(), clips
 * each rect to the source element's own border box only when the element's
 * computed overflow says it actually clips content, and sums the intersection
 * area against `targetSelector`'s bounding box.
 */
async function measurePaintedOverlap(page, sourceSelector, targetSelector) {
  return page.evaluate(([sourceSel, targetSel]) => {
    const source = document.querySelector(sourceSel);
    const target = document.querySelector(targetSel);
    if (!source || !target) return null;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const style = getComputedStyle(source);
    const clips = style.overflowY !== 'visible' || style.overflowX !== 'visible';

    const range = document.createRange();
    range.selectNodeContents(source);
    const rects = Array.from(range.getClientRects());

    let overlapArea = 0;
    let overlappingRectCount = 0;
    for (const raw of rects) {
      let rect = raw;
      if (clips) {
        const left = Math.max(raw.left, sourceRect.left);
        const right = Math.min(raw.right, sourceRect.right);
        const top = Math.max(raw.top, sourceRect.top);
        const bottom = Math.min(raw.bottom, sourceRect.bottom);
        if (right <= left || bottom <= top) continue; // clipped away entirely
        rect = { left, right, top, bottom };
      }
      const ix = Math.max(0, Math.min(rect.right, targetRect.right) - Math.max(rect.left, targetRect.left));
      const iy = Math.max(0, Math.min(rect.bottom, targetRect.bottom) - Math.max(rect.top, targetRect.top));
      const area = ix * iy;
      if (area > 0) {
        overlapArea += area;
        overlappingRectCount += 1;
      }
    }

    return {
      overlapArea,
      overlappingRectCount,
      totalRects: rects.length,
      sourceBoxHeight: sourceRect.height,
      sourceScrollHeight: source.scrollHeight,
      clips,
    };
  }, [sourceSelector, targetSelector]);
}

// Guards against a fix that removes the paint-through by pushing Start/the
// composer OUT of the chat section into the next one (candidates the LIN-2715
// investigation measured and rejected) — "the collision was moved, not
// removed". A witness that only checked overlap against Start would pass a
// page where Start no longer exists inside its own section at all.
async function assertControlsStayInSection(page, { checkStart = true } = {}) {
  const sectionBox = await page.locator('.flight-companion-chat-section').boundingBox();
  const composerBox = await page.locator('.fc-chat-composer').boundingBox();
  expect(sectionBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  const sectionBottom = sectionBox.y + sectionBox.height;
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(sectionBottom + 1);

  if (checkStart) {
    // `#flight-companion-start` is only meaningful pre-start — mid-session it
    // is deliberately `.hidden` (setEmptyVisible), which is intended
    // behaviour, not the "moved out of its section" failure this guards
    // against.
    const startBox = await page.locator('#flight-companion-start').boundingBox();
    expect(startBox).not.toBeNull();
    expect(startBox.y + startBox.height).toBeLessThanOrEqual(sectionBottom + 1);
  }
}

test.describe('Flight Companion — pre-start mobile overflow (LIN-2715)', () => {
  test.describe('375x812 phone, pre-start', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await seedPlaybook(page, URL_KEY);
      await page.goto(PAGE_URL);
      await waitForPlaybookPainted(page);
    });

    test('pre-start text does not overlap the Start button', async ({ page }) => {
      const emptyText = await page.locator('#flight-companion-chat-empty').textContent();
      // Guards the fixture itself: if the seeded text were short, this would
      // pass for the ticket's own original false-negative reason rather than
      // because the layout is actually fixed.
      expect((emptyText || '').length).toBeGreaterThan(PLAYBOOK_OVERFLOW_THRESHOLD_CHARS);

      await page.locator('#flight-companion-start').scrollIntoViewIfNeeded();

      const overStart = await measurePaintedOverlap(page, '#flight-companion-chat-empty', '#flight-companion-start');
      expect(overStart.overlapArea).toBe(0);

      const overComposer = await measurePaintedOverlap(page, '#flight-companion-chat-empty', '.fc-chat-composer');
      expect(overComposer.overlapArea).toBe(0);

      await assertControlsStayInSection(page);

      // Geometric non-overlap is not proof the control is reachable — a
      // candidate that pushes Start into the next section can still leave it
      // geometrically clear of the empty state while un-clickable. A real
      // (trial) click is the decisive check.
      await expect(page.locator('#flight-companion-start')).toBeInViewport();
      await page.locator('#flight-companion-start').click({ trial: true, timeout: 2000 });
    });
  });

  test.describe('375x812 phone, mid-session (after Start)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('mid-session has no overlapping text either', async ({ page }) => {
      await mockBootTurn(page, 'orient complete — nothing needs you right now');
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await seedPlaybook(page, URL_KEY);
      await page.goto(PAGE_URL);
      await waitForPlaybookPainted(page);

      await page.locator('#flight-companion-start').click();
      await expect(page.locator('#flight-companion-chat-empty')).toBeHidden();
      await expect(page.locator('.fc-msg-who')).toHaveClass(/status-pill--done/);

      await page.locator('.fc-chat-composer').scrollIntoViewIfNeeded();
      const overComposer = await measurePaintedOverlap(page, '#flight-companion-thread', '.fc-chat-composer');
      expect(overComposer.overlapArea).toBe(0);

      await assertControlsStayInSection(page, { checkStart: false });
      await expect(page.locator('#flight-companion-send')).toBeInViewport();
      await page.locator('#flight-companion-send').click({ trial: true, timeout: 2000 });
    });
  });

  test.describe('1024x812 desktop, pre-start', () => {
    test.use({ viewport: { width: 1024, height: 812 } });

    test('pre-start text does not overlap the Start button', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);
      await seedPlaybook(page, URL_KEY);
      await page.goto(PAGE_URL);
      await waitForPlaybookPainted(page);

      const emptyText = await page.locator('#flight-companion-chat-empty').textContent();
      expect((emptyText || '').length).toBeGreaterThan(PLAYBOOK_OVERFLOW_THRESHOLD_CHARS);

      // The `@media (max-width: 600px)` phone shape does not apply here, so
      // the empty state sizes itself to its content in normal flow — this is
      // the "clean" leg of the LIN-2715 investigation's own scope table
      // (mobile-only), kept as a regression guard against the fix
      // accidentally widening its reach or narrowing the breakpoint.
      const overStart = await measurePaintedOverlap(page, '#flight-companion-chat-empty', '#flight-companion-start');
      expect(overStart.overlapArea).toBe(0);

      await expect(page.locator('#flight-companion-start')).toBeInViewport();
      await page.locator('#flight-companion-start').click({ trial: true, timeout: 2000 });
    });
  });
});
