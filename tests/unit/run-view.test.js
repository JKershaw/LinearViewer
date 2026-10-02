import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunView, tierOf, SPINE } from '../../lib/run-view.js';

// LIN-3250 (S1 of LIN-2948) — the pure run view model. This beat covers only
// the core: runId/title/steps/progress/next/tierOf. cost/time/waiting are
// deliberate stubs and are asserted as such, never invented.

// A worker loop in the reconstructed-session shape. `sessionId` is set by
// default so the session is NOT standalone; override it (or omit it) to build
// a standalone single-step session.
function loop(overrides = {}) {
  const id = overrides.loopId || 'loop';
  return {
    loopId: id,
    lineageId: overrides.lineageId ?? id,
    kind: 'plan',
    terminalStatus: 'done',
    issueIdentifier: 'LIN-1',
    issueId: 'uuid-1',
    issueTitle: 'Task title',
    iteration: 1,
    sessionId: 'sess-1',
    dispatchedAt: '2026-07-20T10:00:00.000Z',
    telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] },
    feedback: [],
    ...overrides,
  };
}

function session(loops, overrides = {}) {
  return {
    sessionId: 'sess-1',
    seedIssue: 'LIN-1',
    tasksTouched: ['LIN-1'],
    dispatchedAt: '2026-07-20T10:00:00.000Z',
    telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] },
    loops,
    ...overrides,
  };
}

// A finished lineage of the given spine kind, its own lineage.
function stage(kind, overrides = {}) {
  const id = `loop-${kind}`;
  return loop({ loopId: id, lineageId: id, kind, terminalStatus: 'done', ...overrides });
}

describe('run-view: tierOf (tier, never identifier)', () => {
  test('maps model families to their tier', () => {
    assert.equal(tierOf('claude-opus-4-8'), 'premium');
    assert.equal(tierOf('claude-fable-5'), 'premium');
    assert.equal(tierOf('gpt-5.5-pro'), 'premium');
    assert.equal(tierOf('claude-sonnet-4-6'), 'standard');
    assert.equal(tierOf('gpt-5.6-sol'), 'standard');
    assert.equal(tierOf('claude-haiku-4-5'), 'small');
    assert.equal(tierOf('gpt-5.4-mini'), 'small');
  });

  test('unknown or missing → "not reported"', () => {
    assert.equal(tierOf('some-new-model-xyz'), 'not reported');
    assert.equal(tierOf('gpt-5'), 'not reported');
    assert.equal(tierOf(''), 'not reported');
    assert.equal(tierOf(null), 'not reported');
    assert.equal(tierOf(undefined), 'not reported');
    assert.equal(tierOf(42), 'not reported');
  });

  test('the identifier is never the returned value', () => {
    for (const model of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      assert.ok(!tierOf(model).includes(model));
    }
  });
});

describe('run-view: steps', () => {
  test('one step per lineage, with every loop (superseded included) kept for rows', () => {
    const view = buildRunView(session([
      loop({ loopId: 'p', kind: 'plan' }),
      loop({ loopId: 'i1', lineageId: 'impl', kind: 'implementation', followUpTo: 'p' }),
      loop({ loopId: 'i2', lineageId: 'impl', kind: 'implementation', followUpTo: 'i1' }),
    ]));
    assert.equal(view.steps.length, 2, 'plan + one folded implementation lineage');
    const impl = view.steps.find(s => s.kind === 'implementation');
    assert.deepEqual(impl.loops.map(l => l.loopId), ['i1', 'i2'], 'superseded attempt stays on the step');
  });

  test('a step takes its kind from its active (non-superseded) loop', () => {
    // a1 is superseded by a2; a1's kind must not decide the step.
    const view = buildRunView(session([
      loop({ loopId: 'a1', lineageId: 'L', kind: 'review', followUpTo: undefined }),
      loop({ loopId: 'a2', lineageId: 'L', kind: 'implementation', followUpTo: 'a1' }),
    ]));
    assert.equal(view.steps.length, 1);
    assert.equal(view.steps[0].kind, 'implementation');
    assert.equal(view.steps[0].summary, 'implementation · done');
  });

  test('exposes runId and title', () => {
    const view = buildRunView(session([loop({ loopId: 'p', kind: 'plan' })], { sessionId: 'sess-9', seedIssue: 'LIN-9' }));
    assert.equal(view.runId, 'sess-9');
    assert.equal(view.title, 'Task title');
  });
});

describe('run-view: progress over the fixed spine', () => {
  test('reaches the spine stage of a finished step, and skipped earlier stages with it', () => {
    // A bug going straight to implementation: plan was skipped, but a finished
    // implementation counts plan as reached — never stuck at 0.
    const view = buildRunView(session([loop({ loopId: 'i', kind: 'implementation' })]));
    assert.equal(view.progress.mode, 'stages');
    assert.equal(view.progress.reached, 2);
    assert.equal(view.progress.total, SPINE.length);
    assert.equal(view.progress.label, '2 of 4 stages');
    assert.equal(view.next, 'review');
  });

  test('monotone: a rework never lowers the number', () => {
    const base = [stage('plan')];
    let last = buildRunView(session(base)).progress.reached;
    assert.equal(last, 1);

    const withImpl = [...base, stage('implementation')];
    const afterImpl = buildRunView(session(withImpl)).progress.reached;
    assert.equal(afterImpl, 2);
    assert.ok(afterImpl >= last);
    last = afterImpl;

    // A rework inside the implementation lineage: same step, no movement.
    const reworked = [...withImpl, loop({ loopId: 'impl-2', lineageId: 'loop-implementation', kind: 'implementation', followUpTo: 'loop-implementation' })];
    const afterRework = buildRunView(session(reworked)).progress.reached;
    assert.equal(afterRework, 2, 'a rework step never lowers or double-counts');
    assert.ok(afterRework >= last);
    last = afterRework;

    const withReview = [...reworked, stage('review')];
    const afterReview = buildRunView(session(withReview)).progress.reached;
    assert.equal(afterReview, 3);
    assert.ok(afterReview >= last);
  });

  test('C3: a terminal run whose last spine step is a finished review reads 3 of 4, next close-out', () => {
    const view = buildRunView(
      session([stage('plan'), stage('implementation'), stage('review')], { completedAt: '2026-07-20T11:00:00.000Z' }),
      { now: new Date('2026-07-20T12:00:00.000Z') }
    );
    assert.equal(view.progress.label, '3 of 4 stages');
    assert.equal(view.next, 'close-out');
  });

  test('a run finished through close-out reads 4 of 4 and no next', () => {
    const view = buildRunView(session([stage('plan'), stage('implementation'), stage('review'), stage('close-out')]));
    assert.equal(view.progress.reached, 4);
    assert.equal(view.progress.label, '4 of 4 stages');
    assert.equal(view.next, null);
  });

  test('an unfinished spine step does not advance progress', () => {
    const view = buildRunView(session([
      stage('plan'),
      loop({ loopId: 'i', kind: 'implementation', terminalStatus: null }),
    ]));
    assert.equal(view.progress.reached, 1);
    assert.equal(view.next, 'implementation');
  });

  test('out-of-spine steps render as rows but do not move progress', () => {
    const view = buildRunView(session([
      loop({ loopId: 'bug', kind: 'bug', terminalStatus: 'done' }),
      loop({ loopId: 'research', kind: 'research', terminalStatus: 'done' }),
    ]));
    assert.equal(view.steps.length, 2);
    assert.equal(view.progress.reached, 0);
    assert.equal(view.progress.label, '0 of 4 stages');
    assert.equal(view.next, 'plan');
  });
});

describe('run-view: the number is withheld, never guessed, for non-task runs', () => {
  test('a standalone single-step session shows "the step\'s own state" and no next', () => {
    const view = buildRunView(session([
      loop({ loopId: 'solo', kind: 'research', sessionId: undefined, lineageId: 'solo' }),
    ]));
    assert.equal(view.progress.mode, 'state');
    assert.equal(view.progress.reached, null);
    assert.equal(view.progress.label, "the step's own state");
    assert.equal(view.next, null);
    assert.ok(!/\d of 4/.test(view.progress.label));
  });

  test('a general goal-only session shows "N steps so far" and no next', () => {
    const view = buildRunView(session([
      loop({ loopId: 'a', kind: 'implementation' }),
      loop({ loopId: 'b', kind: 'review' }),
    ], { sessionId: 'sess-g', seedIssue: null }));
    assert.equal(view.progress.mode, 'steps');
    assert.equal(view.progress.reached, null);
    assert.equal(view.progress.label, '2 steps so far');
    assert.equal(view.next, null);
  });

  test('a single-lineage goal-only session reads "1 step so far"', () => {
    const view = buildRunView(session([loop({ loopId: 'a', kind: 'implementation' })], { seedIssue: null }));
    assert.equal(view.progress.label, '1 step so far');
  });
});

describe('run-view: beat-1 stubs', () => {
  test('cost, time and waiting are present but uninvented', () => {
    const view = buildRunView(session([loop({ loopId: 'p', kind: 'plan' })]));
    assert.equal(view.cost, null);
    assert.equal(view.time, null);
    assert.equal(view.waiting, null);
  });
});
