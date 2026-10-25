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

  test('the next step is the first guess, whatever stages have run', () => {
    const sessions = [session('plan', 'done')];
    const summary = sessionSummaryOf({ sessions, guesses: ['implementation', 'review', 'close-out'] });
    assert.equal(summary.next.kind, 'implementation');
    assert.equal(summary.count, 1);
  });

  test('a finished task names no next step', () => {
    const summary = sessionSummaryOf({ sessions: [session('close-out', 'done')], guesses: [] });
    assert.equal(summary.next, null);
  });

  test('the summary copies its lists, so a caller cannot change the shared constants', () => {
    const summary = sessionSummaryOf({ sessions: [], guesses: [...USUAL_STAGES] });
    summary.excluded.push('x');
    assert.equal(EXCLUDED_FROM_AI_RECOMMENDATION.has('x'), false);
  });
});
