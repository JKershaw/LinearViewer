/**
 * LIN-1737 Beat 1 — the Suggested Next Run page's task-budget dial (D3): five
 * preset chips (5/10/25/50/100) plus a free numeric entry, rendered beside the
 * Generate button. LIN-3849 removed the proxy switch that used to disable it,
 * so the dial is always enabled and the explanatory hint is gone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNextRunPage } from '../../lib/render-next-run.js';

test('the dial renders enabled, with all five presets and no hint', () => {
  for (const featureFlags of [{}, { proxy: false }]) {
    const html = renderNextRunPage({}, { urlKey: 'acme', featureFlags });
    assert.ok(html.includes('id="next-run-budget-input"'), 'budget input present');
    assert.doesNotMatch(html, /id="next-run-budget-input"[^>]*disabled/, 'input not disabled');
    for (const n of [5, 10, 25, 50, 100]) {
      assert.ok(html.includes(`data-value="${n}"`), `preset ${n} present`);
    }
    assert.doesNotMatch(html, /next-run-budget-preset[^>]*disabled/, 'presets not disabled');
    assert.ok(!html.includes('id="next-run-budget-hint"'), 'no inline explanation');
    assert.ok(!html.includes('aria-describedby'), 'nothing to describe');
  }
});
