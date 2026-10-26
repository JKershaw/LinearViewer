/**
 * LIN-3975 (PR 2): the task page's pieces are written down with their anatomy and shown on /styleguide, and the
 * decisions are recorded in docs/architecture/ui-pieces.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStyleguide, TASK_PAGE_PIECES } from '../../lib/render-styleguide.js';

test('the task page pieces are the top answer, the moment, the quiet step and the attempt run link', () => {
  assert.deepEqual(TASK_PAGE_PIECES.map(p => p.id), ['top-answer', 'task-time', 'quiet-step', 'attempt-run-link']);
});

test('every task page piece states its purpose, parts, sizes, states and light/dark', () => {
  for (const piece of TASK_PAGE_PIECES) {
    for (const field of ['purpose', 'parts', 'sizes', 'states', 'theme']) {
      assert.ok(typeof piece[field] === 'string' && piece[field].length > 20, `${piece.id}.${field}`);
    }
  }
});

test('/styleguide shows each task page piece under its own section', () => {
  const html = renderStyleguide({});
  for (const piece of TASK_PAGE_PIECES) {
    assert.ok(html.includes(`data-testid="styleguide-task-page-${piece.id}"`), piece.id);
  }
});

test('ui-pieces.md records the task page decisions: the Harbour label, the moment, the cut and the once-said PR state', () => {
  const doc = readFileSync(new URL('../../docs/architecture/ui-pieces.md', import.meta.url), 'utf8');
  assert.match(doc, /labelled "Harbour:"/);
  assert.match(doc, /lib\/components\/time\.js/);
  assert.match(doc, /Read all of it/);
  assert.match(doc, /The PR's state is said once/);
});
