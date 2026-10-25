/**
 * LIN-3968 item 2: the next step after a failed stage, from one rule in the loader.
 *
 * Witnesses: a stage whose latest session failed (failed, aborted, cancelled, expired) is not
 * "reached", so the stage is offered again, not the one after it; a later success of the same
 * stage clears it; `closed` is bookkeeping, not failure (LIN-3364); no step is offered while any
 * session runs or waits; the task page (`buildTaskPageModel`), the row words (`buildRowStates`)
 * and the state block (`sessionSummaryOf`) all read the one `nextStepOf` result.
 *
 * Run with: node --test tests/unit/lin-3968-next-step.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { guessStages, nextStepOf, buildTaskStages, deriveHeader, buildRowStates, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-25T14:00:00.000Z');

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}-${over.n || 0}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

describe('LIN-3968 — guessStages: a failed stage is offered again, not passed over', () => {
  test('a failed Review is the first step offered, then Close-out', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')];
    assert.deepEqual(guessStages(sessions, 'started'), ['review', 'close-out']);
  });

  test('a Review that failed and then succeeded on retry clears the failure', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed', { n: 1 }), sess('review', 'done', { n: 2 })];
    assert.deepEqual(guessStages(sessions, 'started'), ['close-out']);
  });

  test('a cancelled session (an Undo or a Stop) is not a failure: it counts as reached, as before', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'cancelled')];
    assert.deepEqual(guessStages(sessions, 'started'), ['close-out']);
    assert.deepEqual(nextStepOf(sessions, 'started'), { kind: 'close-out', label: 'Close-out', why: 'usual', failed: false });
  });

  test('a closed session is bookkeeping, not a failure (LIN-3364)', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'closed')];
    assert.deepEqual(guessStages(sessions, 'started'), ['close-out']);
  });

  test('aborted and expired count as failed too', () => {
    for (const state of ['aborted', 'expired']) {
      const sessions = [sess('plan', 'done'), sess('implementation', state)];
      assert.equal(guessStages(sessions, 'started')[0], 'implementation', state);
    }
  });
});

describe('LIN-3968 — nextStepOf: the one offered step', () => {
  test('a failed Review is offered again, marked as failed', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')];
    assert.deepEqual(nextStepOf(sessions, 'started'), { kind: 'review', label: 'Review', why: 'again', failed: true });
  });

  test('while a stage runs, no other step is offered', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed', { n: 1 }), sess('implementation', 'running', { n: 2 })];
    assert.equal(nextStepOf(sessions, 'started'), null);
  });

  test('a queued or waiting stage also holds the offer', () => {
    assert.equal(nextStepOf([sess('plan', 'done'), sess('implementation', 'queued')], 'started'), null);
    assert.equal(nextStepOf([sess('plan', 'done'), sess('implementation', 'waiting')], 'started'), null);
  });

  test('no failure: the first usual stage ahead, not marked as failed', () => {
    assert.deepEqual(nextStepOf([sess('plan', 'done')], 'started'), { kind: 'implementation', label: 'Build', why: 'usual', failed: false });
  });

  test('a finished task offers nothing', () => {
    assert.equal(nextStepOf([sess('plan', 'done'), sess('review', 'failed')], 'completed'), null);
  });
});

describe('LIN-3968 — buildTaskStages: the failed stage stands for the step ahead', () => {
  test('the failed Review row is not repeated as "usually next"', () => {
    const stages = buildTaskStages([sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')], { trackerType: 'started' });
    assert.deepEqual(stages.filter(s => s.state === 'ahead').map(s => s.kind), ['close-out']);
    assert.equal(stages.find(s => s.kind === 'review').state, 'failed');
  });
});

describe('LIN-3968 — the header says what failed, and the state block offers that stage', () => {
  const s = (kind, state, over = {}) => sess(kind, state, { loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' }, ...over });
  const noWait = { waiting: false, message: null };

  test('idle after a failed Review names the failure and its message', () => {
    const input = { sessions: [s('plan', 'done'), s('review', 'failed', { message: 'tests red' })], waiting: noWait, tracker: { state: { name: 'In Progress', type: 'started' }, finishedAt: null } };
    assert.deepEqual(deriveHeader({ ...input, now: NOW }), { status: 'idle', sentence: 'Review failed 25 Oct, 13:30 UTC: tests red' });
  });

  test('the status stays idle after a failure: waiting would suppress Go', () => {
    const input = { sessions: [s('review', 'failed')], waiting: noWait, tracker: null, now: NOW };
    assert.equal(deriveHeader(input).status, 'idle');
  });

  test('a running stage says how long it has run, in relative words', () => {
    const input = { sessions: [s('implementation', 'running', { loop: { takenAt: '2026-10-25T13:54:00.000Z', dispatchedAt: '2026-10-25T13:50:00.000Z' } })], waiting: noWait, tracker: null, now: NOW };
    assert.deepEqual(deriveHeader(input), { status: 'running', sentence: 'Build running for 6 minutes.' });
  });

  test('sessionSummaryOf offers the failed stage again, and nothing while one runs', () => {
    const failed = { sessions: [s('plan', 'done'), s('review', 'failed')], guesses: ['review', 'close-out'], nextStep: nextStepOf([s('plan', 'done'), s('review', 'failed')], 'started') };
    assert.equal(sessionSummaryOf(failed).offered.kind, 'review');
    assert.equal(sessionSummaryOf(failed).offered.failed, true);
    const running = { sessions: [s('plan', 'done'), s('implementation', 'running')], guesses: ['review', 'close-out'], nextStep: null };
    assert.equal(sessionSummaryOf(running).offered, null);
  });
});

describe('LIN-3968 — row words: a failed stage needs you, and says which stage', () => {
  const loop = (over = {}) => ({
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-60', kind: 'review', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'error',
    dispatchedAt: '2026-10-25T13:00:00.000Z', takenAt: '2026-10-25T13:01:00.000Z', resolvedAt: '2026-10-25T13:01:00.000Z',
    terminalStatus: 'failed', terminalCompletedAt: '2026-10-25T13:30:00.000Z', wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  });
  const node = (identifier) => ({
    issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: 'In Progress', type: 'started' } },
    children: [], depth: 0,
  });
  const states = (loops, sessionsVisible = true) => buildRowStates({
    roots: [node('LIN-60')], loopsByIdentifier: new Map([['LIN-60', loops]]), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible,
  });

  test('a failed Review says "Review failed", counts as needing you, and ranks first', () => {
    const row = states([loop()]).get('LIN-60');
    assert.equal(row.words, 'Review failed');
    assert.equal(row.needsYou, true);
    assert.equal(row.rank, 0);
  });

  test('a copy-first viewer, who sees no sessions, still gets the tracker word only', () => {
    const row = states([loop()], false).get('LIN-60');
    assert.equal(row.needsYou, false);
    assert.equal(row.words, null);
  });
});
