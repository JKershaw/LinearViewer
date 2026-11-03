/**
 * LIN-3968 item 2: the next step after a failed stage, from one rule in the loader.
 *
 * Witnesses: a stage whose latest session failed (failed, aborted, expired) is not "reached",
 * so the stage is offered again, not the one after it; a cancelled stage (an Undo) is offered
 * again too, but is not a failure and does not need you (LIN-3968 ruling, option a); a later success of the same
 * stage clears it; `closed` is bookkeeping, not failure (LIN-3364); no step is offered while any
 * session runs or waits; the task page (`buildTaskPageModel`), the row words (`buildRowStates`)
 * and the state block (`sessionSummaryOf`) all read the one `nextStepOf` result.
 *
 * Run with: node --test tests/unit/lin-3968-next-step.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextStepOf, buildTaskStages, deriveHeader, buildRowStates, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { needsAPerson } from '../../lib/task-state.js';

const NOW = new Date('2026-10-25T14:00:00.000Z');

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}-${over.n || 0}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

// LIN-4103 beat 2: the failure and the undo are facts from the sessions; the usual-stage guess is removed. A failed stage is
// offered again, a stage whose latest session was undone is offered again (the LIN-3968 ruling), and nothing else is.
describe('LIN-3968 — the failed stage is offered again, and a retry clears it (facts, not guesses)', () => {
  test('a Review that failed and then succeeded on retry clears the failure: nothing is offered', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed', { n: 1 }), sess('review', 'done', { n: 2 })];
    assert.equal(nextStepOf(sessions, 'started'), null);
  });

  test('a cancelled stage (an Undo) is offered again, but not as a failure (LIN-3968 ruling, option a)', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'cancelled')];
    assert.deepEqual(nextStepOf(sessions, 'started'), { kind: 'review', label: 'Review', why: 'again', failed: false, reason: 'cancelled last time, so it is offered again' });
  });

  test('a cancelled stage run again and done clears it: nothing is offered', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'cancelled', { n: 1 }), sess('review', 'done', { n: 2 })];
    assert.equal(nextStepOf(sessions, 'started'), null);
  });

  test('a closed session is bookkeeping, not a failure (LIN-3364): nothing is offered', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'closed')];
    assert.equal(nextStepOf(sessions, 'started'), null);
  });

  test('aborted and expired count as failed too', () => {
    for (const state of ['aborted', 'expired']) {
      const sessions = [sess('plan', 'done'), sess('implementation', state)];
      const step = nextStepOf(sessions, 'started');
      assert.equal(step.kind, 'implementation', state);
      assert.equal(step.failed, true, state);
    }
  });
});

describe('LIN-3968 — nextStepOf: the one offered step', () => {
  test('a failed Review is offered again, marked as failed', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')];
    assert.deepEqual(nextStepOf(sessions, 'started'), { kind: 'review', label: 'Review', why: 'again', failed: true, reason: 'failed last time, so it runs again' });
  });

  test('while a stage runs, no other step is offered', () => {
    const sessions = [sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed', { n: 1 }), sess('implementation', 'running', { n: 2 })];
    assert.equal(nextStepOf(sessions, 'started'), null);
  });

  test('a queued or waiting stage also holds the offer', () => {
    assert.equal(nextStepOf([sess('plan', 'done'), sess('implementation', 'queued')], 'started'), null);
    assert.equal(nextStepOf([sess('plan', 'done'), sess('implementation', 'waiting')], 'started'), null);
  });

  // LIN-4103 beat 2: the usual-stage guess ("usually next after Plan") is gone. A task that ran cleanly is offered nothing.
  test('no failure and no undo: nothing is offered, not the next usual stage (LIN-4103)', () => {
    assert.equal(nextStepOf([sess('plan', 'done')], 'started'), null);
  });

  test('a finished task offers nothing', () => {
    assert.equal(nextStepOf([sess('plan', 'done'), sess('review', 'failed')], 'completed'), null);
  });
});

describe('LIN-3968 — buildTaskStages: the strip draws the stages that ran, and no usual stage ahead of them (LIN-4103)', () => {
  test('the failed Review is a stage that ran, and no usual stage is drawn after it', () => {
    const stages = buildTaskStages([sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')]);
    assert.equal(stages.some(s => s.state === 'ahead'), false);
    assert.equal(stages.find(s => s.kind === 'review').state, 'failed');
  });

  test('the cancelled Review is a stage that ran, and no usual stage is drawn after it', () => {
    const stages = buildTaskStages([sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'cancelled')]);
    assert.equal(stages.some(s => s.state === 'ahead'), false);
    assert.equal(stages.find(s => s.kind === 'review').state, 'cancelled');
  });
});

describe('LIN-3968 — the header says what failed, and the state block offers that stage', () => {
  const s = (kind, state, over = {}) => sess(kind, state, { loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' }, ...over });
  const noWait = { waiting: false, message: null };

  test('idle after a failed Review names the failure and its message', () => {
    const input = { sessions: [s('plan', 'done'), s('review', 'failed', { message: 'tests red' })], waiting: noWait, tracker: { state: { name: 'In Progress', type: 'started' }, finishedAt: null } };
    // LIN-4106: a failure that is the last run reads "Last run:" and counts the runs.
    assert.deepEqual(deriveHeader({ ...input, now: NOW }), { sentence: 'Last run: Review failed 30 minutes ago: tests red · all 2 runs', sentenceAt: '2026-10-25T13:30:00.000Z' });
  });

  // LIN-3991 changed this: the pill reads failed now (the same predicate as the row and count). It stays
  // off `waiting`, which would suppress Go.
  test('the sentence says the failure, not a wait: a wait would suppress Go (the page status is the gather\'s)', () => {
    const input = { sessions: [s('review', 'failed')], waiting: noWait, tracker: null, now: NOW };
    assert.match(deriveHeader(input).sentence, /^Last run: Review failed/);
  });

  test('a running stage says how long it has run, in relative words', () => {
    const input = { sessions: [s('implementation', 'running', { loop: { takenAt: '2026-10-25T13:54:00.000Z', dispatchedAt: '2026-10-25T13:50:00.000Z' } })], waiting: noWait, tracker: null, now: NOW };
    assert.deepEqual(deriveHeader(input), { sentence: 'Build running for 6m.', sentenceAt: '2026-10-25T13:54:00.000Z' });
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
    assert.equal(needsAPerson(row.state), true);
    assert.equal(row.rank, 0);
  });

  // LIN-4103: a cancelled stage is not a failure and not a guess: it needs no one, and the row says nothing about a next step.
  test('a cancelled Review does not need you, and the row names no next step', () => {
    const build = loop({ loopId: 'l0', lineageId: 'l0', kind: 'implementation', agentState: 'complete', terminalStatus: 'done', dispatchedAt: '2026-10-25T12:00:00.000Z' });
    const undone = loop({ historyStatus: 'cancelled', agentState: 'complete', terminalStatus: null, terminalCompletedAt: null, takenAt: null });
    const row = states([build, undone]).get('LIN-60');
    assert.equal(needsAPerson(row.state), false);
    assert.equal(row.words, null);
  });

  test('a copy-first viewer, who sees no sessions, still gets the tracker word only', () => {
    const row = states([loop()], false).get('LIN-60');
    assert.equal(needsAPerson(row.state), false);
    assert.equal(row.words, null);
  });
});
