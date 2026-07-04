/**
 * Unit coverage for the shared header view switcher (LIN-978).
 *
 * Pins the two contracts the keystone rests on:
 *   1. `getViewNavLinks` tier/flag gating — first-class always, power-user only
 *      when flagged, experimental NEVER here.
 *   2. `renderViewNav` markup — single-source-of-truth list rendered into the
 *      nav bar with stable `nav-view-<text>` testids and key-equality active
 *      matching; the footer no longer carries these links.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getViewNavLinks, renderViewNav } from '../../lib/components/view-nav.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderPageFooter } from '../../lib/components/footer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

// --- tier / flag gating -----------------------------------------------------

test('getViewNavLinks always includes the first-class views, workspace-prefixed', () => {
  const links = getViewNavLinks('acme', {});
  const texts = links.map(l => l.text);
  assert.deepEqual(texts, ['observation', 'swipe', 'swim', 'settings']);
  for (const link of links) {
    assert.match(link.href, /^\/workspace\/acme\//);
  }
});

test('getViewNavLinks adds power-user views ONLY when their flag is on', () => {
  const off = getViewNavLinks('acme', {}).map(l => l.text);
  assert.ok(!off.includes('roadmap'));
  assert.ok(!off.includes('dispatch'));
  assert.ok(!off.includes('proxy'));

  const on = getViewNavLinks('acme', { roadmap: true, dispatch: true, proxy: true }).map(l => l.text);
  assert.ok(on.includes('roadmap'));
  assert.ok(on.includes('dispatch'));
  assert.ok(on.includes('proxy'));

  // A non-true value must NOT enable the link (strict `=== true` gate).
  const truthyButNotTrue = getViewNavLinks('acme', { dispatch: 1 }).map(l => l.text);
  assert.ok(!truthyButNotTrue.includes('dispatch'));
});

test('getViewNavLinks NEVER surfaces experimental views (Settings-only tier)', () => {
  const texts = getViewNavLinks('acme', {
    collective: true, taskChat: true, ship: true, nextRun: true, flightCompanion: true
  }).map(l => l.text);
  for (const experimental of ['collective', 'taskChat', 'ship', 'nextRun', 'flightCompanion', 'task-chat', 'next-run', 'flight-companion']) {
    assert.ok(!texts.includes(experimental), `${experimental} must stay Settings-only`);
  }
});

// --- switcher markup --------------------------------------------------------

test('renderViewNav emits stable nav-view-<text> testids for each link', () => {
  const html = renderViewNav({ urlKey: 'acme', currentPage: 'swim', featureFlags: {} });
  assert.match(html, /class="nav-views"/);
  for (const text of ['observation', 'swipe', 'swim', 'settings']) {
    assert.match(html, new RegExp(`data-testid="nav-view-${text}"`));
  }
});

test('renderViewNav marks the active view via key-equality (bare currentPage)', () => {
  const html = renderViewNav({ urlKey: 'acme', currentPage: 'swim', featureFlags: {} });
  // Active view is a bold non-link with aria-current, others are anchors.
  assert.match(html, /<strong class="nav-view nav-view-current" data-testid="nav-view-swim" aria-current="page">swim<\/strong>/);
  // A non-active view (settings) is rendered as an anchor.
  assert.match(html, /<a [^>]*data-testid="nav-view-settings"/);
  // The active one is NOT also rendered as an anchor.
  assert.doesNotMatch(html, /<a [^>]*data-testid="nav-view-swim"/);
});

test('renderViewNav returns empty string without a urlKey (nothing to navigate to)', () => {
  assert.equal(renderViewNav({ urlKey: null, currentPage: 'swim' }), '');
});

// --- nav-bar integration ----------------------------------------------------

test('renderNavBar carries the view switcher on authenticated workspace pages', () => {
  const html = renderNavBar({
    workspaces: [{ urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage: 'settings',
    featureFlags: { dispatch: true }
  });
  assert.match(html, /class="nav-views"/);
  assert.match(html, /data-testid="nav-view-observation"/);
  assert.match(html, /data-testid="nav-view-settings"/);
  // Flagged power-user view is present when its flag is on.
  assert.match(html, /data-testid="nav-view-dispatch"/);
  // The active page (settings) is the bold current marker.
  assert.match(html, /nav-view-current" data-testid="nav-view-settings"/);
});

test('renderNavBar does NOT carry the view switcher on the landing nav', () => {
  const html = renderNavBar({ isLanding: true });
  assert.doesNotMatch(html, /class="nav-views"/);
  assert.doesNotMatch(html, /nav-view-observation/);
});

// --- footer no longer carries the hoisted links -----------------------------

test('renderPageFooter no longer renders the cross-view links (hoisted to header)', () => {
  const html = renderPageFooter({ urlKey: 'acme', currentPage: '/settings', featureFlags: { dispatch: true, proxy: true, roadmap: true } });
  // The old footer view links are gone.
  for (const text of ['observation', 'swipe', 'swim', 'settings', 'roadmap', 'dispatch', 'proxy']) {
    assert.doesNotMatch(html, new RegExp(`data-testid="footer-link-${text}"`));
  }
});

test('renderPageFooter still shows reset (a client action, not a view link) when asked', () => {
  const withReset = renderPageFooter({ urlKey: 'acme', currentPage: '/', showReset: true });
  assert.match(withReset, /class="footer-action reset-view"/);
  assert.match(withReset, /class="footer-actions"/);

  // With no reset and no view links, the footer emits no empty actions row.
  const noReset = renderPageFooter({ urlKey: 'acme', currentPage: '/settings' });
  assert.doesNotMatch(noReset, /class="footer-actions"/);
});

// --- CSS contract -----------------------------------------------------------

test('style.css lays the switcher out as a single non-wrapping scrolling row', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf('.nav-views {'));
  assert.match(block, /flex-wrap:\s*nowrap/);
  assert.match(block, /overflow-x:\s*auto/);
  assert.match(block, /white-space:\s*nowrap/);
});

test('the shared nav is pinned (position:sticky) with the click-intercept fix (LIN-984)', () => {
  // LIN-984 restores the retired obs-appbar sticky/translucent treatment. A
  // naïve sticky header USED to overlay scrolled content and steal pointer
  // events from controls beneath it (it broke ship-orientation), so the pinned
  // header ships ONLY alongside the two-part interception fix:
  //   1. a z-band (`--z-header`) that keeps the header below page-level fixed
  //      overlay controls (`--z-header-control`), so those controls win the
  //      hit-test where they overlap the pinned bar; and
  //   2. per-interaction `scroll-margin-top` so scrolled content clears the bar.
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf('.nav-bar {'), css.indexOf('/* Per-interaction scroll-margin'));
  assert.match(block, /position:\s*sticky;/);
  assert.match(block, /top:\s*0;/);
  assert.match(block, /z-index:\s*var\(--z-header\);/);
  // Translucent/blur treatment carried over from the obs-appbar.
  assert.match(block, /backdrop-filter:\s*blur/);

  // The header band must stay strictly below the fixed-overlay-control band, or
  // the pinned header would swallow clicks on Ship's mode/zoom toggles again.
  const header = Number(css.match(/--z-header:\s*(\d+);/)[1]);
  const headerControl = Number(css.match(/--z-header-control:\s*(\d+);/)[1]);
  assert.ok(header < headerControl, '--z-header must sit below --z-header-control');

  // The per-interaction scroll-margin offset (NOT scroll-padding, which
  // Playwright's scroll-into-view ignores) must be present for scrolled content.
  assert.match(css, /scroll-margin-top:\s*7rem;/);
});

test('Ship fixed overlay controls sit in the header-control band, above the pinned nav (LIN-984)', () => {
  // The mode/zoom toggles are position:fixed near the top and overlap the pinned
  // header; they must occupy `--z-header-control` so the translucent nav never
  // intercepts their clicks (the ship-orientation regression guard's CSS twin).
  const shipCss = readFileSync(new URL('../../public/ship.css', import.meta.url), 'utf8');
  const mode = shipCss.slice(shipCss.indexOf('.ship-mode-control {'), shipCss.indexOf('.ship-mode-btn {'));
  assert.match(mode, /z-index:\s*var\(--z-header-control\);/);
});
