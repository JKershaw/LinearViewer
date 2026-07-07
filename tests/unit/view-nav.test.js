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

import { getViewNavLinks, renderViewNav, partitionViewLinks } from '../../lib/components/view-nav.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderPageFooter } from '../../lib/components/footer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

// --- tier / flag gating -----------------------------------------------------

test('getViewNavLinks always includes the first-class views, workspace-prefixed', () => {
  const links = getViewNavLinks('acme', {});
  const texts = links.map(l => l.text);
  assert.deepEqual(texts, ['observation', 'swipe', 'swim', 'projects', 'settings']);
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
  for (const text of ['observation', 'swipe', 'swim', 'projects', 'settings']) {
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

// --- primary/overflow split + active-hoist (LIN-1058 "Confident CLI tab strip") -

test('partitionViewLinks splits first-class (primary) from flag-gated (overflow)', () => {
  const links = getViewNavLinks('acme', { roadmap: true, dispatch: true, proxy: true });
  const { primary, overflow } = partitionViewLinks(links, 'observation');
  assert.deepEqual(primary.map(l => l.text), ['observation', 'swipe', 'swim', 'projects', 'settings']);
  assert.deepEqual(overflow.map(l => l.text), ['roadmap', 'dispatch', 'proxy']);
});

test('partitionViewLinks HOISTS the active overflow view inline (never hidden)', () => {
  const links = getViewNavLinks('acme', { roadmap: true, dispatch: true, proxy: true });
  const { primary, overflow } = partitionViewLinks(links, 'dispatch');
  // Active flag-gated view is lifted onto the primary strip, after the five.
  assert.deepEqual(primary.map(l => l.text), ['observation', 'swipe', 'swim', 'projects', 'settings', 'dispatch']);
  // …and removed from overflow so it is not rendered twice.
  assert.deepEqual(overflow.map(l => l.text), ['roadmap', 'proxy']);
});

test('renderViewNav emits the ⋯ more toggle + in-flow overflow group ONLY when flag-gated views exist', () => {
  const withFlags = renderViewNav({ urlKey: 'acme', currentPage: 'observation', featureFlags: { dispatch: true } });
  assert.match(withFlags, /class="nav-more-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="nav-views-overflow"/);
  assert.match(withFlags, /<div class="nav-views-overflow" id="nav-views-overflow">/);
  assert.match(withFlags, /data-testid="nav-view-dispatch"/);

  // No flag-gated views → no overflow machinery (first-class four only).
  const noFlags = renderViewNav({ urlKey: 'acme', currentPage: 'observation', featureFlags: {} });
  assert.doesNotMatch(noFlags, /nav-more-toggle/);
  assert.doesNotMatch(noFlags, /nav-views-overflow/);
});

test('renderViewNav renders the active overflow view as the hoisted current tab (not inside the expander)', () => {
  const html = renderViewNav({ urlKey: 'acme', currentPage: 'dispatch', featureFlags: { dispatch: true, proxy: true } });
  // Active dispatch is the bold current marker, hoisted onto the primary strip
  // BEFORE the overflow group opens.
  const overflowStart = html.indexOf('nav-views-overflow');
  const dispatchCurrent = html.indexOf('nav-view-current" data-testid="nav-view-dispatch"');
  assert.ok(dispatchCurrent !== -1, 'active dispatch renders as the current marker');
  assert.ok(dispatchCurrent < overflowStart, 'hoisted active tab precedes the overflow group');
  // proxy remains collapsed in the overflow group as a plain anchor.
  assert.match(html, /<div class="nav-views-overflow"[^>]*>[\s\S]*data-testid="nav-view-proxy"[\s\S]*<\/div>/);
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
  assert.match(html, /data-testid="nav-view-projects"/);
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

test('the shared nav is pinned (sticky/translucent) with the interception fix (LIN-984)', () => {
  // LIN-984 restored the retired obs-appbar treatment onto the shared header:
  // the nav pins to the top with a translucent wash. The pointer-interception
  // hazard that backed this out (a pinned header swallows clicks on controls
  // scrolled beneath it — it broke ship-orientation) is solved with
  // PER-INTERACTION `scroll-margin-top` on interactive controls, NOT
  // `scroll-padding-top` on the scroll container (which the retired attempt
  // proved does not fix it).
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf('.nav-bar {'), css.indexOf('/* Header-level view switcher'));
  assert.match(block, /position:\s*sticky;/);
  assert.match(block, /top:\s*0;/);
  // Translucent wash + blur — the restored obs-appbar feel.
  assert.match(block, /color-mix\(in srgb, var\(--bg\)/);
  assert.match(block, /backdrop-filter:\s*blur/);
  // The interception fix rides on scroll-margin, keyed off the header clearance,
  // and explicitly NOT scroll-padding.
  assert.match(block, /scroll-margin-top:\s*var\(--nav-sticky-h\)/);
  assert.doesNotMatch(block, /scroll-padding-top:/);
});
