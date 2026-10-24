/**
 * Unit tests for lib/render-passage-planner.js (LIN-1849).
 *
 * LIN-3849 removed the per-user `proxy` switch: the page no longer emits
 * `data-proxy-available` (or `data-proxy-feature`) or a degradation notice, and
 * the copy handler always force-appends the access block
 * (tests/e2e/passage-planner-proxy-copy.spec.js). Mirrors
 * tests/unit/render-flight-companion.test.js.
 *
 * Run with: node --test tests/unit/render-passage-planner.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPassagePlannerPage } from '../../lib/render-passage-planner.js';

describe('renderPassagePlannerPage — no proxy switch', () => {
  for (const [name, featureFlags] of [['no flags', {}], ['stale proxy:true', { proxy: true }], ['stale proxy:false', { proxy: false }]]) {
    test(`${name} → no availability attribute, no degradation notice`, () => {
      const html = renderPassagePlannerPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags });
      assert.ok(!html.includes('data-proxy-available'));
      assert.ok(!html.includes('data-proxy-feature'));
      assert.ok(!html.includes('passage-planner-degraded'));
      assert.ok(!/requires workspace API access/.test(html));
      assert.ok(html.includes('id="passage-planner-copy"'));
    });
  }

  test('no-featureFlags call path (page-title-primitive.test.js) renders cleanly', () => {
    const html = renderPassagePlannerPage({}, { urlKey: 'ws' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
  });
});
