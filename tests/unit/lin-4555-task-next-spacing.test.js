/**
 * LIN-4555 (the walk): on the task page a member (or a reader) gets the one "next" line (`.task-next`, lib/render-task-page.js
 * renderNextLine) where the owner gets the run control, and the Records section followed it with no space: its heading touched
 * the line ("A step is running, so nothing else is offered yet." / "Records"). The line is a <p>, whose margin the reset zeroes,
 * and the sections space themselves only below (`.sess-section`, public/session.css). It now keeps the section rhythm below it.
 * Read through tests/helpers/css-rules.js over the sheets the task page loads.
 *
 * Run with: node --test tests/unit/lin-4555-task-next-spacing.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, declOf } from '../helpers/css-rules.js';

const TASK_PAGE_SHEETS = readSheets(['/style.css', '/session.css', '/task-page.css']);

test('the next line keeps the sections\' spacing below it, so the Records heading never touches it', () => {
  assert.equal(declOf(TASK_PAGE_SHEETS, '.task-next', 'margin-bottom'), declOf(TASK_PAGE_SHEETS, '.sess-section', 'margin-bottom'));
});
