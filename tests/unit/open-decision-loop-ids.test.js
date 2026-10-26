/**
 * Unit tests for `openDecisionLoopIds` (LIN-4003), the one reader for "is this
 * loop's question open?". Every case also asserts agreement with
 * `collectUnansweredDecisions` (no shelf): the set is empty exactly when no row
 * is emitted, and every stamp a row carries is in the set. The rule itself is
 * shared with the row builder, so these cases are the tripwire against drift.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectUnansweredDecisions, openDecisionLoopIds, MAX_STAMP_LOOP_IDS } from '../../lib/unanswered-decisions.js';

const NOW = new Date('2026-10-26T04:00:00.000Z');

function decision(id) {
  return { decision_id: id, question: 'Proceed?' };
}

function loop(overrides = {}) {
  return {
    loopId: 'loop-1',
    issueIdentifier: 'LIN-900',
    workspaceUrlKey: 'acme',
    kind: 'worker',
    followUpTo: null,
    sessionId: null,
    decision: decision('d-1'),
    decisionCase: [],
    answeredDecisions: [],
    withdrawal: null,
    ...overrides
  };
}

// The `answeredDecisions` set shape (lib/digest-feedback.js's resolvedDecisionEvents).
function answered(...decisionIds) {
  return decisionIds.map(decisionId => ({ decisionId, raisedAt: null, resolvedAt: null, outcome: 'answered' }));
}

function withdrawnFor(decisionId) {
  return { decisionId, timestamp: '2026-10-25T00:00:00.000Z', reason: 'no longer needed' };
}

// The worker/autopilot pair from LIN-3959: the worker's `sessionId` names the
// autopilot loop, both on one ticket, both carrying `d-1`.
function joinedPair({ worker = {}, autopilot = {} } = {}) {
  return [
    loop({ loopId: 'w', lineageId: 'W', sessionId: 'ap', ...worker }),
    loop({ loopId: 'ap', lineageId: 'ap', kind: 'autopilot', ...autopilot })
  ];
}

// Asserts the reader's set and the row builder agree on the same fixture, then
// returns the set for the caller's own hand-written expectation.
function openAndAgree(loops) {
  const open = openDecisionLoopIds(loops);
  const rows = collectUnansweredDecisions({ loops }, { now: NOW });
  assert.strictEqual(rows.length === 0, open.size === 0, 'rows are empty exactly when the open set is empty');
  for (const row of rows) {
    const stamps = row.stampLoopIds ?? [row.stampLoopId];
    for (const id of stamps) assert.ok(open.has(id), `row stamp ${id} is in the open set`);
  }
  return [...open].sort();
}

describe('openDecisionLoopIds (LIN-4003: agreement with collectUnansweredDecisions)', () => {
  test('a single open loop is open, and its row agrees', () => {
    assert.deepStrictEqual(openAndAgree([loop({ loopId: 'a' })]), ['a']);
  });

  test('an answered loop is not open and emits no row', () => {
    assert.deepStrictEqual(openAndAgree([loop({ loopId: 'a', answeredDecisions: answered('d-1') })]), []);
  });

  test('a withdrawn loop with no other side is not open and emits no row', () => {
    assert.deepStrictEqual(openAndAgree([loop({ loopId: 'a', withdrawal: withdrawnFor('d-1') })]), []);
  });

  test('a superseded loop is not open and emits no row', () => {
    const loops = [
      loop({ loopId: 'a' }),
      loop({ loopId: 'b', decision: null, followUpTo: 'a' })
    ];
    assert.deepStrictEqual(openAndAgree(loops), []);
  });

  test('two copies of one question in one lineage are both open, and the row is one question', () => {
    const loops = [
      loop({ loopId: 'a', lineageId: 'R', dispatchedAt: '2026-10-24T00:00:00.000Z' }),
      loop({ loopId: 'b', lineageId: 'R', dispatchedAt: '2026-10-25T00:00:00.000Z' })
    ];
    assert.deepStrictEqual(openAndAgree(loops), ['a', 'b']);
    assert.strictEqual(collectUnansweredDecisions({ loops }, { now: NOW }).length, 1);
  });

  test('a loop with no decision is never open', () => {
    assert.deepStrictEqual(openAndAgree([loop({ loopId: 'a', decision: null })]), []);
  });

  test('a loop without a lineageId groups by its own loopId, so two such loops are two questions', () => {
    const loops = [loop({ loopId: 'a' }), loop({ loopId: 'b' })];
    assert.deepStrictEqual(openAndAgree(loops), ['a', 'b']);
  });

  test('a cluster whose every side is superseded is not open (the candidate skip, not the discharge)', () => {
    const loops = [
      ...joinedPair(),
      loop({ loopId: 'f', decision: null, followUpTo: 'w' }),
      loop({ loopId: 'g', decision: null, followUpTo: 'ap' })
    ];
    assert.deepStrictEqual(openAndAgree(loops), []);
  });
});

describe('openDecisionLoopIds (LIN-4003: the worker/autopilot join, LIN-3959)', () => {
  test('an answer stamped on the worker copy only leaves the autopilot not open', () => {
    const loops = joinedPair({ worker: { answeredDecisions: answered('d-1') } });
    assert.deepStrictEqual(openAndAgree(loops), []);
  });

  test('a withdrawn worker with an open autopilot: both loopIds are open, and one row is emitted', () => {
    const loops = joinedPair({ worker: { withdrawal: withdrawnFor('d-1') } });
    assert.deepStrictEqual(openAndAgree(loops), ['ap', 'w']);
    assert.strictEqual(collectUnansweredDecisions({ loops }, { now: NOW }).length, 1);
  });

  test('more copies than MAX_STAMP_LOOP_IDS: the set holds every copy, while the row caps its stamp list', () => {
    const workers = Array.from({ length: MAX_STAMP_LOOP_IDS + 1 }, (_, i) =>
      loop({ loopId: `w${i}`, lineageId: `W${i}`, sessionId: 'ap' }));
    const loops = [...workers, loop({ loopId: 'ap', lineageId: 'ap', kind: 'autopilot' })];
    const expected = [...workers.map(w => w.loopId), 'ap'].sort();
    assert.deepStrictEqual(openAndAgree(loops), expected);
    const rows = collectUnansweredDecisions({ loops }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].stampLoopIds.length, MAX_STAMP_LOOP_IDS);
  });

  test('unrelated loops sharing a decision_id on different tickets stay separate', () => {
    const loops = [
      loop({ loopId: 'a', issueIdentifier: 'LIN-1', answeredDecisions: answered('d-1') }),
      loop({ loopId: 'b', issueIdentifier: 'LIN-2' })
    ];
    assert.deepStrictEqual(openAndAgree(loops), ['b']);
  });

  test('the same decision on the same ticket with no sessionId link stays separate', () => {
    const loops = [
      loop({ loopId: 'a', lineageId: 'A', answeredDecisions: answered('d-1') }),
      loop({ loopId: 'b', lineageId: 'B' })
    ];
    assert.deepStrictEqual(openAndAgree(loops), ['b']);
  });

  test('input order does not change the set, with the worker or the autopilot first', () => {
    const [worker, autopilot] = joinedPair();
    const forward = openDecisionLoopIds([worker, autopilot]);
    const reversed = openDecisionLoopIds([autopilot, worker]);
    assert.deepStrictEqual([...forward].sort(), [...reversed].sort());
    assert.deepStrictEqual([...forward].sort(), ['ap', 'w']);
  });
});

describe('openDecisionLoopIds (LIN-4003: shelf-free and clock-free)', () => {
  test('a shelved question is still open here, though the row builder hides it', () => {
    const loops = [loop({ loopId: 'loop-1' })];
    const shelvedRulings = [{
      urlKey: 'acme', decisionId: 'd-1', decisionLoopId: 'loop-1',
      resurfaceAt: '2099-01-01T00:00:00.000Z', lapseCount: 0
    }];
    assert.deepStrictEqual([...openDecisionLoopIds(loops)], ['loop-1']);
    assert.deepStrictEqual(collectUnansweredDecisions({ loops, shelvedRulings }, { now: NOW }), []);
  });

  test('the reader does not mutate its input', () => {
    const loops = joinedPair({ worker: { withdrawal: withdrawnFor('d-1') } });
    const before = JSON.stringify(loops);
    openDecisionLoopIds(loops);
    assert.strictEqual(JSON.stringify(loops), before);
  });
});
