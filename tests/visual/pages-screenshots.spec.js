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
// (dispatch / roadmap / proxy + foreman). Encoded once for the set-session call.
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

  test('foreman', async ({ page }) => {
    await capture(page, `/workspace/${URL_KEY}/foreman`, 'foreman');
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
