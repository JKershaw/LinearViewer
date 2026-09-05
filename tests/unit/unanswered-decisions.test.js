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

  test('row shape carries decision, decisionCase, an anchor, disposition, canReply and basisChanged', () => {
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
      canReply: true,
      shelvedLapseCount: 0,
      // LIN-2241 tier 1 — always present, always `null` on a loop-backed row
      // (no task scan raised it, so there is no basis to compare). Pinned in
      // this exhaustive shape assertion on purpose: the client reads the
      // tri-state strictly (`=== true`), so a row shipping the field as
      // `undefined` instead of `null` is a contract change worth failing on.
      basisChanged: null
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

  test('taskDecisions defaults to [] and is tolerated as a trivial no-op', () => {
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

function taskDecision(overrides = {}) {
  return {
    id: 'scan_uuid1234_hash567890',
    urlKey: 'acme',
    issueId: 'uuid-task-1',
    issueIdentifier: 'LIN-2197',
    inputHash: 'hash567890abcd',
    decision: decision('scan-d-1'),
    scannedAt: NOW.toISOString(),
    outcome: null,
    outcomeAt: null,
    ...overrides
  };
}

describe('collectUnansweredDecisions — taskDecisions branch (LIN-2197 Phase 3)', () => {
  test('a task decision carrying a real decision, unanswered, surfaces with disposition task-bound and canReply true', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [taskDecision()] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'scan-d-1');
    assert.strictEqual(rows[0].disposition, 'task-bound');
    assert.strictEqual(rows[0].canReply, true);
  });

  test('a persisted zero-finding scan (decision: null) contributes no row', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [taskDecision({ decision: null })] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('an answered task decision is excluded', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [taskDecision({ outcome: 'answered', outcomeAt: NOW.toISOString() })]
    }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('a dismissed task decision is excluded', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [taskDecision({ outcome: 'dismissed', outcomeAt: NOW.toISOString() })]
    }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('anchor shape: loopId null, target/followUpTo null, taskDecisionId carries the record id', () => {
    const entry = taskDecision({
      id: 'scan_abc12345_deadbeefcafe',
      issueId: 'uuid-task-2',
      issueIdentifier: 'LIN-42',
      urlKey: 'acme-ws'
    });
    const rows = collectUnansweredDecisions({ taskDecisions: [entry] }, { now: NOW });
    assert.deepStrictEqual(rows[0].anchor, {
      loopId: null,
      issueId: 'uuid-task-2',
      issueIdentifier: 'LIN-42',
      workspaceUrlKey: 'acme-ws',
      target: null,
      followUpTo: null,
      taskDecisionId: 'scan_abc12345_deadbeefcafe'
    });
    assert.deepStrictEqual(rows[0].decisionCase, []);
  });

  test('an older row for the same task is superseded by a newer scan, even when the older row is decision-bearing and unanswered', () => {
    const older = taskDecision({
      id: 'scan_uuid1234_older111111',
      decision: decision('scan-d-older'),
      scannedAt: new Date(NOW.getTime() - 60000).toISOString()
    });
    const newer = taskDecision({
      id: 'scan_uuid1234_newer222222',
      decision: decision('scan-d-newer'),
      scannedAt: NOW.toISOString()
    });
    const rows = collectUnansweredDecisions({ taskDecisions: [older, newer] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'scan-d-newer');
  });

  test('a newer zero-finding re-scan supersedes an older unanswered decision, silencing the ruling', () => {
    const older = taskDecision({
      id: 'scan_uuid1234_older111111',
      decision: decision('scan-d-older'),
      scannedAt: new Date(NOW.getTime() - 60000).toISOString()
    });
    const newer = taskDecision({
      id: 'scan_uuid1234_newer222222',
      decision: null,
      scannedAt: NOW.toISOString()
    });
    const rows = collectUnansweredDecisions({ taskDecisions: [older, newer] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('task decisions for different tasks (different issueId) never supersede each other', () => {
    const a = taskDecision({ issueId: 'uuid-task-a', decision: decision('scan-d-a') });
    const b = taskDecision({ issueId: 'uuid-task-b', decision: decision('scan-d-b') });
    const rows = collectUnansweredDecisions({ taskDecisions: [a, b] }, { now: NOW });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map(r => r.decision.decision_id).sort(), ['scan-d-a', 'scan-d-b']);
  });

  test('loops and taskDecisions compose: both surface in the same result set', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-loop') });
    const rows = collectUnansweredDecisions({ loops: [l], taskDecisions: [taskDecision()] }, { now: NOW });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map(r => r.decision.decision_id).sort(), ['d-loop', 'scan-d-1']);
    assert.deepStrictEqual(rows.map(r => r.disposition).sort(), ['resumable', 'task-bound']);
  });

  test('a falsy entry in taskDecisions is tolerated, never throws', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [null, undefined, taskDecision()] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
  });
});

describe('canReplyFor via collectUnansweredDecisions — task-bound always admits a reply', () => {
  test('task-bound is not gated by liveness, unlike resumable/gone/mid-turn/indeterminate', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [taskDecision()] }, { now: NOW });
    assert.strictEqual(rows[0].canReply, true);
  });
});

// LIN-1727: shelve is a VIEW operation — a decision with an active shelf row
// (resurfaceAt in the future) is excluded from the feed entirely; once it
// passes, the (never-mutated) decision reappears like any other unanswered
// one, carrying its lapse history.
describe('collectUnansweredDecisions — shelving (LIN-1727)', () => {
  function shelf(decisionId, overrides = {}) {
    return { decisionId, urlKey: 'acme', reason: 'waiting on a stakeholder', shelvedAt: '2026-08-22T00:00:00.000Z', resurfaceAt: '2026-08-23T00:00:00.000Z', lapseCount: 0, ...overrides };
  }

  test('an actively-shelved loop-backed decision is excluded from the feed', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l], shelvedRulings: [shelf('d-1', { resurfaceAt: '2026-08-23T00:00:00.000Z' })] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('an actively-shelved task-bound decision is excluded from the feed', () => {
    const t = taskDecision();
    const rows = collectUnansweredDecisions({ taskDecisions: [t], shelvedRulings: [shelf(t.decision.decision_id, { resurfaceAt: '2026-08-23T00:00:00.000Z' })] }, { now: NOW });
    assert.deepStrictEqual(rows, []);
  });

  test('a LAPSED shelf (resurfaceAt in the past) no longer excludes the row — it reappears, carrying shelvedLapseCount', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l], shelvedRulings: [shelf('d-1', { resurfaceAt: '2026-08-20T00:00:00.000Z', lapseCount: 2 })] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].shelvedLapseCount, 2);
  });

  test('a decision never shelved carries shelvedLapseCount: 0', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.strictEqual(rows[0].shelvedLapseCount, 0);
  });

  test('shelving one decision does not affect an unrelated one', () => {
    const l1 = loop({ loopId: 'loop-1', wakeMarker: 'blocked', decision: decision('d-1') });
    const l2 = loop({ loopId: 'loop-2', wakeMarker: 'blocked', decision: decision('d-2') });
    const rows = collectUnansweredDecisions({ loops: [l1, l2], shelvedRulings: [shelf('d-1', { resurfaceAt: '2026-08-23T00:00:00.000Z' })] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'd-2');
  });

  test('a shelf row exactly at resurfaceAt (not strictly future) is treated as lapsed, not active', () => {
    const l = loop({ wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l], shelvedRulings: [shelf('d-1', { resurfaceAt: NOW.toISOString() })] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
  });

  // LIN-2262: decision_id is agent-invented free text, not a UUID — two
  // workspaces inventing the same short id is ordinary, not exotic. The
  // shelf gate must key on (urlKey, decisionId), matching the store's own
  // composite key, so shelving in one workspace cannot suppress an entirely
  // unshelved decision in another that happens to share a decision_id.
  test('shelving a decision in one workspace does not suppress the same decision_id, unshelved, in another workspace', () => {
    const acme = loop({ loopId: 'loop-acme', workspaceUrlKey: 'acme', wakeMarker: 'blocked', decision: decision('proceed-or-abort') });
    const globex = loop({ loopId: 'loop-globex', workspaceUrlKey: 'globex', wakeMarker: 'blocked', decision: decision('proceed-or-abort') });
    const rows = collectUnansweredDecisions(
      { loops: [acme, globex], shelvedRulings: [shelf('proceed-or-abort', { urlKey: 'acme', resurfaceAt: '2026-08-23T00:00:00.000Z' })] },
      { now: NOW }
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].anchor.workspaceUrlKey, 'globex');
  });

  test('shelving a task-bound decision in one workspace does not suppress the same decision_id, unshelved, in another workspace', () => {
    const acmeTask = taskDecision({ urlKey: 'acme', issueId: 'uuid-acme-task', decision: decision('proceed-or-abort') });
    const globexTask = taskDecision({ urlKey: 'globex', issueId: 'uuid-globex-task', decision: decision('proceed-or-abort') });
    const rows = collectUnansweredDecisions(
      { taskDecisions: [acmeTask, globexTask], shelvedRulings: [shelf('proceed-or-abort', { urlKey: 'acme', resurfaceAt: '2026-08-23T00:00:00.000Z' })] },
      { now: NOW }
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].anchor.workspaceUrlKey, 'globex');
  });
});

describe('collectUnansweredDecisions — basisChanged (LIN-2241 tier 1)', () => {
  const RAISED_AT = new Date('2026-09-01T09:00:00.000Z');
  const AFTER = new Date('2026-09-03T09:00:00.000Z');
  const BEFORE = new Date('2026-08-30T09:00:00.000Z');

  function raised(overrides = {}) {
    return taskDecision({ basisHash: 'basis-at-raise', scannedAt: RAISED_AT.toISOString(), ...overrides });
  }
  function observed(overrides = {}) {
    return {
      urlKey: 'acme',
      issueId: 'uuid-task-1',
      basisHash: 'basis-now',
      observedAt: AFTER.toISOString(),
      ...overrides
    };
  }

  test('a later observation with a different basis flags the row', () => {
    const rows = collectUnansweredDecisions(
      { taskDecisions: [raised()], taskBasis: [observed()] },
      { now: NOW }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].basisChanged, true);
  });

  test('a later observation with the SAME basis reports false, not null', () => {
    const rows = collectUnansweredDecisions(
      { taskDecisions: [raised()], taskBasis: [observed({ basisHash: 'basis-at-raise' })] },
      { now: NOW }
    );
    assert.equal(rows[0].basisChanged, false);
  });

  test('a row raised before this feature (no basisHash) is unknown, never flagged', () => {
    // Every ruling already sitting in the queue when this lands takes this path.
    const rows = collectUnansweredDecisions(
      { taskDecisions: [taskDecision({ scannedAt: RAISED_AT.toISOString() })], taskBasis: [observed()] },
      { now: NOW }
    );
    assert.equal(rows[0].basisChanged, null);
  });

  test('no observation for the task is unknown', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [raised()], taskBasis: [] }, { now: NOW });
    assert.equal(rows[0].basisChanged, null);
  });

  test('an observation OLDER than the scan is unknown, not a change', () => {
    const rows = collectUnansweredDecisions(
      { taskDecisions: [raised()], taskBasis: [observed({ observedAt: BEFORE.toISOString() })] },
      { now: NOW }
    );
    assert.equal(rows[0].basisChanged, null);
  });

  test('an observation for a DIFFERENT task never leaks onto this row', () => {
    const rows = collectUnansweredDecisions(
      { taskDecisions: [raised()], taskBasis: [observed({ issueId: 'uuid-task-2' })] },
      { now: NOW }
    );
    assert.equal(rows[0].basisChanged, null);
  });

  test('an observation from a different WORKSPACE never leaks onto this row', () => {
    const rows = collectUnansweredDecisions(
      { taskDecisions: [raised()], taskBasis: [observed({ urlKey: 'other' })] },
      { now: NOW }
    );
    assert.equal(rows[0].basisChanged, null);
  });

  test('a loop-backed row carries basisChanged: null, keeping the row shape uniform', () => {
    const l = loop({ decision: decision('d-1') });
    const rows = collectUnansweredDecisions({ loops: [l] }, { now: NOW });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].basisChanged, null);
  });

  test('omitting taskBasis entirely is a no-op — every row reports unknown', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [raised()] }, { now: NOW });
    assert.equal(rows[0].basisChanged, null);
  });
});
