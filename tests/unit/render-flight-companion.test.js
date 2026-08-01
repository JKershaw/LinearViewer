/**
 * Unit tests for lib/render-flight-companion.js (LIN-1764).
 *
 * Covers the +proxy toggle affordance: the button and its enabling
 * `data-proxy-feature` body attribute must appear iff `featureFlags.proxy ===
 * true`, and the no-`featureFlags` call path used elsewhere (e.g.
 * tests/unit/page-title-primitive.test.js) must keep rendering cleanly without
 * either.
 *
 * Run with: node --test tests/unit/render-flight-companion.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderFlightCompanionPage } from '../../lib/render-flight-companion.js';

describe('renderFlightCompanionPage — +proxy toggle gating', () => {
  test('renders the +proxy toggle and data-proxy-feature attribute when featureFlags.proxy === true', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: true } });
    assert.ok(html.includes('data-proxy-feature="true"'));
    assert.match(html, /<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">\+proxy<\/button>/);
  });

  test('omits the +proxy toggle and data-proxy-feature attribute when featureFlags.proxy is false', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: false } });
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(!html.includes('prompt-proxy-toggle'));
  });

  test('the default no-featureFlags call path (page-title-primitive.test.js) renders cleanly with neither', () => {
    const html = renderFlightCompanionPage({}, { urlKey: 'ws' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(!html.includes('prompt-proxy-toggle'));
  });
});
