/**
 * LIN-3364 — every lean-loop reader that asks "is this row live?" honours the
 * `bookkeeping` stamp via `isRowClosed`. One witness per reader on a stamped
 * `[pending]` loop (and a stamped `[blocked]` loop for the waiting readers),
 * plus the lean-loop carries-the-stamp test and the stage-bar render test.
 * Mutation check for each: remove the reader's `isRowClosed` call.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopActive, deriveLoopLanes, buildTimeline, packTimelineRows } from '../../lib/live-console.js';
import { sweepOneWorkspace } from '../../lib/liveness-alarm-sweep.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { renderTaskTrack } from '../../lib/render-task-page.js';
import { enrichLoop, isTerminalLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { deriveFollowUpDispatch } from '../../lib/chat-tools.js';
import { runStatusMeta, renderStepFace } from '../../lib/render-run-steps.js';
import { buildRunView } from '../../lib/run-view.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';

const CLOSED_AT = '2026-08-02T00:00:00.000Z';
const STAMP = { at: CLOSED_AT, by: null, reason: 'handed-on' };
const NOW = new Date('2026-10-06T15:00:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-50', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over
  };
}
const closed = (over = {}) => loop({ bookkeeping: STAMP, ...over });
const closedBlocked = (over = {}) => closed({ wakeMarker: 'blocked', waitingMessage: '[blocked] x', feedback: [{ message: '[blocked] x', timestamp: '2026-10-06T10:05:00.000Z' }], ...over });

describe('LIN-3364 readers honour the stamp', () => {
  test('live-console isLoopActive: a stamped running loop is not a lane', () => {
    assert.equal(isLoopActive(loop()), true);
    assert.equal(isLoopActive(closed()), false);
  });

  test('liveness-alarm-sweep D2: a lineage whose latest loop is closed is not a waiter', async () => {
    async function waitersRead(l) {
      const read = [];
      await sweepOneWorkspace('acme', NOW.getTime(), {
        dispatchStore: {
          listItems: async (_u, { rootItemId }) => { read.push(rootItemId); return []; },
          listHistory: async (_u, { rootItemId }) => { read.push(rootItemId); return { items: [] }; }
        },
        agentStatusStore: {}, dispatchTokenStore: {},
        alarmStore: { list: async () => [], open: async () => {}, clear: async () => {} },
        getLoops: async () => [l],
        getLastSeen: async () => new Date(NOW.getTime() - 1000).toISOString()
      });
      return read;
    }
    assert.deepEqual([...new Set(await waitersRead(loop()))], ['l1'], 'unstamped [pending] is a waiter (read set includes it)');
    assert.deepEqual(await waitersRead(closed()), [], 'stamped lineage is skipped');
  });

  test('task-page: a closed session reads `closed` (not running/waiting) and the stage bar is neutral, not error', () => {
    for (const l of [closed(), closedBlocked()]) {
      const model = buildTaskPageModel({ identifier: 'LIN-50', loops: [l], enrichLoop, deriveSessionWaiting, now: NOW });
      assert.equal(model.sessions[0].state, 'closed');
      assert.equal(model.live, false);
    }
    const model = buildTaskPageModel({ identifier: 'LIN-50', loops: [closed()], enrichLoop, deriveSessionWaiting, now: NOW });
    const html = renderTaskTrack(model, { now: NOW });
    assert.match(html, /data-state="closed" data-tone="neutral"/);
    assert.doesNotMatch(html, /data-state="closed" data-tone="error"/);
    assert.match(html, />closed</, 'the state is spoken as a word');
  });

  test('dashboard: closed is terminal, effectiveAgentState complete, completedAt is the stamp time', () => {
    assert.equal(isTerminalLoop(closed()), true);
    assert.equal(isTerminalLoop(loop()), false);
    const e = enrichLoop(closed());
    assert.equal(e.agentState, 'complete');
    assert.equal(e.completedAt, CLOSED_AT);
    assert.equal(isTerminalLoop(e), true);
    assert.equal(deriveSessionWaiting([enrichLoop(closedBlocked())]).waiting, false, 'a closed [blocked] loop is not waiting');
    assert.equal(deriveSessionWaiting([enrichLoop(loop({ wakeMarker: 'blocked', waitingMessage: '[blocked] x', feedback: [{ message: '[blocked] x' }] }))]).waiting, true);
  });

  test('dashboard: a real terminal marker still wins over the stamp', () => {
    const e = enrichLoop(closed({ terminalStatus: 'failed', terminalCompletedAt: '2026-10-06T12:00:00.000Z' }));
    assert.equal(e.agentState, 'error');
    assert.equal(e.completedAt, '2026-10-06T12:00:00.000Z');
  });

  test('chat-tools isLoopTerminal (via deriveFollowUpDispatch): a closed tail needs force', () => {
    const session = (l) => ({ sessionId: 's1', loops: [l] });
    assert.equal(deriveFollowUpDispatch(session(loop())).force, false);
    assert.equal(deriveFollowUpDispatch(session(closed())).force, true);
  });

  test('render-run-steps: closed reads `closed`, is not waiting, shows the close time not "in progress"', () => {
    assert.deepEqual(runStatusMeta(closed()), { state: 'queued', label: 'closed' });
    assert.deepEqual(runStatusMeta(loop()), { state: 'running', label: 'running' });
    const html = renderStepFace(closedBlocked(), {});
    assert.doesNotMatch(html, /in progress/);
    assert.match(html, /session-run-completed">closed /);
    assert.doesNotMatch(html, /session-run-waiting/);
  });

  test('run-view: a closed step reads `closed` and a closed [blocked] loop has no waiting clock', () => {
    const view = buildRunView({ sessionId: 's1', seedIssue: { identifier: 'LIN-50' }, loops: [closedBlocked()] }, { now: NOW });
    assert.equal(view.steps[0].status, 'closed');
    assert.equal(view.waiting.active, false);
    const live = buildRunView({ sessionId: 's1', seedIssue: { identifier: 'LIN-50' }, loops: [closedBlocked({ bookkeeping: null })] }, { now: NOW });
    assert.equal(live.waiting.active, true);
  });

  test('the lean loop carries the stamp (pipeline-loops)', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const doc = await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-50' });
    await store.takeItem(doc._id, 'acme', 'tok');
    await store.historyCollection.updateOne({ _id: doc._id, urlKey: 'acme' }, { $set: { bookkeeping: { at: new Date(CLOSED_AT), by: null, reason: 'handed-on' } } });
    const loops = await getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore: { listStatus: async () => [] } });
    const l = loops.find(x => x.loopId === doc._id);
    assert.ok(l, 'loop present');
    assert.ok(l.bookkeeping, 'lean loop carries bookkeeping');
  });

  // LIN-3368: the two Live Console wake paths are KEPT as presentation (LIN-2905),
  // not as stale-row hides. These pin that they stay correct on closed rows, so
  // nobody re-adds a fold to compensate. Mutation: drop the `isLoopActive`
  // check in deriveLoopLanes, or the freshness check in buildTimeline, and the
  // matching test below goes red.
  describe('LIN-3368 kept wake presentation is correct on closed rows', () => {
    const wake = (over = {}) => loop({
      loopId: 'w1', lineageId: 'w1', kind: 'wake', followUpTo: 'l1', issueIdentifier: 'LIN-51',
      agentAction: 'wake-action', agentTokenId: 'wake-tok', ...over
    });
    const target = (over = {}) => loop({ agentAction: 'target-action', agentTokenId: 'target-tok', ...over });

    test('a stamped wake produces no lane, and does not surface under its target', () => {
      assert.deepEqual(deriveLoopLanes([target(), closed({ ...wake(), bookkeeping: STAMP })]).map(l => l.task), ['LIN-50']);
      assert.deepEqual(deriveLoopLanes([closed({ loopId: 'l1' }), closed({ ...wake(), bookkeeping: STAMP })]), []);
    });

    test('a stamped target does not donate its action to a live wake', () => {
      const lanes = deriveLoopLanes([target({ bookkeeping: STAMP }), wake()]);
      assert.equal(lanes.length, 1);
      assert.equal(lanes[0].task, 'LIN-50', 'grouped under the target, not a mislabeled LIN-51 lane');
      assert.equal(lanes[0].action, 'wake-action', 'action comes from the live wake, not the closed target');
      const live = deriveLoopLanes([target(), wake()]);
      assert.equal(live[0].action, 'target-action', 'control: an active target still donates');
    });

    test('a stamped wake marker folded into its target is not stillRunning', () => {
      const now = Date.parse('2026-10-06T10:30:00.000Z');
      const markerOf = (w) => {
        const { runs } = buildTimeline([target(), w], { now });
        const bar = packTimelineRows(runs).rows.flat().find(r => r.id === 'l1');
        assert.ok(bar, 'the target keeps its bar; the wake has none of its own');
        assert.equal(runs.length, 2, 'control: buildTimeline emits both runs');
        return bar.wakeMarkers.find(m => m.id === 'w1');
      };
      assert.equal(markerOf(wake()).stillRunning, true, 'control: a live wake marker is running');
      assert.notEqual(markerOf(closed({ ...wake(), bookkeeping: STAMP })).stillRunning, true);
    });
  });
});
