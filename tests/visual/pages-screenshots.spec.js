/**
 * Core Pages Screenshot Maker (LIN-458, Phase 0D).
 *
 * Expands the visual-regression baseline beyond the ship/swim families to the
 * rest of the app's pages, so the upcoming token/CSS consolidation (Phase A)
 * can be *proven* non-regressing rather than eyeballed. Additive only: this
 * adds new specs + a new `tests/screenshots/pages/` output dir; it does not
 * touch the existing ship/swim makers or their baselines.
 *
 * Like the other makers in this directory, these specs WRITE PNGs and do not
 * assert — run them manually to refresh the reference set:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/pages-screenshots.spec.js
 * Not part of `npm test`.
 *
 * Output: tests/screenshots/pages/<page>-{desktop,mobile}.png
 *
 * Data seam (deliberate): these ride the same mock-fixture path the ship/swim
 * makers do — `/test/set-session` (the `test-token` → `testMockData` arm at
 * server.js, the documented boundary mock) for authenticated pages, and the
 * public no-session render for the static pages. Per the local-harness boundary
 * note, visual specs stay pinned to the mock fixtures (NOT the local provider)
 * so the committed reference screenshots stay stable. The session is
 * re-established before each capture because a reused test-token session
 * degrades on re-render (its short-lived token expires); the ship/swim makers
 * re-seed in beforeEach for the same reason.
 */
import { test } from '../fixtures/test-base.js';

const URL_KEY = 'test-workspace';
const DIR = 'tests/screenshots/pages';

// Pages live behind their feature flags; enable the ones whose pages we capture
// (dispatch / roadmap / proxy). Encoded once for the set-session call.
const FEATURES = encodeURIComponent(
  JSON.stringify({ dispatch: true, roadmap: true, proxy: true })
);

const DESKTOP = { width: 1400, height: 1000 };
const MOBILE = { width: 390, height: 844 };

test.describe.configure({ mode: 'serial' });

/**
 * Capture a page at desktop + mobile widths. `settleMs` gives canvas/animation
 * pages (kpis charts, roadmap) a beat to finish drawing after networkidle.
 */
async function capture(page, path, name, { settleMs = 0 } = {}) {
  await page.setViewportSize(DESKTOP);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (settleMs) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${DIR}/${name}-desktop.png`, fullPage: true });

  await page.setViewportSize(MOBILE);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  if (settleMs) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${DIR}/${name}-mobile.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
// Static / public pages — no session. The styleguide (0C) is the single
// richest, deterministic target; legal + kpis round out the public surface.
// ---------------------------------------------------------------------------
test.describe('Static pages', () => {
  // The unauthenticated home is the bespoke Harbour showcase (LIN-980) — the
  // richest public surface. Captured in light and dark so the showcase's
  // dark-safety is provable rather than eyeballed.
  test('landing', async ({ page }) => {
    await capture(page, '/', 'landing');
    await page.emulateMedia({ colorScheme: 'dark' });
    await capture(page, '/', 'landing-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('styleguide', async ({ page }) => {
    await capture(page, '/styleguide', 'styleguide');
  });

  test('privacy', async ({ page }) => {
    await capture(page, '/privacy', 'privacy');
  });

  test('terms', async ({ page }) => {
    await capture(page, '/terms', 'terms');
  });

  test('kpis', async ({ page }) => {
    // Chart.js draws to <canvas> after load — let the charts settle.
    await capture(page, '/kpis', 'kpis', { settleMs: 800 });
  });

  test('templates', async ({ page }) => {
    await capture(page, '/templates', 'templates');
  });
});

// ---------------------------------------------------------------------------
// Authenticated pages — fresh test-token session per capture.
// ---------------------------------------------------------------------------
test.describe('Authenticated pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATURES}`);
  });

  test('dashboard', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/`, 'dashboard');
  });

  test('settings', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/settings`, 'settings');
  });

  test('roadmap', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/roadmap`, 'roadmap', { settleMs: 300 });
  });

  test('dispatch', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/dispatch`, 'dispatch');
  });

  test('prompts', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/prompts`, 'prompts');
  });

  test('custom-prompts', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/prompts/custom`, 'custom-prompts');
  });

  test('proxy', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/proxy`, 'proxy');
  });

  test('audit', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/audit`, 'audit');
  });
});

// ---------------------------------------------------------------------------
// Swipe — needs the swim/ship sample fixture (blocking graph) for a meaningful
// card, so it rides the `swimSample` mock arm rather than the bare session.
// ---------------------------------------------------------------------------
test.describe('Swipe page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session?swimSample=true');
  });

  test('swipe', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/swipe`, 'swipe');
  });
});

// ---------------------------------------------------------------------------
// Overlays — shared modal + toast primitives (LIN-506, Wave F).
//
// The convergence work (LIN-495) made `window.showModal`/`window.toast` in
// common.js the SINGLE implementations of these primitives. The page-level
// `goto()+fullPage` capture above structurally cannot represent them: they are
// position:fixed overlays that only exist after an interaction. So, like ship
// test 03 (a click then a viewport screenshot), these specs drive the page into
// the overlay state first, then capture the viewport (NOT fullPage — a fixed
// overlay does not belong in a full-page scroll capture).
//
// We invoke the canonical helpers directly rather than chasing a real click
// path: the only in-app trigger for the styled modal is a successful token mint
// (network-dependent, not deterministic here), whereas calling the shared
// helper renders the exact converged primitive every time. The modal uses the
// real `token-modal` className (the only styled variant — bare `modal` has no
// CSS) with the same body markup dispatch.js/proxy.js show on token creation.
// ---------------------------------------------------------------------------
test.describe('Overlays (modal / toast)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATURES}`);
    // The dispatch page loads common.js (showModal/toast) + escapeHtml.
    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');
  });

  test('modal', async ({ page }) => {
    await page.evaluate(() => {
      const token = 'lin_proxy_EXAMPLE0TOKEN0FOR0SCREENSHOT0ONLY';
      const bodyHtml = `
        <p>Copy this token now - it won't be shown again:</p>
        <div class="token-display">
          <span class="token-value">${window.escapeHtml(token)}</span>
          <button class="token-copy-btn">copy</button>
        </div>
        <div class="token-usage-hint">
          Use in Authorization header:<br>
          <code>Authorization: Bearer &lt;token&gt;</code>
        </div>`;
      window.showModal({ className: 'token-modal', title: 'Token Created', bodyHtml });
    });
    await page.waitForSelector('.token-modal');

    await page.setViewportSize(DESKTOP);
    await page.screenshot({ path: `${DIR}/overlay-modal-desktop.png` });

    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${DIR}/overlay-modal-mobile.png` });
  });

  test('toast', async ({ page }) => {
    // Long duration so the toasts stay put for the capture (default auto-dismiss
    // is 4s). Both variants stacked shows the info + error treatments together.
    await page.evaluate(() => {
      window.toast('Queued prompt for LIN-123', { type: 'info', duration: 60000 });
      window.toast('Failed to remove item: request timed out', { type: 'error', duration: 60000 });
    });
    // Let the requestAnimationFrame entrance transition (toast-visible) settle.
    await page.waitForSelector('.toast-visible');
    await page.waitForTimeout(300);

    await page.setViewportSize(DESKTOP);
    await page.screenshot({ path: `${DIR}/overlay-toast-desktop.png` });

    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${DIR}/overlay-toast-mobile.png` });
  });
});

// ---------------------------------------------------------------------------
// Collective page — DEFERRED (LIN-506, Wave F), per the LIN-492 convention of
// logging a deferral rather than silently skipping. A committed baseline needs
// the captured pixels to be deterministic; collective is not, and no CHEAP seam
// exists to make it so:
//   1. The channel name is `randomChannelName()` (random words + today's UTC
//      date) generated server-side per request at routes/collective.js, with no
//      request/session input wired to pin it — so the channel string in the
//      input + label varies every run.
//   2. This visual config's web server does NOT set YAP_BASE_URL (unlike the
//      base playwright.config.js), so the live view renders "Yap not
//      configured" rather than a real transcript.
// Making it deterministic would mean adding a production-route test seam purely
// for a screenshot — explicitly out of scope for this PNG-artifact task. Revisit
// if a channel-pin seam lands.
// ---------------------------------------------------------------------------
test.describe('Collective page', () => {
  test.skip('collective (deferred — non-deterministic channel + no mock Yap wired here)', () => {});
});
