/**
 * LIN-4106 (review item 5) — on desktop the ruling card is drawn before the run block in EVERY task-page grid.
 *
 * `public/task-page.css` has two desktop `grid-template-areas`: the one for a page with a brief or recap beside the
 * stages, and the `--quiet-context` one. The E2E "ruling card comes before" test only reaches the quiet one (its fixture
 * has no brief), so a swap back in the first template stayed green (mutation M8). This pins both, from the CSS itself.
 *
 * Run with: node --test tests/unit/lin-4106-task-page-grid-order.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'task-page.css'), 'utf8');

/** Every `grid-template-areas` block in the file, with the selector that owns it, as its list of rows. */
function templates() {
  const out = [];
  const re = /([^{}]+)\{[^{}]*?grid-template-areas:\s*((?:\s*"[^"]*"\s*)+);/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selector: m[1].trim().split('\n').pop().trim(), rows: [...m[2].matchAll(/"([^"]*)"/g)].map((r) => r[1].trim()) });
  }
  return out;
}

test('the task page has two desktop grid templates, the default and the quiet-context one', () => {
  const task = templates().filter((t) => t.rows.includes('answer answer'));
  assert.equal(task.length, 2, 'both templates found: ' + JSON.stringify(task.map((t) => t.selector)));
  assert.ok(task.some((t) => /task-page--quiet-context/.test(t.selector)), 'one is the quiet-context template');
  assert.ok(task.some((t) => !/task-page--quiet-context/.test(t.selector)), 'one is the default (brief/recap beside the stages)');
});

test('each task-page grid template lists the ruling card ("question") before the run block ("run")', () => {
  for (const t of templates().filter((x) => x.rows.includes('answer answer'))) {
    const question = t.rows.indexOf('question question');
    const run = t.rows.indexOf('run run');
    assert.ok(question >= 0 && run >= 0, `${t.selector}: both rows are present`);
    assert.ok(question < run, `${t.selector}: "question question" (row ${question}) comes before "run run" (row ${run})`);
  }
});
