/**
 * Unit coverage for the Live Console experimental-view wiring + page renderer
 * (LIN-1436).
 *
 * Two contracts:
 *   1. The feature is a proper experimental view — present in FEATURES with an
 *      off default, a Settings label + description, and (crucially) a membership
 *      row in the shared EXPERIMENTAL_VIEWS source of truth so Settings AND the
 *      nav overflow surface it without drift.
 *   2. renderLiveConsolePage emits the ambient shell — stable testids, the
 *      embedded client config, and the stream/pulse/tempo mount points the
 *      client script fills.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURES,
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  FEATURE_DESCRIPTIONS,
  EXPERIMENTAL_VIEWS,
  getFeatureFlags,
} from '../../lib/feature-defaults.js';
import { getViewNavLinks } from '../../lib/components/view-nav.js';
import { renderLiveConsolePage } from '../../lib/render-live-console.js';

// ─── feature wiring ───────────────────────────────────────────────────────────

test('liveConsole is a registered feature, defaulting OFF, with label + description', () => {
  assert.equal(FEATURES.LIVE_CONSOLE, 'liveConsole');
  assert.equal(FEATURE_DEFAULTS.liveConsole, false);
  assert.ok(FEATURE_LABELS.liveConsole, 'has a settings label');
  assert.ok(FEATURE_DESCRIPTIONS.liveConsole, 'has a settings description');
});

test('liveConsole is in the shared EXPERIMENTAL_VIEWS list mapped to the live-console route', () => {
  const row = EXPERIMENTAL_VIEWS.find(v => v.flag === 'liveConsole');
  assert.ok(row, 'liveConsole has an EXPERIMENTAL_VIEWS row');
  assert.equal(row.path, 'live-console');
});

test('getFeatureFlags keeps liveConsole off by default and honours an explicit toggle', () => {
  assert.equal(getFeatureFlags({}).liveConsole, false);
  assert.equal(getFeatureFlags({ features: { liveConsole: true } }).liveConsole, true);
});

test('nav surfaces live-console ONLY when the flag is on (gated inclusion)', () => {
  assert.ok(!getViewNavLinks('acme', {}).map(l => l.text).includes('live-console'));
  const on = getViewNavLinks('acme', { liveConsole: true }).map(l => l.text);
  assert.ok(on.includes('live-console'));
  // strict === true gate
  assert.ok(!getViewNavLinks('acme', { liveConsole: 1 }).map(l => l.text).includes('live-console'));
});

// ─── renderer ─────────────────────────────────────────────────────────────────

test('renderLiveConsolePage emits the ambient shell with stable mount points', () => {
  const html = renderLiveConsolePage({
    deployInfo: {},
    urlKey: 'acme',
    workspaces: [{ urlKey: 'acme', name: 'Acme' }],
    featureFlags: { liveConsole: true },
  });
  assert.match(html, /<!DOCTYPE html>/);
  // Client config embedded for the poll.
  assert.match(html, /__LIVE_CONSOLE_DATA__/);
  assert.match(html, /"urlKey":"acme"/);
  // Stable testids / mount points the client fills.
  assert.match(html, /data-testid="live-console-stream"/);
  assert.match(html, /data-testid="live-console-lanes"/);
  assert.match(html, /data-testid="live-console-chips"/);
  assert.match(html, /id="live-console-tempo"/);
  // Loads its own scoped assets.
  assert.match(html, /\/live-console\.css/);
  assert.match(html, /\/live-console\.js/);
});

// ─── timeline (LIN-1742, Phase 1: static, non-zoomable last-24h swimlane) ────

test('renderer emits the timeline section mount points', () => {
  const html = renderLiveConsolePage({ urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }], featureFlags: { liveConsole: true } });
  assert.match(html, /class="lc-timeline-section"/);
  assert.match(html, /data-testid="live-console-timeline"/);
  assert.match(html, /id="live-console-timeline-axis"/);
  assert.match(html, /id="live-console-timeline-empty"[^>]*hidden/);
  assert.match(html, /data-testid="live-console-timeline-preset-1h"/);
  assert.match(html, /data-testid="live-console-timeline-preset-24h"/);
});

test('mount order is pulse → chips → timeline → lanes → stream — no existing element moves', () => {
  const html = renderLiveConsolePage({ urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }], featureFlags: { liveConsole: true } });
  const idx = (needle) => html.indexOf(needle);
  const pulse = idx('class="lc-pulse"');
  const chips = idx('id="live-console-chips"');
  const timeline = idx('class="lc-timeline-section"');
  const lanes = idx('class="lc-lanes-section"');
  const stream = idx('class="lc-stream-section"');
  assert.ok(pulse < chips && chips < timeline && timeline < lanes && lanes < stream, 'mount points out of order');
});

test('only the axis+bars sub-wrapper breaks full-bleed — the label/presets are NOT inside it', () => {
  // Regression guard for the bug found in manual verification: an earlier
  // version put the 100vw breakout on the WHOLE `.lc-timeline-section`
  // (label included), which a `.lc-page`-level clip guard then hid entirely
  // on a normal desktop viewport (`.lc-page` is a narrow, centered 900px box,
  // not full-viewport-width, at any width above ~930px). The fix scopes the
  // breakout to a `.lc-timeline-breakout` child that wraps ONLY the axis and
  // bars viewport, so the label/presets stay in `.lc-page`'s normal column.
  const html = renderLiveConsolePage({ urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }], featureFlags: { liveConsole: true } });
  const sectionOpen = html.indexOf('class="lc-timeline-section"');
  const breakoutOpen = html.indexOf('class="lc-timeline-breakout"');
  const labelOpen = html.indexOf('class="lc-section-label"', sectionOpen);
  const presetsOpen = html.indexOf('class="lc-timeline-presets"');
  assert.ok(breakoutOpen > 0, '.lc-timeline-breakout must exist');
  // Label + presets precede the breakout wrapper — they are siblings BEFORE
  // it, not descendants of it.
  assert.ok(labelOpen > sectionOpen && labelOpen < breakoutOpen);
  assert.ok(presetsOpen > sectionOpen && presetsOpen < breakoutOpen);
  // The axis + bars-viewport mount points ARE inside the breakout wrapper.
  const axisOpen = html.indexOf('id="live-console-timeline-axis"');
  const viewportOpen = html.indexOf('data-testid="live-console-timeline"');
  assert.ok(axisOpen > breakoutOpen);
  assert.ok(viewportOpen > breakoutOpen);
});

test('renderer puts aria-live on the banner status, NOT on the wholesale-replaced stream list', () => {
  const html = renderLiveConsolePage({ urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }], featureFlags: { liveConsole: true } });
  // The status line is the polite live region…
  assert.match(html, /id="live-console-status"[^>]*aria-live="polite"/);
  // …and the stream <ol> is NOT (it is fully re-rendered each poll).
  const streamTag = html.match(/<ol[^>]*id="live-console-stream"[^>]*>/)[0];
  assert.ok(!/aria-live/.test(streamTag), 'stream <ol> must not carry aria-live');
});

test('renderer embeds the workspace list for client-side chip filtering', () => {
  const html = renderLiveConsolePage({
    urlKey: 'acme',
    workspaces: [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'beta', name: 'Beta' }],
    featureFlags: { liveConsole: true },
  });
  assert.match(html, /"workspaces":\[/);
  assert.match(html, /"urlKey":"beta"/);
});
