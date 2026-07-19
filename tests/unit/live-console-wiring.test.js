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
  assert.match(html, /id="live-console-tempo"/);
  // Loads its own scoped assets.
  assert.match(html, /\/live-console\.css/);
  assert.match(html, /\/live-console\.js/);
});
