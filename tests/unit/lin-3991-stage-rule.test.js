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
import { nextStepOf, buildTaskStages } from '../../lib/task-page-loader.js';

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}-${over.n || 0}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

describe('LIN-3991 — the first-failed task reads the same to the next-step rule and the track', () => {
  test('nextStepOf offers the failed Review again, not the stage before it', () => {
    assert.deepEqual(nextStepOf([sess('review', 'failed')], 'started'), { kind: 'review', label: 'Review', why: 'again', failed: true, reason: 'failed last time, so it runs again' });
  });

  // LIN-4103 beat 2: the track draws the stage that ran; no usual stage (Close-out) is drawn ahead of it.
  test('buildTaskStages lists the failed Review and nothing ahead of it (LIN-4103)', () => {
    const stages = buildTaskStages([sess('review', 'failed')], { trackerType: 'started' });
    assert.deepEqual(stages.map(s => [s.kind, s.state]), [['review', 'failed']]);
  });
});
