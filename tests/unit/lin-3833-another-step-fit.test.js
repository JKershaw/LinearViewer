/**
 * LIN-3833 — "Another step" leaves out only the steps a task cannot take (ruling `lin3833-fit-rule-loop`,
 * comment f9fa6bd7: leave out only finished tasks and retro; every other step always fits).
 *
 * The client reads what it needs from the state endpoint's sessions summary. These pin that summary: the
 * steps never offered as a next step (`excluded`) and the next step the sessions name. The stage-order fields
 * this PR once carried (`ahead`, `usual`) are gone, and nothing reads them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sessionSummaryOf } from '../../lib/task-page-loader.js';
import { USUAL_STAGES } from '../../lib/run-view.js';
import { EXCLUDED_FROM_AI_RECOMMENDATION } from '../../lib/prompt-templates.js';

describe('LIN-3833 sessionSummaryOf — the fit inputs for "Another step"', () => {
  // A session as the task page's model holds one: its kind and state, and the loop it belongs to.
  const session = (kind, state) => ({ kind, state, label: kind, loop: { dispatchedAt: '2026-10-25T10:00:00Z' } });

  test('a task with no sessions names the excluded steps, and no stage-order fields', () => {
    const summary = sessionSummaryOf({ sessions: [], guesses: [...USUAL_STAGES] });
    assert.deepEqual(summary.excluded, [...EXCLUDED_FROM_AI_RECOMMENDATION]);
    assert.ok(summary.excluded.includes('retro'), 'retro is never offered as a next step');
    assert.equal('ahead' in summary, false);
    assert.equal('usual' in summary, false);
  });

  // LIN-4103 beat 2: the summary carries no guessed next step (the usual-stage guess is removed at source), so no
  // stage that has or has not run is named as next.
  test('the summary names no next step, whatever stages have run (LIN-4103)', () => {
    const summary = sessionSummaryOf({ sessions: [session('plan', 'done')] });
    assert.equal('next' in summary, false);
    assert.equal(summary.count, 1);
  });

  test('a finished task names no next step (LIN-4103: the summary has no next field at all)', () => {
    const summary = sessionSummaryOf({ sessions: [session('close-out', 'done')] });
    assert.equal('next' in summary, false);
  });

  test('the summary copies its lists, so a caller cannot change the shared constants', () => {
    const summary = sessionSummaryOf({ sessions: [], guesses: [...USUAL_STAGES] });
    summary.excluded.push('x');
    assert.equal(EXCLUDED_FROM_AI_RECOMMENDATION.has('x'), false);
  });
});
