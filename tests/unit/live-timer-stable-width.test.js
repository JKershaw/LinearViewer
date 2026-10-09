/**
 * LIN-3407 — live timers keep a steady slot so a ticking timer never nudges its
 * neighbour. Pins the shipped CSS: tabular figures plus a min-width slot.
 *
 * Run with: node --test tests/unit/live-timer-stable-width.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '../../public');

/** The declaration blocks whose selector list contains `selector`, joined. */
function rulesFor(css, selector) {
  const out = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').some(s => s.trim() === selector)) out.push(m[2]);
  }
  return out.join('\n');
}

const taskCss = readFileSync(join(pub, 'task-page.css'), 'utf8');
const sessCss = readFileSync(join(pub, 'session.css'), 'utf8');

for (const sel of ['.task-stage-ago', '.task-stage-took']) {
  test(`${sel} has tabular figures and a fixed min-width slot`, () => {
    const body = rulesFor(taskCss, sel);
    assert.match(body, /font-variant-numeric:\s*tabular-nums/);
    assert.match(body, /display:\s*inline-block/);
    assert.match(body, /min-width:\s*\d+ch/);
  });
}

test('run-row "in progress" clock has a fixed slot and the row uses tabular figures', () => {
  const clock = rulesFor(sessCss, '.sess-run-times [data-testid="session-run-elapsed"]');
  assert.match(clock, /display:\s*inline-block/);
  assert.match(clock, /min-width:\s*\d+ch/);
  assert.match(rulesFor(sessCss, '.sess-run-times'), /font-variant-numeric:\s*tabular-nums/);
});
