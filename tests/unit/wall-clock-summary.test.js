import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketOf, decomposeEffort, summarizeSteps, groupBySession, median,
} from '../../lib/wall-clock-summary.js';

// A realistic heartbeat log (mirrors the live proxy shape verified for LIN-987):
// onboarding (24s, 0 tools) → active (32s, 7 tools) → waiting (2m, 0 tools — a
// long `npm test`) → active (10s, 3 tools) → [done] terminal marker.
function sampleFeedback(startIso) {
  const t = (offsetSec) => new Date(new Date(startIso).getTime() + offsetSec * 1000).toISOString();
  return [
    { message: '[started] Summarising project in linearviewer', timestamp: t(4) },
    { message: '[working] Session launched (session: abc, tty: /dev/ttys004)', timestamp: t(4) },
    { message: '[onboarding] Project summary — prep step, not task work: Harbour…', timestamp: t(24) },
    { message: '[working] no tool calls in 24s · 0 total · next heartbeat in ≤30s', timestamp: t(24) },
    { message: '[working · running] 7 tools in 32s: Bash×7 · 7 total', timestamp: t(56) },
    { message: '[working] no tool calls in 2m · 7 total · next heartbeat in ≤2m · npm test', timestamp: t(176) },
    { message: '[working · running] 3 tools in 10s: Bash×2, Read×1 · 10 total', timestamp: t(186) },
    { message: '[done] Task completed in 3m 10s', timestamp: t(190) },
  ];
}

test('bucketOf maps kinds to lifecycle phases, defaulting to orchestration', () => {
  assert.equal(bucketOf('research'), 'before');
  assert.equal(bucketOf('plan'), 'before');
  assert.equal(bucketOf('implementation'), 'diff');
  assert.equal(bucketOf('review'), 'after');
  assert.equal(bucketOf('close-out'), 'after');
  assert.equal(bucketOf('wake'), 'orchestration');
  assert.equal(bucketOf('autopilot'), 'orchestration');
  assert.equal(bucketOf('something-unknown'), 'orchestration'); // safe default
});

test('decomposeEffort splits onboarding / active / waiting / wrap-up from heartbeats', () => {
  const start = '2026-07-04T07:34:00.000Z';
  const step = { dispatchedAt: start, completedAt: null, feedback: sampleFeedback(start) };
  const e = decomposeEffort(step);

  assert.equal(e.hasBeats, true);
  assert.equal(e.beatCount, 4); // 4 [working] heartbeats parsed
  // onboarding = the 24s 0-tool prefix before any tool ran
  assert.equal(e.onboardingMs, 24_000);
  // active = 32s + 10s intervals where tools completed
  assert.equal(e.activeMs, 42_000);
  // waiting = the 2m (120s) 0-tool stretch AFTER work started (the npm test)
  assert.equal(e.waitingMs, 120_000);
  // touchedCi flagged by the "npm test" signature
  assert.equal(e.touchedCi, true);
  // wall = dispatch → [done] terminal marker at t(190)
  assert.equal(e.wallMs, 190_000);
  // wrap-up = wall − covered(24+32+120+10=186s) = 4s after the last heartbeat
  assert.equal(e.wrapupMs, 4_000);
});

test('decomposeEffort derives completion from the terminal marker when completedAt is absent', () => {
  const start = '2026-07-04T07:34:00.000Z';
  const e = decomposeEffort({ dispatchedAt: start, feedback: sampleFeedback(start) });
  assert.equal(e.wallMs, 190_000); // [done] at t(190) used as completion
});

test('decomposeEffort reports unclassified wall-clock for a step with no heartbeats', () => {
  const e = decomposeEffort({
    dispatchedAt: '2026-07-04T07:00:00.000Z',
    completedAt: '2026-07-04T07:00:30.000Z',
    feedback: [{ message: '[aborted] cascade close', timestamp: '2026-07-04T07:00:30.000Z' }],
  });
  assert.equal(e.hasBeats, false);
  assert.equal(e.unclassifiedMs, 30_000);
  assert.equal(e.activeMs, 0);
});

test('summarizeSteps aggregates phase buckets and effort across steps', () => {
  const start = '2026-07-04T07:34:00.000Z';
  const items = [
    { id: '1', kind: 'implementation', dispatchedAt: start, completedAt: null,
      resolvedAt: '2026-07-04T07:34:03.000Z', feedback: sampleFeedback(start) },
    { id: '2', kind: 'wake', dispatchedAt: '2026-07-04T07:40:00.000Z',
      completedAt: '2026-07-04T07:40:05.000Z', feedback: [] },
  ];
  const s = summarizeSteps(items);
  assert.equal(s.steps, 2);
  assert.equal(s.byBucket.diff.steps, 1);
  assert.equal(s.byBucket.orchestration.steps, 1);
  assert.equal(s.effort.waitingMs, 120_000); // from step 1
  assert.equal(s.effort.unclassifiedMs, 5_000); // step 2 has no beats
  assert.equal(s.decomposedSteps, 1);
  assert.equal(s.ciTouchSteps, 1);
  assert.equal(s.queueWaits[0], 3_000); // dispatch→resolve on step 1
  // worker vs orchestration effort split: step 1 (implementation) is worker,
  // step 2 (wake) is orchestration — its wall-clock must NOT pollute worker effort.
  assert.equal(s.workerEffort.waitingMs, 120_000);
  assert.equal(s.workerEffort.unclassifiedMs, 0);
  assert.equal(s.orchEffort.unclassifiedMs, 5_000);
  assert.equal(s.workerDecomposed, 1);
});

test('groupBySession groups by sessionId and isolates solo dispatches', () => {
  const items = [
    { id: 'a', sessionId: 'S1', kind: 'implementation', issueIdentifier: 'LIN-1',
      dispatchedAt: '2026-07-04T07:00:00.000Z', completedAt: '2026-07-04T07:05:00.000Z', feedback: [] },
    { id: 'b', sessionId: 'S1', kind: 'review', issueIdentifier: 'LIN-1',
      dispatchedAt: '2026-07-04T07:05:00.000Z', completedAt: '2026-07-04T07:08:00.000Z', feedback: [] },
    { id: 'c', kind: 'custom', issueIdentifier: 'LIN-2',
      dispatchedAt: '2026-07-04T07:10:00.000Z', completedAt: '2026-07-04T07:11:00.000Z', feedback: [] },
  ];
  const sessions = groupBySession(items);
  assert.equal(sessions.length, 2);
  const s1 = sessions.find((x) => x.sessionId === 'S1');
  assert.equal(s1.steps, 2);
  assert.deepEqual(s1.tasks, ['LIN-1']);
  assert.equal(s1.activeWallMs, 8 * 60_000); // 5m + 3m
  const solo = sessions.find((x) => x.solo);
  assert.equal(solo.steps, 1);
  assert.equal(solo.sessionId, 'solo:c');
});

test('median handles empty and even-length arrays', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});
