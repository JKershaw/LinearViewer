/**
 * Unit tests for lib/unanswered-decisions.js (LIN-1728).
 *
 * Covers `resolveDisposition` (the total four-way press-time mapping) and
 * `collectUnansweredDecisions` (the shared predicate the ambient nav count
 * and the filtered rulings view both read).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectUnansweredDecisions, resolveDisposition, resolveEffect, isDecisionAnswered } from '../../lib/unanswered-decisions.js';

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

describe('isDecisionAnswered (LIN-2671: the one exported predicate)', () => {
  test('the answer id matching the current decision id → true', () => {
    assert.strictEqual(isDecisionAnswered(loop({ decision: decision('d-1'), answeredDecisionId: 'd-1' })), true);
  });

  test('a mismatched answer id (a newer decision after an older answer) → false', () => {
    assert.strictEqual(isDecisionAnswered(loop({ decision: decision('d-2'), answeredDecisionId: 'd-1' })), false);
  });

  test('no decision at all is never answered — even with a stray answer id', () => {
    assert.strictEqual(isDecisionAnswered(loop({ decision: null, answeredDecisionId: 'd-1' })), false);
  });

  test('no answer stamps is never answered', () => {
    assert.strictEqual(isDecisionAnswered(loop({ decision: decision('d-1'), answeredDecisionId: null })), false);
  });

  test('a malformed null decision_id cannot match a null answer', () => {
    assert.strictEqual(isDecisionAnswered(loop({ decision: { question: 'q?' }, answeredDecisionId: null })), false);
  });

  test('null/undefined loops are tolerated, never throw', () => {
    assert.strictEqual(isDecisionAnswered(null), false);
    assert.strictEqual(isDecisionAnswered(undefined), false);
  });
});

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

describe('resolveEffect (LIN-2773 Area 3)', () => {
  test('RED-FIRST PRIMARY: a blocked-parked loop always resumes, overriding a declared record', () => {
    // resolveDisposition('resumable') must win unconditionally over a
    // present, valid declared effect — evidence overrides declaration.
    // `resolveEffect` does not exist at all on unmodified (pre-Area-3) code,
    // so this assertion cannot pass there.
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'record' } }), 'resumable');
    assert.deepStrictEqual(result, { effect: 'resume', declaredEffect: 'record', alternate: null });
  });

  test('resumable ignores anchorTerminal/liveDispatchOnAnchor too — branch 1 is checked first, unconditionally', () => {
    const result = resolveEffect(decision('d-1'), 'resumable', { anchorTerminal: true, liveDispatchOnAnchor: true });
    assert.deepStrictEqual(result, { effect: 'resume', declaredEffect: null, alternate: null });
  });

  test('gone + anchorTerminal: true forces record, overriding a declared dispatch', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'gone', { anchorTerminal: true });
    assert.deepStrictEqual(result, { effect: 'record', declaredEffect: 'dispatch', alternate: null });
  });

  test('gone + anchorTerminal: false (or undefined) does NOT force record — falls through to branch 4', () => {
    const falseResult = resolveEffect(decision('d-1'), 'gone', { anchorTerminal: false });
    assert.strictEqual(falseResult.effect, 'dispatch'); // today's gone default
    const undefinedResult = resolveEffect(decision('d-1'), 'gone', {});
    assert.strictEqual(undefinedResult.effect, 'dispatch');
  });

  test('liveDispatchOnAnchor: true forces record regardless of disposition (gone or task-bound), overriding a declared dispatch', () => {
    const gone = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'gone', { liveDispatchOnAnchor: true });
    assert.deepStrictEqual(gone, { effect: 'record', declaredEffect: 'dispatch', alternate: null });
    const taskBound = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'task-bound', { liveDispatchOnAnchor: true });
    assert.deepStrictEqual(taskBound, { effect: 'record', declaredEffect: 'dispatch', alternate: null });
  });

  test('READ-ONLY: mid-turn never surfaces a declared effect, even when one is present in the fixture', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'mid-turn');
    assert.strictEqual(result.effect, null);
    assert.strictEqual(result.declaredEffect, 'dispatch', 'declaredEffect still reports what was declared, only effect is suppressed');
    assert.strictEqual(result.alternate, null);
  });

  test('READ-ONLY: indeterminate never surfaces a declared effect, even when one is present in the fixture', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'resume' } }), 'indeterminate');
    assert.strictEqual(result.effect, null);
    assert.strictEqual(result.declaredEffect, 'resume');
  });

  // LIN-2773 beat 4 note, recorded for review (not a bug; the approved branch
  // order is the parent's design of record, not something this ticket
  // redesigns): branch 3 (liveDispatchOnAnchor) is checked BEFORE branch 4's
  // mid-turn/indeterminate null rule, and is unconditional on disposition —
  // so when a caller's own liveDispatchOnAnchor predicate is satisfied for a
  // mid-turn/indeterminate row (in both live feeds, this is reachable by
  // SELF-match: the row's own loop is non-terminal by definition, so it
  // always matches itself — see tests/unit/dashboard-routes.test.js's
  // "DOCUMENTED INTERACTION" test for the route-level pin), effect reads
  // 'record', never null. This is an evidence override, not a declared
  // effect leaking through: declaredEffect still reports exactly what was
  // (or wasn't) declared, and canReply — the field that actually gates the
  // reply UI — is untouched by any of this.
  test('DOCUMENTED INTERACTION: liveDispatchOnAnchor outranks the mid-turn/indeterminate null rule — effect reads "record", not null', () => {
    const midTurn = resolveEffect(decision('d-1'), 'mid-turn', { liveDispatchOnAnchor: true });
    assert.deepStrictEqual(midTurn, { effect: 'record', declaredEffect: null, alternate: null });
    const indeterminate = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'indeterminate', { liveDispatchOnAnchor: true });
    assert.deepStrictEqual(indeterminate, { effect: 'record', declaredEffect: 'dispatch', alternate: null });
  });

  test('gone with no declared effect falls back to the default (dispatch), alternate stays null', () => {
    const result = resolveEffect(decision('d-1'), 'gone');
    assert.deepStrictEqual(result, { effect: 'dispatch', declaredEffect: null, alternate: null });
  });

  test('task-bound with no declared effect falls back to the default (record), alternate stays null', () => {
    const result = resolveEffect(decision('d-1'), 'task-bound');
    assert.deepStrictEqual(result, { effect: 'record', declaredEffect: null, alternate: null });
  });

  test('gone with a declared effect matching the default: effect is the default, alternate stays null (no real divergence)', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'gone');
    assert.deepStrictEqual(result, { effect: 'dispatch', declaredEffect: 'dispatch', alternate: null });
  });

  test('gone with a declared effect diverging from the default: declared wins, default surfaces as alternate', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'record' } }), 'gone');
    assert.deepStrictEqual(result, { effect: 'record', declaredEffect: 'record', alternate: 'dispatch' });
  });

  test('task-bound with a declared effect diverging from the default: declared wins, default surfaces as alternate', () => {
    const result = resolveEffect(decision('d-1', { on_answer: { effect: 'dispatch' } }), 'task-bound');
    assert.deepStrictEqual(result, { effect: 'dispatch', declaredEffect: 'dispatch', alternate: 'record' });
  });

  test('PARTIAL INPUTS: every combination of missing anchorTerminal/liveDispatchOnAnchor still returns a defined effect, never throws', () => {
    const combos = [
      {},
      { anchorTerminal: undefined },
      { liveDispatchOnAnchor: undefined },
      { anchorTerminal: undefined, liveDispatchOnAnchor: undefined },
      { anchorTerminal: false },
      { liveDispatchOnAnchor: false },
      { anchorTerminal: false, liveDispatchOnAnchor: false }
    ];
    for (const disposition of ['resumable', 'gone', 'task-bound']) {
      for (const opts of combos) {
        assert.doesNotThrow(() => resolveEffect(decision('d-1'), disposition, opts));
        const result = resolveEffect(decision('d-1'), disposition, opts);
        assert.notStrictEqual(result.effect, undefined, `${disposition} with ${JSON.stringify(opts)} must not return an undefined effect`);
      }
    }
    // mid-turn/indeterminate deliberately return effect: null (not undefined) — still "defined" in the sense of never throwing/never omitted.
    for (const disposition of ['mid-turn', 'indeterminate']) {
      for (const opts of combos) {
        assert.doesNotThrow(() => resolveEffect(decision('d-1'), disposition, opts));
      }
    }
  });

  test('a decision with no on_answer at all (or no decision) yields declaredEffect: null, never throws', () => {
    assert.strictEqual(resolveEffect(decision('d-1'), 'gone').declaredEffect, null);
    assert.doesNotThrow(() => resolveEffect(null, 'gone'));
    assert.strictEqual(resolveEffect(null, 'gone').declaredEffect, null);
    assert.doesNotThrow(() => resolveEffect(undefined, 'task-bound'));
  });

  test('resolveEffect is pure — calling it twice with the same input yields the same output, and it takes no now/clock input', () => {
    const d = decision('d-1', { on_answer: { effect: 'record' } });
    assert.deepStrictEqual(resolveEffect(d, 'gone'), resolveEffect(d, 'gone'));
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

  // LIN-2773 Area 3: the full-row deepStrictEqual is rewritten, not loosened
  // to a subset match, so it keeps failing on any unreviewed field —
  // `effect`/`declaredEffect`/`alternate` are now part of the asserted shape.
  test('row shape carries decision, decisionCase, an anchor, disposition, canReply, and the derived effect fields', () => {
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
      effect: 'resume',
      declaredEffect: null,
      alternate: null
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

  // LIN-2650 WS4 §7: a third outcome value, same presence-based predicate
  // (`if (entry.outcome) continue`, lib/unanswered-decisions.js) — closes the
  // "no change needed" claim with an actual assertion rather than prose.
  test('a self-resolved task decision is excluded, same as answered/dismissed', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [taskDecision({ outcome: 'self-resolved', outcomeAt: NOW.toISOString() })]
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

// LIN-2729 / LIN-2893 Step 5: `taskDecisions` (above) is already the
// `outcome:null`-filtered candidate set `listUnansweredForWorkspaces`
// returns, so `latestByTask`'s own reduction only ever sees unanswered rows
// — it cannot by itself tell that a task's TRUE newest scan has since become
// outcome-bearing. `newestScanByTask` (from `listNewestScanPerTask`, keyed
// identically to `latestByTask`: `${urlKey}::${issueId}`) is the unfiltered
// second input that restores "newest, then filter".
describe('collectUnansweredDecisions — newestScanByTask / LIN-2729 fix (LIN-2893 Step 5)', () => {
  const TASK_URL_KEY = 'acme';
  const TASK_ISSUE_ID = 'uuid-task-newest';
  const TASK_KEY = `${TASK_URL_KEY}::${TASK_ISSUE_ID}`;
  const OLDER_SCANNED_AT = new Date(NOW.getTime() - 60000).toISOString();

  // The candidate row: this is what `listUnansweredForWorkspaces` returns —
  // an `outcome:null` row is the ONLY shape that query can ever surface, so
  // every fixture below reuses this same row as the "candidate" input and
  // varies only `newestScanByTask`, matching how the real bug manifests: the
  // candidate query itself never changes shape, only the newest-scan side does.
  function candidate() {
    return taskDecision({
      id: 'scan_uuid1234_older111111',
      urlKey: TASK_URL_KEY,
      issueId: TASK_ISSUE_ID,
      decision: decision('scan-d-older'),
      scannedAt: OLDER_SCANNED_AT,
      outcome: null,
      outcomeAt: null
    });
  }

  function newestScan(overrides = {}) {
    return {
      urlKey: TASK_URL_KEY,
      issueId: TASK_ISSUE_ID,
      outcome: null,
      scannedAt: OLDER_SCANNED_AT,
      ...overrides
    };
  }

  // Ports LIN-2729's own three-line repro (before retire / after retire /
  // after dismiss) directly against `collectUnansweredDecisions`.
  test('LIN-2729 repro — before retire: the candidate is its own newest row (still unanswered), so it surfaces', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [candidate()],
      newestScanByTask: { [TASK_KEY]: newestScan() } // newest IS the candidate itself — unanswered
    }, { now: NOW });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision.decision_id, 'scan-d-older');
  });

  test('LIN-2729 repro — after retire (self-resolved): a newer, outcome-bearing scan the candidate query filtered out drops the older unanswered row', () => {
    const rows = collectUnansweredDecisions({
      // The candidate set is UNCHANGED — the newer row is outcome-bearing, so
      // `listUnansweredForWorkspaces` excluded it upstream; this is the exact
      // shape of the LIN-2729 bug (an older `outcome:null` row is the only
      // thing the old code could ever see).
      taskDecisions: [candidate()],
      newestScanByTask: { [TASK_KEY]: newestScan({ outcome: 'self-resolved', scannedAt: NOW.toISOString() }) }
    }, { now: NOW });
    assert.deepStrictEqual(rows, [], 'the true newest row (self-resolved, newer) must discharge the older candidate — this is the LIN-2729 fix');
  });

  test('LIN-2729 repro — after dismiss: the newest row\'s outcome always wins, regardless of which outcome value it carries', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [candidate()],
      newestScanByTask: { [TASK_KEY]: newestScan({ outcome: 'dismissed', scannedAt: NOW.toISOString() }) }
    }, { now: NOW });
    assert.deepStrictEqual(rows, [], 'a newer dismissed row must discharge the older candidate exactly like a newer self-resolved row does');
  });

  // F5 (plan-review): the named zero-finding-rescan regression. This is the
  // case an over-broad "any newer row wins" reading of the fix would break.
  test('F5 regression — a newer ZERO-FINDING rescan (outcome: null) must NOT drop an older, still-unanswered candidate', () => {
    // Live path this pins: ticket text edited -> new inputHash -> rescan
    // finds nothing -> that zero-finding row is now the task's newest
    // scannedAt, while an older decision row is still genuinely open. The
    // older ruling must stay visible; a rescan alone must never discharge it.
    const rows = collectUnansweredDecisions({
      taskDecisions: [candidate()],
      newestScanByTask: { [TASK_KEY]: newestScan({ outcome: null, scannedAt: NOW.toISOString() }) } // newer scannedAt, but zero-finding
    }, { now: NOW });
    assert.strictEqual(rows.length, 1, 'a newer outcome:null row is not grounds to drop the candidate');
    assert.strictEqual(rows[0].decision.decision_id, 'scan-d-older');
  });

  test('a newestScanByTask entry that is NOT newer than the candidate never drops it, even if outcome-bearing', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [candidate()],
      newestScanByTask: { [TASK_KEY]: newestScan({ outcome: 'answered', scannedAt: new Date(NOW.getTime() - 120000).toISOString() }) } // OLDER than the candidate's own scannedAt
    }, { now: NOW });
    assert.strictEqual(rows.length, 1, 'the drop rule requires the newest row to be strictly newer than the candidate, not merely outcome-bearing');
  });

  test('newestScanByTask omitted entirely (default {}) behaves exactly as before this input existed', () => {
    const rows = collectUnansweredDecisions({ taskDecisions: [candidate()] }, { now: NOW });
    assert.strictEqual(rows.length, 1);
  });

  test('no matching newestScanByTask entry for this task key is tolerated — never throws, never drops', () => {
    const rows = collectUnansweredDecisions({
      taskDecisions: [candidate()],
      newestScanByTask: { 'some-other-workspace::some-other-task': newestScan({ outcome: 'answered', scannedAt: NOW.toISOString() }) }
    }, { now: NOW });
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

  // LIN-2756 — the ticket's live repro at the shelfGate layer: session
  // `74869c9c`'s review loop `07509b1e` and close-out loop `0c912018` emit
  // the SAME decision_id in the SAME workspace. A shelve on one loop's row
  // must not suppress the other's — the same collision LIN-2293 already
  // fixed across workspaces, one dimension over.
  test('shelving one loop’s row does not suppress a DIFFERENT loop sharing the same decision_id in the same workspace', () => {
    const reviewLoop = loop({ loopId: '07509b1e', wakeMarker: 'blocked', decision: decision('lin2384-f6-gate') });
    const closeoutLoop = loop({ loopId: '0c912018', wakeMarker: 'blocked', decision: decision('lin2384-f6-gate') });
    const rows = collectUnansweredDecisions(
      {
        loops: [reviewLoop, closeoutLoop],
        shelvedRulings: [shelf('lin2384-f6-gate', { decisionLoopId: '07509b1e', resurfaceAt: '2026-08-23T00:00:00.000Z' })]
      },
      { now: NOW }
    );
    assert.strictEqual(rows.length, 1, 'only the review loop is shelved — the close-out loop must still surface');
    assert.strictEqual(rows[0].anchor.loopId, '0c912018');
  });

  test('a legacy/workspace-wide shelf (no decisionLoopId) still suppresses every loop sharing the decision_id — documented back-compat', () => {
    const reviewLoop = loop({ loopId: '07509b1e', wakeMarker: 'blocked', decision: decision('lin2384-f6-gate') });
    const closeoutLoop = loop({ loopId: '0c912018', wakeMarker: 'blocked', decision: decision('lin2384-f6-gate') });
    const rows = collectUnansweredDecisions(
      { loops: [reviewLoop, closeoutLoop], shelvedRulings: [shelf('lin2384-f6-gate', { resurfaceAt: '2026-08-23T00:00:00.000Z' })] },
      { now: NOW }
    );
    assert.deepStrictEqual(rows, [], 'a decisionLoopId-less shelf applies to every loop carrying the id, exactly as it did pre-LIN-2756');
  });

  // LIN-2756 re-review F4: shelfGate picks the loop-scoped shelf over the
  // legacy one by PRESENCE, before checking either one's activeness —
  // unlike attachStandingSuggestions (dismissal-suggestions-store.js), which
  // resolves standing-vs-withdrawn first. This pins the CURRENT behaviour
  // (a lapsed loop-scoped shelf wins over a still-active legacy one, so the
  // row resurfaces) — it is not a statement that this is the intended
  // product semantics; see the F4 follow-up ticket for that open question.
  test('F4: a LAPSED loop-scoped shelf overrides a still-ACTIVE legacy one — shelfGate checks precedence before activeness', () => {
    const l = loop({ loopId: '07509b1e', wakeMarker: 'blocked', decision: decision('d-1') });
    const rows = collectUnansweredDecisions(
      {
        loops: [l],
        shelvedRulings: [
          shelf('d-1', { decisionLoopId: '07509b1e', resurfaceAt: '2026-08-20T00:00:00.000Z', lapseCount: 3 }), // this loop's own shelf, lapsed
          shelf('d-1', { resurfaceAt: '2026-08-23T00:00:00.000Z' }) // legacy/workspace-wide, still active
        ]
      },
      { now: NOW }
    );
    assert.strictEqual(rows.length, 1, "the row's own loop-scoped shelf wins precedence over the legacy one, and it has lapsed, so the row surfaces even though a still-active legacy shelf also exists");
    assert.strictEqual(rows[0].shelvedLapseCount, 3, 'the lapse count comes from the loop-scoped shelf that actually won precedence');
  });
});
