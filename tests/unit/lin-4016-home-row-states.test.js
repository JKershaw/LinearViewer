/**
 * LIN-4016 W6 and W7 — Home's row-state assembly (lib/home-row-states.js), read once for all three Home routes.
 *
 * W6 (a guard, passes before and after): the count line's "waiting on you" counts every open ruling in the workspace,
 * whatever the Home view shows (LIN-4024's by-design unit, the badge's). A ruling on a task outside the filter, a
 * task-less ruling and a ruling on a task with no row are all counted.
 *
 * W7 (a guard): with the stores throwing, the assembly returns null, and each Home route falls back to plain rows.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeRowStates, createWaitingStanding } from '../../lib/home-row-states.js';
import { questionRecordsOf, questionsFromLoops } from './helpers/question-records.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-1', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const rulingLoop = (identifier, over = {}) => loop({
  loopId: `r-${identifier}`, lineageId: `r-${identifier}`, issueIdentifier: identifier,
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: `d-${identifier}`, question: 'Which way?' }, decisionCase: [], withdrawal: null, ...over,
});

const node = (identifier) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'started', type: 'started' } },
  children: [], depth: 0,
});

/** The assembly over a fixed set of loops and their question records (LIN-4538); `throwOn` fails the records read. */
function assemblyWith({ loops = [], throwOn = false, recordsStore = null } = {}) {
  const records = recordsStore ?? failingOr(questionRecordsOf(questionsFromLoops(loops)), throwOn);
  const getLoopsForWorkspace = async () => loops;
  return createHomeRowStates({
    getLoopsForWorkspace,
    dispatchStore: {},
    agentStatusStore: {},
    enrichLoop,
    deriveSessionWaiting,
    now: () => NOW,
    onError: () => {},
    waitingStanding: createWaitingStanding({ getLoopsForWorkspace, dispatchStore: {}, agentStatusStore: {}, enrichLoop, now: () => NOW, recordsStore: records }),
  });
}

/** The records reader, or one whose every read throws (a store failure). */
function failingOr(records, throwOn) {
  if (!throwOn) return records;
  const boom = async () => { throw new Error('records unavailable'); };
  return { find: boom, versionsOf: boom, ticketOfTask: boom, taskForTicket: boom };
}

describe('LIN-4016 W6 — the count line counts every open ruling in the workspace, whatever Home shows', () => {
  test('a ruling on a task outside the Home filter, a task-less ruling and a ruling with no row are all counted', async () => {
    // Home shows only LIN-1 (the filter); the rulings are on LIN-OUT (outside the filter), on a task with no tracker
    // row at all, and on LIN-1 itself.
    // LIN-4068: the states are gathered over the fetched set Home shows (`issues`), the ruling count over the workspace's loops.
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-OUT'), rulingLoop('LIN-NOROW'), rulingLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [node('LIN-1').issue], runControls: true });
    assert.equal(out.rulingCount, 3, 'the badge\'s unit: one per open ruling in the workspace');
    assert.equal(out.states.has('LIN-OUT'), false, 'a ruling outside the filter has no row here');
  });

  test('the same count on an unfiltered Home: the rulings are the same set', async () => {
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-OUT'), rulingLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [node('LIN-1').issue, node('LIN-OUT').issue], runControls: true });
    assert.equal(out.rulingCount, 2);
  });

  test('a viewer who sees no sessions has no ruling read, so no count (the copy-first view)', async () => {
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [node('LIN-1').issue], runControls: false });
    assert.equal(out.rulingCount, 0);
  });
});

describe('LIN-4016 W7 — a store failure leaves Home plain: no states, no count, and no throw', () => {
  {
    test('with the question records unreadable, the assembly returns null, so every Home route falls back to plain rows', async () => {
      const assembly = assemblyWith({ loops: [rulingLoop('LIN-1')], throwOn: true });
      const out = await assembly({ urlKey: 'acme', issues: [node('LIN-1').issue], runControls: true });
      assert.equal(out, null);
    });
  }

  test('the failure is reported through onError, not thrown into the page', async () => {
    const seen = [];
    const assembly = createHomeRowStates({
      getLoopsForWorkspace: async () => [], dispatchStore: {}, agentStatusStore: {},
      enrichLoop, deriveSessionWaiting, now: () => NOW, onError: (message) => seen.push(message),
      waitingStanding: createWaitingStanding({
        getLoopsForWorkspace: async () => [], dispatchStore: {}, agentStatusStore: {}, enrichLoop, now: () => NOW,
        recordsStore: { find: async () => { throw new Error('boom'); } },
      }),
    });
    const out = await assembly({ urlKey: 'acme', issues: [], runControls: true });
    assert.equal(out, null);
    assert.deepEqual(seen, ['boom']);
  });
});
