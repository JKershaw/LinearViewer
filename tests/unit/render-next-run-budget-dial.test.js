/**
 * LIN-1737 Beat 1 — the Suggested Next Run page's task-budget dial (D3): five
 * preset chips (5/10/25/50/100) plus a free numeric entry, rendered beside the
 * Generate button. Disabled — not hidden — with an inline explanation when the
 * proxy feature is off, since the dial dispatches through the same proxy-gated
 * kickoff every option's `Dispatch ▾` uses (review finding B2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNextRunPage } from '../../lib/render-next-run.js';

test('proxy on ⇒ the dial renders enabled, with all five presets and no hint', () => {
  const html = renderNextRunPage({}, { urlKey: 'acme', featureFlags: { proxy: true } });
  assert.ok(html.includes('id="next-run-budget-input"'), 'budget input present');
  assert.doesNotMatch(html, /id="next-run-budget-input"[^>]*disabled/, 'input not disabled');
  for (const n of [5, 10, 25, 50, 100]) {
    assert.ok(html.includes(`data-value="${n}"`), `preset ${n} present`);
  }
  assert.doesNotMatch(html, /next-run-budget-preset[^>]*disabled/, 'presets not disabled');
  assert.ok(!html.includes('id="next-run-budget-hint"'), 'no inline explanation when proxy is on');
});

test('proxy off ⇒ the dial is disabled, not hidden, with an inline explanation', () => {
  const html = renderNextRunPage({}, { urlKey: 'acme', featureFlags: { proxy: false } });
  assert.ok(html.includes('id="next-run-budget-input"'), 'budget input still rendered (not removed)');
  assert.match(html, /id="next-run-budget-input"[^>]*disabled/, 'input is disabled');
  assert.match(html, /next-run-budget-preset[^>]*disabled/, 'presets are disabled');
  assert.ok(html.includes('id="next-run-budget-hint"'), 'inline explanation is shown');
});
