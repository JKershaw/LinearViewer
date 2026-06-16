/**
 * Unit tests for provider-aware client display strings (LIN-177 S3).
 *
 * The swipe page renders its "View in {provider}" / "Open … in
 * {provider}" strings client-side, so the active provider's display name is
 * injected from the server via `window.__SWIPE_DATA__.providerDisplayName`.
 * These tests pin that injection and its Linear back-compat fallback.
 *
 * Run with: node --test tests/unit/render-provider-strings.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderShipPage } from '../../lib/render-ship.js';
import { renderSwimPage } from '../../lib/render-swim.js';
// Side-effect import: registers the Linear provider so the fallback resolves.
import '../../lib/providers/linear/index.js';
import { registerProvider } from '../../lib/providers/registry.js';

describe('swipe page provider display name (LIN-177 S3)', () => {
  const emptyData = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };

  test('injects the active provider displayName into __SWIPE_DATA__', () => {
    registerProvider({ name: 'swipe-stub', ui: { displayName: 'Stub Tracker' } });
    const html = renderSwipePage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws', provider: 'swipe-stub' }]
    });
    assert.ok(html.includes('"providerDisplayName":"Stub Tracker"'), 'stub display name injected');
  });

  test('falls back to Linear for a legacy workspace (no provider field)', () => {
    const html = renderSwipePage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws' }]
    });
    assert.ok(html.includes('"providerDisplayName":"Linear"'), 'Linear fallback injected');
  });
});


// LIN-356 (carry-forward of LIN-177 S3 finding F1): the ship/swim popover
// "View in {provider} →" link is server-rendered static HTML, so the provider
// display name is interpolated server-side (not via a client data blob like
// swipe). These pin the interpolation and its Linear fallback.
describe('ship page provider display name (LIN-356 / F1)', () => {
  const emptyData = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };

  test('interpolates the active provider displayName into the popover link', () => {
    registerProvider({ name: 'ship-stub', ui: { displayName: 'Stub Tracker' } });
    const html = renderShipPage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws', provider: 'ship-stub' }]
    });
    assert.ok(html.includes('View in Stub Tracker &rarr;'), 'stub display name interpolated');
    assert.ok(!html.includes('View in Linear &rarr;'), 'no hardcoded Linear string remains');
  });

  test('falls back to Linear for a legacy workspace (no provider field)', () => {
    const html = renderShipPage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws' }]
    });
    assert.ok(html.includes('View in Linear &rarr;'), 'Linear fallback');
  });

  test('falls back to Linear on the landing path (no workspaces/urlKey)', () => {
    const html = renderShipPage(emptyData, { isLanding: true });
    assert.ok(html.includes('View in Linear &rarr;'), 'Linear fallback on landing');
  });
});

describe('swim page provider display name (LIN-356 / F1)', () => {
  const emptyData = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };

  test('interpolates the active provider displayName into the popover link', () => {
    registerProvider({ name: 'swim-stub', ui: { displayName: 'Stub Tracker' } });
    const html = renderSwimPage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws', provider: 'swim-stub' }]
    });
    assert.ok(html.includes('View in Stub Tracker &rarr;'), 'stub display name interpolated');
    assert.ok(!html.includes('View in Linear &rarr;'), 'no hardcoded Linear string remains');
  });

  test('falls back to Linear for a legacy workspace (no provider field)', () => {
    const html = renderSwimPage(emptyData, {
      urlKey: 'ws',
      workspaces: [{ id: 'w1', urlKey: 'ws' }]
    });
    assert.ok(html.includes('View in Linear &rarr;'), 'Linear fallback');
  });

  test('falls back to Linear on the landing path (no workspaces/urlKey)', () => {
    const html = renderSwimPage(emptyData, { isLanding: true });
    assert.ok(html.includes('View in Linear &rarr;'), 'Linear fallback on landing');
  });
});
