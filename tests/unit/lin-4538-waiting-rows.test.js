/**
 * LIN-4538 (LIN-4529 P7a) witness: a Home or session row for a run with an open question shows it waiting on the person, and
 * once the question ends (answered or dismissed) the row no longer does. The standing is read from question records
 * (lib/ruling-standing.js readRulingStanding over lib/records/question-facts.js), and the row states from that standing
 * (lib/task-page-loader.js buildRowStates), as Home and the task page both read them.
 *
 * Also: a question asked by a run places every loop of that run's lineage in the waiting set, and a question addressed to a
 * deciding stage (not a person) does not put anyone on the person's waiting list.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRulingStanding, rulingStandingFromQuestions } from '../../lib/ruling-standing.js';
import { buildRowStates, waitingForOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { needsAPerson } from '../../lib/task-state.js';
import { questionRecordsOf } from './helpers/question-records.js';

const URL_KEY = 'acme';
const NOW = new Date('2026-10-30T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'run-1', lineageId: 'run-1', issueIdentifier: 'LIN-70', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running', dispatchedAt: '2026-10-30T10:00:00.000Z',
    takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z', terminalStatus: null, terminalCompletedAt: null,
    wakeMarker: 'blocked', waitingMessage: '[blocked] which path?', feedback: [{ message: '[blocked] which path?', timestamp: '2026-10-30T10:05:00.000Z' }],
    telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null, ...over,
  };
}
const node = (identifier) => ({ issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: 'started', type: 'started' } }, children: [], depth: 0 });

/** The row states and the standing a page reads, over one set of loops and one set of question records. */
async function rowsOver({ loops, questions }) {
  const recordsStore = questionRecordsOf(questions);
  const ruling = await readRulingStanding({ urlKey: URL_KEY, loops, at: NOW, recordsStore });
  const states = buildRowStates({
    roots: [node('LIN-70')], loopsByIdentifier: new Map([['LIN-70', loops]]), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true, ruling,
  });
  return { ruling, row: states.get('LIN-70'), waitingFor: waitingForOf(loops.map(enrichLoop).map((l) => ({ loopId: l.loopId, state: 'waiting' })), ruling.openLoopIds) };
}

describe('LIN-4538 witness: an open question on a run is a waiting row; ending it is not', () => {
  test('an open question its run asked: the row needs you, and the session is waiting on a ruling', async () => {
    const out = await rowsOver({ loops: [loop()], questions: [{ id: 'q-1', ticket: 'LIN-70', run: 'run-1' }] });
    assert.equal(out.row.state, 'needs-you');
    assert.equal(needsAPerson(out.row.state), true);
    assert.equal(out.waitingFor, 'ruling');
  });

  test('answered: the row is no longer waiting on the person', async () => {
    const out = await rowsOver({ loops: [loop()], questions: [{ id: 'q-1', ticket: 'LIN-70', run: 'run-1', ended: { state: 'answered', by: 'person:acct-owner', reason: 'answered by d-1' } }] });
    assert.notEqual(out.row.state, 'needs-you');
    assert.equal(out.ruling.rows.length, 0);
  });

  test('dismissed: the row is no longer waiting on the person', async () => {
    const out = await rowsOver({ loops: [loop()], questions: [{ id: 'q-1', ticket: 'LIN-70', run: 'run-1', ended: { state: 'withdrawn', by: 'person:acct-owner', reason: 'dismissed' } }] });
    assert.notEqual(out.row.state, 'needs-you');
  });

  test('the whole lineage of the asking run is in the waiting set: a follow-up row of the same run waits too', () => {
    const asker = loop({ loopId: 'run-1', lineageId: 'run-1' });
    const follow = loop({ loopId: 'fu-2', lineageId: 'run-1', followUpTo: 'run-1', wakeMarker: 'blocked' });
    const other = loop({ loopId: 'run-9', lineageId: 'run-9', issueIdentifier: 'LIN-71' });
    const facts = [{ questionId: 'q-1', state: 'open', to: 'person:acct-owner', ticket: 'LIN-70', runId: 'run-1', taskId: 'task-LIN-70' }];
    const ruling = rulingStandingFromQuestions({ urlKey: URL_KEY, loops: [asker, follow, other], facts });
    assert.deepEqual([...ruling.openLoopIds].sort(), ['fu-2', 'run-1']);
    assert.equal(ruling.rows[0].anchor.workspaceUrlKey, URL_KEY, 'each row names its workspace');
  });

  test('scoped to a person (Home\'s viewer), another person\'s open question is not a row, a count or a waiting loop', () => {
    const facts = [
      { questionId: 'q-mine', state: 'open', to: 'person:acct-owner', ticket: 'LIN-70', runId: 'run-1', taskId: 'task-LIN-70' },
      { questionId: 'q-theirs', state: 'open', to: 'person:acct-other', ticket: 'LIN-71', runId: 'run-9', taskId: 'task-LIN-71' },
    ];
    const loops = [loop(), loop({ loopId: 'run-9', lineageId: 'run-9', issueIdentifier: 'LIN-71' })];
    const mine = rulingStandingFromQuestions({ urlKey: URL_KEY, loops, facts, to: 'person:acct-owner' });
    assert.deepEqual(mine.rows.map((r) => r.questionId), ['q-mine']);
    assert.deepEqual([...mine.openLoopIds], ['run-1']);
    // Unscoped (the task page's read), both count.
    assert.equal(rulingStandingFromQuestions({ urlKey: URL_KEY, loops, facts }).rows.length, 2);
  });

  test('a question addressed to a deciding stage is not the person\'s: no waiting row, no count', () => {
    const facts = [{ questionId: 'q-s', state: 'open', to: 'implementation', ticket: 'LIN-70', runId: 'run-1', taskId: 'task-LIN-70' }];
    const ruling = rulingStandingFromQuestions({ urlKey: URL_KEY, loops: [loop()], facts });
    assert.equal(ruling.rows.length, 0);
    assert.equal(ruling.openLoopIds.size, 0);
  });
});
