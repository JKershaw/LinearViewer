/**
 * LIN-836 — the optional dispatch-page stepper affordance.
 *
 * The dispatch page's "load Autopilot" control grew a sibling "load Autopilot ·
 * stepped" button (data-variant="stepper") next to it. dispatch.js reads that
 * marker and appends ?variant=stepper to the general kickoff fetch. The classic
 * "load Autopilot" + "continue until stopped" controls are unchanged, and the
 *  * cluster is always rendered (LIN-3849: key tools have no switch).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDispatchPage } from '../../lib/render-dispatch.js';

test('a stepper load button sits beside the classic one', () => {
  const html = renderDispatchPage('WS', { featureFlags: {} });
  // Classic control still present and still variant-less.
  assert.ok(html.includes('class="action-btn dispatch-load-autopilot" title='),
    'classic "load Autopilot" button unchanged');
  // Stepper sibling: same class, carries the variant marker + visible label.
  assert.ok(html.includes('dispatch-load-autopilot" data-variant="stepper"'),
    'stepper sibling carries data-variant="stepper"');
  assert.ok(html.includes('>load Autopilot · stepped</button>'),
    'stepper sibling shows the stepped label');
  // Exactly two load buttons.
  assert.equal((html.match(/class="action-btn dispatch-load-autopilot"/g) || []).length, 2);
});

test('the cluster renders whatever the stale stored switches say (LIN-3849)', () => {
  const html = renderDispatchPage('WS', { featureFlags: { proxy: false, dispatch: false } });
  assert.equal((html.match(/class="action-btn dispatch-load-autopilot"/g) || []).length, 2);
  assert.ok(html.includes('dispatch-continue-until-stopped'));
  assert.ok(html.includes('prompt-proxy-toggle'));
  assert.ok(!html.includes('data-proxy-feature'));
});
