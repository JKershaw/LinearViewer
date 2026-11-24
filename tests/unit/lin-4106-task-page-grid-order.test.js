/**
 * LIN-4106 (review item 5) — on desktop the ruling card is drawn before the run block in EVERY task-page grid.
 *
 * `public/task-page.css` had two desktop `grid-template-areas` (one with a brief or recap beside the stages, and a
 * `--quiet-context` one), and the E2E only reached the quiet one, so a swap in the first stayed green (mutation M8).
 * LIN-4537 retired the brief and recap, so one single-column template remains; this pins it from the CSS itself, and
 * pins that no second template comes back.
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

/** The task page's templates: those that name the answer row. */
const taskTemplates = () => templates().filter((t) => t.rows.includes('answer'));

test('the task page has one desktop grid template, one column wide (LIN-4537: no brief/recap column, no quiet one)', () => {
  const task = taskTemplates();
  assert.equal(task.length, 1, 'one template: ' + JSON.stringify(task.map((t) => t.selector)));
  assert.ok(!/task-page--quiet-context/.test(task[0].selector), 'the quiet-context template is gone');
  assert.ok(task[0].rows.every((row) => !/\s/.test(row)), 'every row is one area wide: ' + JSON.stringify(task[0].rows));
  assert.ok(!task[0].rows.includes('context') && !task[0].rows.includes('quiet'), 'no brief/recap or quiet area');
});

test('the task-page grid template lists the ruling card ("question") before the run block ("run")', () => {
  for (const t of taskTemplates()) {
    const question = t.rows.indexOf('question');
    const run = t.rows.indexOf('run');
    assert.ok(question >= 0 && run >= 0, `${t.selector}: both rows are present`);
    assert.ok(question < run, `${t.selector}: "question" (row ${question}) comes before "run" (row ${run})`);
  }
});
