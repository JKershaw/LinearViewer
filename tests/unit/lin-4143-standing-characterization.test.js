/**
 * LIN-4143 characterization: the ruling standing's shape does not depend on the live-run guard; only a row's `effect` does.
 *
 * Written before the guard is made unconditional (commit 3a), so it is green at base. It pins, for scenarios that
 * exercise a live run, a task-scan decision, a shelved ruling and a parked loop, the rows (identity and disposition),
 * `openLoopIds`, `shelvedTaskIdentifiers` and `taskScanByIdentifier`'s keys. Those must be identical with and without the
 * guard. The one `effect` difference the guard makes is pinned too: LIN-5's row reads `record` guarded and `null` raw.
 *
 * Any non-effect difference the guard change introduces fails here, which is the scope decision's stop condition.
 *
 * Run with: node --test tests/unit/lin-4143-standing-characterization.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRulingStanding } from '../../lib/ruling-standing.js';
import { enrichLoop } from '../../routes/dashboard.js';

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
  loopId: `r-${identifier}`, lineageId: `r-${identifier}`, issueIdentifier: identifier, agentState: 'complete',
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` }, decisionCase: [], answeredDecisions: [], withdrawal: null,
  ...over,
});
const taskScan = (identifier) => ({
  urlKey: 'ws', issueId: `uuid-${identifier}`, issueIdentifier: identifier, id: `t-${identifier}`,
  decision: { decision_id: `td-${identifier}`, question: `Scan ${identifier}?` }, outcome: null, scannedAt: '2026-10-30T09:30:00.000Z',
});

const SCENARIOS = {
  // LIN-5's run is live with its ruling not yet waiting: the guard reads its row as record; the raw read leaves it null.
  liveRun: {
    loops: [rulingLoop('LIN-1'), rulingLoop('LIN-5', { agentState: 'running', wakeMarker: 'pending' })],
    taskDecisions: [], shelved: [],
  },
  // A task-scan decision on LIN-7, whose task has a live run.
  taskScan: { loops: [loop({ loopId: 'live-7', issueIdentifier: 'LIN-7' })], taskDecisions: [taskScan('LIN-7')], shelved: [] },
  // One loop ruling and one task-scan ruling, both shelved; another ruling stays open.
  shelved: {
    loops: [rulingLoop('LIN-1'), rulingLoop('LIN-2')],
    taskDecisions: [taskScan('LIN-8')],
    shelved: [
      { urlKey: 'ws', decisionId: 'd-LIN-1', decisionLoopId: 'r-LIN-1', resurfaceAt: '2026-11-01T00:00:00.000Z', lapseCount: 2 },
      { urlKey: 'ws', decisionId: 'td-LIN-8', decisionLoopId: 't-LIN-8', resurfaceAt: '2026-11-01T00:00:00.000Z', lapseCount: 1 },
    ],
  },
  // A bare [blocked] loop with no structured decision: parked, no row.
  parked: {
    loops: [loop({ loopId: 'impl-9', issueIdentifier: 'LIN-9', wakeMarker: 'blocked', waitingMessage: '[blocked] x', feedback: [{ message: '[blocked] x' }] })],
    taskDecisions: [], shelved: [],
  },
};

/** The reduction's stores for one scenario, as the callers wire them. */
function storesFor(s) {
  return {
    taskDecisionsStore: { listUnansweredForWorkspaces: async () => s.taskDecisions, listNewestScanPerTask: async () => ({}) },
    shelvedRulingsStore: { listForWorkspaces: async () => s.shelved },
  };
}

/** The guard-independent shape of a standing: everything except `effect`. */
function shapeOf(ruling) {
  return {
    rows: ruling.rows.map(r => ({
      id: r.decision.decision_id, disposition: r.disposition, loopId: r.anchor.loopId ?? null,
      taskDecisionId: r.anchor.taskDecisionId ?? null, identifier: r.anchor.issueIdentifier,
    })),
    openLoopIds: [...ruling.openLoopIds].sort(),
    shelvedTaskIdentifiers: [...ruling.shelvedTaskIdentifiers].sort(),
    taskScanKeys: [...ruling.taskScanByIdentifier.keys()].sort(),
  };
}

const EXPECTED_SHAPE = {
  liveRun: {
    rows: [
      { id: 'd-LIN-1', disposition: 'resumable', loopId: 'r-LIN-1', taskDecisionId: null, identifier: 'LIN-1' },
      { id: 'd-LIN-5', disposition: 'mid-turn', loopId: 'r-LIN-5', taskDecisionId: null, identifier: 'LIN-5' },
    ],
    openLoopIds: ['r-LIN-1', 'r-LIN-5'], shelvedTaskIdentifiers: [], taskScanKeys: [],
  },
  taskScan: {
    rows: [{ id: 'td-LIN-7', disposition: 'task-bound', loopId: null, taskDecisionId: 't-LIN-7', identifier: 'LIN-7' }],
    openLoopIds: [], shelvedTaskIdentifiers: [], taskScanKeys: ['LIN-7'],
  },
  shelved: {
    rows: [{ id: 'd-LIN-2', disposition: 'resumable', loopId: 'r-LIN-2', taskDecisionId: null, identifier: 'LIN-2' }],
    openLoopIds: ['r-LIN-2'], shelvedTaskIdentifiers: ['LIN-8'], taskScanKeys: [],
  },
  parked: { rows: [], openLoopIds: [], shelvedTaskIdentifiers: [], taskScanKeys: [] },
};

describe('LIN-4143 characterization: the standing shape is the same with and without the live-run guard', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    test(`${name}: rows, open loops, shelves and task-scan keys are pinned and do not depend on the guard`, async () => {
      const stores = storesFor(s);
      const raw = await readRulingStanding({ urlKey: 'ws', loops: s.loops, at: NOW, enrichLoop, ...stores });
      const guarded = await readRulingStanding({ urlKey: 'ws', loops: s.loops, at: NOW, enrichLoop, ...stores, liveGuard: true });

      assert.deepEqual(shapeOf(raw), EXPECTED_SHAPE[name], 'the shape the callers read');
      assert.deepEqual(shapeOf(guarded), shapeOf(raw), 'the guard changes no shape, only effects');
    });
  }

  test('the one effect the guard changes is the live run\'s row: LIN-5 records guarded, reads null raw', async () => {
    const s = SCENARIOS.liveRun;
    const stores = storesFor(s);
    const raw = await readRulingStanding({ urlKey: 'ws', loops: s.loops, at: NOW, enrichLoop, ...stores });
    const guarded = await readRulingStanding({ urlKey: 'ws', loops: s.loops, at: NOW, enrichLoop, ...stores, liveGuard: true });
    const effects = (ruling) => Object.fromEntries(ruling.rows.map(r => [r.anchor.issueIdentifier, r.effect]));
    assert.deepEqual(effects(raw), { 'LIN-1': 'resume', 'LIN-5': null });
    assert.deepEqual(effects(guarded), { 'LIN-1': 'resume', 'LIN-5': 'record' });
  });
});
