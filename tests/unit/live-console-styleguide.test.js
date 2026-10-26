/**
 * LIN-3977: the Live Console's shared decisions are written down and shown on /styleguide.
 * Each piece has the same five anatomy fields the other pieces carry, so a reader can compare them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStyleguide, LIVE_CONSOLE_PIECES } from '../../lib/render-styleguide.js';

test('the Live Console pieces are the lane row, the live run row and the timeline key', () => {
  assert.deepEqual(LIVE_CONSOLE_PIECES.map(p => p.id), ['lane-row', 'stream-row', 'timeline-key']);
});

test('every Live Console piece states its purpose, parts, sizes, states and light/dark', () => {
  for (const piece of LIVE_CONSOLE_PIECES) {
    for (const field of ['purpose', 'parts', 'sizes', 'states', 'theme']) {
      assert.ok(typeof piece[field] === 'string' && piece[field].length > 20, `${piece.id}.${field}`);
    }
  }
});

test('/styleguide shows each Live Console piece under its own section', () => {
  const html = renderStyleguide({});
  assert.ok(html.includes('data-testid="styleguide-live-console-lane-row"'));
  assert.ok(html.includes('data-testid="styleguide-live-console-stream-row"'));
  assert.ok(html.includes('data-testid="styleguide-live-console-timeline-key"'));
});

test('ui-pieces.md records the Live Console decisions with their reasons', () => {
  const doc = readFileSync(new URL('../../docs/architecture/ui-pieces.md', import.meta.url), 'utf8');
  assert.match(doc, /^## Live Console \(LIN-3977\)/m);
  assert.match(doc, /lane row/);
  assert.match(doc, /timeline key/);
});
