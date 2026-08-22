/**
 * Unit tests for lib/unanswered-decisions.js (LIN-1728).
 *
 * Covers `resolveDisposition` (the total four-way press-time mapping) and
 * `collectUnansweredDecisions` (the shared predicate the ambient nav count
 * and the filtered rulings view both read).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectUnansweredDecisions, resolveDisposition } from '../../lib/unanswered-decisions.js';

const NOW = new Date('2026-08-22T12:00:00.000Z');
const REAP_INACTIVITY_MS = 21600000; // 6h, mirrors simple-dispatcher's config.js

function decision(id, overrides = {}) {
  return { decision_id: id, question: 'Proceed?', ...overrides };
}

function loop(overrides = {}) {
  return {
    loopId: 'loop-1',
    issueId: 'uuid-1',
    issueIdentifier: 'LIN-900',
    workspaceUrlKey: 'acme',
    target: 'cli',
    followUpTo: null,
    terminalStatus: null,
    terminalCompletedAt: null,
    wakeMarker: null,
    agentState: null,
    decision: null,
    decisionCase: [],
    answeredDecisionId: null,
    ...overrides
  };
}

describe('resolveDisposition (LIN-1728 Revision 3, F8: total mapping)', () => {
  test('permanently-parked [blocked], non-terminal → resumable', () => {
    const l = loop({ terminalStatus: null, wakeMarker: 'blocked' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, exactly at the reap-window boundary → resumable (inclusive)', () => {
    const completedAt = new Date(NOW.getTime() - REAP_INACTIVITY_MS);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, one ms past the reap-window boundary → gone', () => {
    const completedAt = new Date(NOW.getTime() - REAP_INACTIVITY_MS - 1);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('terminal, well within the reap window → resumable', () => {
    const completedAt = new Date(NOW.getTime() - 1000 * 60 * 5); // 5 min ago
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, well past the reap window → gone', () => {
    const completedAt = new Date(NOW.getTime() - 1000 * 60 * 60 * 24); // 24h ago
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('terminal with no terminalCompletedAt (defensive: missing timestamp) → gone, never resumable by default', () => {
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: null });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('non-terminal, actively running → mid-turn', () => {
    const l = loop({ terminalStatus: null, wakeMarker: null, agentState: 'running' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'mid-turn');
  });

  test('the residual non-terminal/non-blocked/non-running case → indeterminate', () => {
    const l = loop({ terminalStatus: null, wakeMarker: null, agentState: 'idle' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'indeterminate');
  });

  test('every branch is reachable and none falls through undefined — exhaustive matrix', () => {
    const cases = [
      loop({ terminalStatus: null, wakeMarker: 'blocked' }),
      loop({ terminalStatus: 'done', terminalCompletedAt: NOW.toISOString() }),
      loop({ terminalStatus: 'failed', terminalCompletedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 2).toISOString() }),
      loop({ terminalStatus: null, wakeMarker: null, agentState: 'running' }),
      loop({ terminalStatus: null, wakeMarker: null, agentState: null }),
      loop({ terminalStatus: null, wakeMarker: 'pending', agentState: null })
    ];
    for (const l of cases) {
      const d = resolveDisposition(l, { now: NOW });
      assert.ok(['resumable', 'gone', 'mid-turn', 'indeterminate'].includes(d), `unmapped disposition: ${d}`);
    }
  });
});

describe('collectUnansweredDecisions (LIN-1728)', () => {
  test('a loop with no decision contributes no row', () => {
    const rows = collectUnansweredDecisions({ loops: [loop({ decision: null })] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('an unanswered decision on a terminal (complete-path) loop is included — orthogonal to waiting', () => {
    // hook.js's complete-path decision emission: terminal, no wakeMarker.
    const l = loop({
      terminalStatus: 'done',
      terminalCompletedAt: NOW.toISOString(),
      wakeMarker: null,
      decision: decision('d-1'),
      answeredDecisionId: null
    });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'd-1');
    assert.strictEqual(rows[0].disposition, 'resumable');
    assert.strictEqual(rows[0].canReply, true);
  });

  test('a loop superseded by a follow-up (followUpTo) within the same input set is excluded', () => {
    const original = loop({ loopId: 'orig', wakeMarker: 'blocked', decision: decision('d-1') });
    const followUp = loop({ loopId: 'follow', followUpTo: 'orig', wakeMarker: 'blocked' });
    const rows = collectUnansweredDecisions({ loops: [original, followUp] }, { now: NOW });
    assert.deepStrictEqual(rows, [], 'the superseded original must not surface as a ruling row');
  });

  test('comment-only Save leak (the original research gap): an answered decision with NO superseding follow-up is excluded via answeredDecisionId, not supersession', () => {
    // Save (comment-only) never creates a follow-up loop — computeSupersededLoopIds
    // alone would leak this forever. answeredDecisionId is what closes it.
    const l = loop({
      wakeMarker: 'blocked',
      decision: decision('d-1'),
      answeredDecisionId: 'd-1'
    });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('a newer decision after an old answer is re-included', () => {
    const l = loop({
      wakeMarker: 'blocked',
      decision: decision('d-2'),
      answeredDecisionId: 'd-1' // stale answer, does not match the current decision
    });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'd-2');
  });

  test('row shape carries decision, decisionCase, an anchor, disposition, and canReply', () => {
    const l = loop({
      loopId: 'loop-a',
      issueId: 'uuid-a',
      issueIdentifier: 'LIN-1',
      workspaceUrlKey: 'ws-a',
      target: 'cli',
      followUpTo: 'prior-loop',
      wakeMarker: 'blocked',
      decision: decision('d-1'),
      decisionCase: ['weighing the options']
    });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0], {
      decision: decision('d-1'),
      decisionCase: ['weighing the options'],
      anchor: {
        loopId: 'loop-a',
        issueId: 'uuid-a',
        issueIdentifier: 'LIN-1',
        workspaceUrlKey: 'ws-a',
        target: 'cli',
        followUpTo: 'prior-loop'
      },
      disposition: 'resumable',
      canReply: true
    });
  });

  test('a mid-turn disposition yields canReply: false', () => {
    const l = loop({ agentState: 'running', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows[0].disposition, 'mid-turn');
    assert.strictEqual(rows[0].canReply, false);
  });

  test('an indeterminate disposition yields canReply: false, distinct from mid-turn', () => {
    const l = loop({ agentState: 'idle', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows[0].disposition, 'indeterminate');
    assert.strictEqual(rows[0].canReply, false);
  });

  test('a gone disposition still admits a reply (a different action) — canReply: true', () => {
    const l = loop({
      terminalStatus: 'done',
      terminalCompletedAt: new Date(NOW.getTime() - REAP_INACTIVITY_MS - 1).toISOString(),
      decision: decision('d-1')
    });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows[0].disposition, 'gone');
    assert.strictEqual(rows[0].canReply, true);
  });

  test('empty loops / missing input tolerated, never throws', () => {
    assert.deepStrictEqual(collectUnansweredDecisions({}, { now: NOW }), []);
    assert.deepStrictEqual(collectUnansweredDecisions({ loops: [] }, { now: NOW }), []);
    assert.deepStrictEqual(collectUnansweredDecisions(undefined, { now: NOW }), []);
  });

  test('taskDecisions defaults to [] and is tolerated as a trivial no-op (LIN-2197 not yet landed)', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l], taskDecisions: [] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
  });

  test('multiple unanswered decisions across loops all surface, each with its own disposition', () => {
    const a = loop({ loopId: 'a', wakeMarker: 'blocked', decision: decision('d-a') });
    const b = loop({ loopId: 'b', agentState: 'running', decision: decision('d-b') });
    const rows = collectUnansweredDecisions({ loops: [a, b] }, { now: NOW });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map(r => r.decision.decision_id).sort(), ['d-a', 'd-b']);
  });
});
