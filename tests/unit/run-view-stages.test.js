/**
 * LIN-3328 — the task-page stage vocabulary added beside `SPINE`.
 *
 * `USUAL_STAGES` is the ordered guess a task page draws after the furthest
 * stage a task reached; `STAGE_LABELS` is the one map every dispatch kind's
 * display word comes from. Both live beside `SPINE`, which is deliberately
 * unchanged (the run page's "n of 4" progress depends on it).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SPINE, USUAL_STAGES, STAGE_LABELS } from '../../lib/run-view.js';
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';

describe('run-view: stage vocabulary (LIN-3328)', () => {
  test('SPINE is unchanged — the run page "n of 4" depends on it', () => {
    assert.deepEqual(SPINE, ['plan', 'implementation', 'review', 'close-out']);
  });

  test('USUAL_STAGES is research ahead of the unchanged SPINE', () => {
    assert.deepEqual(USUAL_STAGES, ['research', 'plan', 'implementation', 'review', 'close-out']);
    assert.deepEqual(USUAL_STAGES.slice(1), SPINE);
  });

  test('every dispatch kind carries a non-empty stage label', () => {
    for (const kind of DISPATCH_KINDS) {
      assert.equal(typeof STAGE_LABELS[kind], 'string', `no STAGE_LABELS entry for "${kind}"`);
      assert.ok(STAGE_LABELS[kind].trim().length > 0, `empty STAGE_LABELS entry for "${kind}"`);
    }
  });

  test('the usual stages are all labelled', () => {
    for (const kind of USUAL_STAGES) {
      assert.ok(STAGE_LABELS[kind], `the usual stage "${kind}" needs a label`);
    }
  });
});
