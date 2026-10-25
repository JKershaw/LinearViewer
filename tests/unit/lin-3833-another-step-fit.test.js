/**
 * LIN-3833 — "Another step" fits the task's state (John's ruling: fixed default order, fit by the next-stage rule).
 *
 * The client keeps a step when it fits, and reads what it needs from the state endpoint's sessions summary.
 * These pin that summary: the stages still ahead (the next-stage rule), every usual stage, and the steps the
 * list never offers (`excluded`, the AI-recommendation exclusions).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sessionSummaryOf } from '../../lib/task-page-loader.js';
import { USUAL_STAGES } from '../../lib/run-view.js';
import { EXCLUDED_FROM_AI_RECOMMENDATION } from '../../lib/prompt-templates.js';

describe('LIN-3833 sessionSummaryOf — the fit inputs for "Another step"', () => {
  // A session as the task page's model holds one: its kind and state, and the loop it belongs to.
  const session = (kind, state) => ({ kind, state, label: kind, loop: { dispatchedAt: '2026-10-25T10:00:00Z' } });

  test('a task with no sessions has every usual stage ahead, and names the excluded steps', () => {
    const summary = sessionSummaryOf({ sessions: [], guesses: [...USUAL_STAGES] });
    assert.deepEqual(summary.ahead, USUAL_STAGES);
    assert.deepEqual(summary.usual, USUAL_STAGES);
    assert.deepEqual(summary.excluded, [...EXCLUDED_FROM_AI_RECOMMENDATION]);
    assert.ok(summary.excluded.includes('retro'), 'retro is never offered as a next step');
  });

  test('a plan that has run takes research and plan out of the stages ahead', () => {
    const sessions = [session('plan', 'done')];
    const summary = sessionSummaryOf({ sessions, guesses: ['implementation', 'review', 'close-out'] });
    assert.deepEqual(summary.ahead, ['implementation', 'review', 'close-out']);
    assert.equal(summary.next.kind, 'implementation');
  });

  test('a finished task has nothing ahead', () => {
    const summary = sessionSummaryOf({ sessions: [session('close-out', 'done')], guesses: [] });
    assert.deepEqual(summary.ahead, []);
    assert.equal(summary.next, null);
  });

  test('the summary copies its lists, so a caller cannot change the shared constants', () => {
    const summary = sessionSummaryOf({ sessions: [], guesses: [...USUAL_STAGES] });
    summary.usual.push('x');
    assert.equal(USUAL_STAGES.includes('x'), false);
  });
});
