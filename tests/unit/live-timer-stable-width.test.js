/**
 * LIN-3407 — live timers keep a steady slot so a ticking timer never nudges its
 * neighbour. Pins the shipped CSS: tabular figures plus a min-width slot.
 *
 * The declarations are asked of the sheets a page loads, in its order (tests/helpers/css-rules.js, LIN-4015).
 *
 * Run with: node --test tests/unit/live-timer-stable-width.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, appliedDecls } from '../helpers/css-rules.js';

// LIN-3968: the stage track's rules moved to stage-track.css (shared with Home); the task page loads it after style.css.
const TASK = readSheets(['/style.css', '/stage-track.css', '/task-page.css']);
const SESSION = readSheets(['/style.css', '/session.css']);

for (const sel of ['.task-stage-ago', '.task-stage-took']) {
  test(`${sel} has tabular figures and a fixed min-width slot`, () => {
    const applied = appliedDecls(TASK, sel);
    assert.equal(applied.get('font-variant-numeric'), 'tabular-nums');
    assert.equal(applied.get('display'), 'inline-block');
    assert.match(applied.get('min-width'), /^\d+ch$/);
  });
}

test('run-row "in progress" clock has a fixed slot and the row uses tabular figures', () => {
  const clock = appliedDecls(SESSION, '.sess-run-times [data-testid="session-run-elapsed"]');
  assert.equal(clock.get('display'), 'inline-block');
  assert.match(clock.get('min-width'), /^\d+ch$/);
  assert.equal(appliedDecls(SESSION, '.sess-run-times').get('font-variant-numeric'), 'tabular-nums');
});
