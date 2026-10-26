/**
 * LIN-3991 item 1: after a failure, the stages ahead start at the failed stage, not before it.
 *
 * Witnesses: when the failed (or cancelled) stage is the first one tried, it is still the
 * first step offered and Close-out follows, not every usual stage from Research on (the
 * LIN-3968 regression); a failed stage that is not the furthest tried still lists nothing
 * before the furthest one; a stage later succeeded clears it. The rule is read once by every
 * consumer (strip, rows, task page, run control, Swipe), so the checks go through them all.
 *
 * Run with: node --test tests/unit/lin-3991-stage-rule.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { guessStages, nextStepOf, buildTaskStages } from '../../lib/task-page-loader.js';

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}-${over.n || 0}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

describe('LIN-3991 — guessStages: the stages ahead start at the failed stage', () => {
  test('a failed Review that was the only stage tried offers Review, then Close-out', () => {
    assert.deepEqual(guessStages([sess('review', 'failed')], 'started'), ['review', 'close-out']);
  });

  test('a cancelled Review that was the only stage tried offers Review, then Close-out', () => {
    assert.deepEqual(guessStages([sess('review', 'cancelled')], 'started'), ['review', 'close-out']);
  });

  test('a failed Review and a Research done before it still offers Review, then Close-out', () => {
    const sessions = [sess('research', 'done'), sess('review', 'failed')];
    assert.deepEqual(guessStages(sessions, 'started'), ['review', 'close-out']);
  });

  test('a failed Research, the first stage tried, still offers every usual stage', () => {
    assert.deepEqual(guessStages([sess('research', 'failed')], 'started'), ['research', 'plan', 'implementation', 'review', 'close-out']);
  });

  test('nothing before the furthest stage tried is offered, failed or not', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')];
    assert.deepEqual(guessStages(sessions, 'started'), ['review', 'close-out']);
  });

  test('a stage that failed before a later one passed is not offered again: the furthest tried decides', () => {
    const sessions = [sess('plan', 'failed'), sess('implementation', 'done')];
    assert.deepEqual(guessStages(sessions, 'started'), ['review', 'close-out']);
  });
});

describe('LIN-3991 — the first-failed task reads the same to the next-step rule and the track', () => {
  test('nextStepOf offers the failed Review again, not the stage before it', () => {
    assert.deepEqual(nextStepOf([sess('review', 'failed')], 'started'), { kind: 'review', label: 'Review', why: 'again', failed: true });
  });

  test('buildTaskStages lists the failed Review, then Close-out as ahead, and nothing earlier', () => {
    const stages = buildTaskStages([sess('review', 'failed')], { trackerType: 'started' });
    assert.deepEqual(stages.map(s => [s.kind, s.state]), [['review', 'failed'], ['close-out', 'ahead']]);
  });
});
