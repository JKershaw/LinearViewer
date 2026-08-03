/**
 * Unit tests for lib/render-passage-planner.js (LIN-1849).
 *
 * Covers the render-time proxy-availability gate: `data-proxy-available`
 * always reflects `featureFlags.proxy === true` (never `data-proxy-feature`,
 * which nothing on this page reads), and a degradation notice + Settings
 * link appear only when proxy access is off. Mirrors
 * tests/unit/render-flight-companion.test.js.
 *
 * Run with: node --test tests/unit/render-passage-planner.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPassagePlannerPage } from '../../lib/render-passage-planner.js';

describe('renderPassagePlannerPage — proxy availability gating', () => {
  test('proxy: true → no degradation notice, data-proxy-available="true", no data-proxy-feature', () => {
    const html = renderPassagePlannerPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: true } });
    assert.ok(html.includes('data-proxy-available="true"'));
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(!html.includes('passage-planner-degraded'));
    assert.ok(!/requires workspace API access/.test(html));
  });

  test('proxy: false → degradation notice + Settings link, data-proxy-available="false"', () => {
    const html = renderPassagePlannerPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: false } });
    assert.ok(html.includes('data-proxy-available="false"'));
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(/requires workspace API access/.test(html));
    assert.ok(/will not include the access block/.test(html));
    assert.match(html, /href="\/workspace\/ws\/settings"/);
  });

  test('no-featureFlags call path (page-title-primitive.test.js) renders cleanly, treated as proxy off', () => {
    const html = renderPassagePlannerPage({}, { urlKey: 'ws' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('data-proxy-available="false"'));
    assert.ok(!html.includes('data-proxy-feature'));
  });
});
