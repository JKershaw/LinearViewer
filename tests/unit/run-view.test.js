import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunView, tierOf, SPINE } from '../../lib/run-view.js';

// LIN-3250 (S1 of LIN-2948) — the pure run view model: runId/title/steps/progress/
// next/tierOf (beat 1) plus honest cost, time and waiting clocks (beat 2).

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
    // size suffix wins over a version match: `gpt-5.5-mini` is small, not premium.
    assert.equal(tierOf('gpt-5.5-mini'), 'small');
    // OpenRouter-shaped / provider-prefixed ids resolve by the same family.
    assert.equal(tierOf('anthropic/claude-opus-4-8'), 'premium');
    assert.equal(tierOf('anthropic/claude-sonnet-5'), 'standard');
    assert.equal(tierOf('openai/gpt-5.4-mini'), 'small');
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

// A priced `[usage]` snapshot (claude-code is CUMULATIVE). Override harness/
// costUsd to build the unpriced, harness-only and per-turn cases.
function usage(overrides = {}) {
  return { harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 10, outputTokens: 20, costUsd: 1.5, ...overrides };
}

// A finished lineage carrying a usage snapshot.
function pricedStage(kind, overrides = {}) {
  return stage(kind, { telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [], usage: usage(overrides.usage) } });
}

describe('run-view: cost (honest, never guessed)', () => {
  test('every lineage priced and cumulative → a header total, and a figure per step', () => {
    const view = buildRunView(session([
      pricedStage('plan', { usage: { costUsd: 1.5 } }),
      pricedStage('implementation', { usage: { costUsd: 2.5 } }),
    ]));
    assert.equal(view.cost.status, 'total');
    assert.equal(view.cost.usd, 4);
    assert.equal(view.cost.label, null);
    assert.ok(view.steps.every(s => s.cost.status === 'priced'));
  });

  test('one unpriced lineage → no header total, and that row reads "not reported"', () => {
    const view = buildRunView(session([
      pricedStage('plan', { usage: { costUsd: 1.5 } }),
      pricedStage('implementation', { usage: { costUsd: null } }),
    ]));
    assert.equal(view.cost.status, 'not-reported');
    assert.equal(view.cost.usd, null);
    assert.equal(view.cost.label, 'not reported');
    const impl = view.steps.find(s => s.kind === 'implementation');
    assert.equal(impl.cost.status, 'not-reported');
    assert.equal(impl.cost.label, 'not reported');
  });

  test('harness-only [usage] → not reported', () => {
    const view = buildRunView(session([
      stage('plan', { telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [], usage: { harness: 'claude-code' } } }),
    ]));
    assert.equal(view.steps[0].cost.status, 'not-reported');
    assert.equal(view.steps[0].cost.label, 'not reported');
    assert.equal(view.cost.status, 'not-reported');
  });

  test('missing usage → not reported', () => {
    const view = buildRunView(session([stage('plan')]));
    assert.equal(view.steps[0].cost.status, 'not-reported');
    assert.equal(view.cost.status, 'not-reported');
  });

  test('only the lineage\'s last [usage] counts; earlier rows say "included in the step total"', () => {
    const r1 = loop({ loopId: 'r1', lineageId: 'R', kind: 'review', telemetry: { runtime: { ms: 1000 }, usage: usage({ costUsd: 5 }) } });
    const r2 = loop({ loopId: 'r2', lineageId: 'R', kind: 'review', followUpTo: 'r1', telemetry: { runtime: { ms: 1000 }, usage: usage({ costUsd: 7 }) } });
    const view = buildRunView(session([r1, r2]));
    const step = view.steps[0];
    assert.equal(step.cost.usd, 7, 'the last snapshot wins — never 5 + 7');
    assert.equal(step.cost.finalLoopId, 'r2');
    const byId = Object.fromEntries(step.loopCosts.map(r => [r.loopId, r]));
    assert.equal(byId.r1.status, 'included');
    assert.equal(byId.r1.label, 'included in the step total');
    assert.equal(byId.r2.status, 'figure');
    assert.equal(byId.r2.usd, 7);
  });

  test('a per-turn harness (opencode) withholds the header total but keeps its as-reported figure', () => {
    const view = buildRunView(session([
      pricedStage('plan', { usage: { harness: 'opencode', costUsd: 1.25 } }),
    ]));
    assert.equal(view.cost.status, 'not-reported');
    assert.equal(view.cost.usd, null);
    assert.equal(view.steps[0].cost.status, 'priced');
    assert.equal(view.steps[0].cost.usd, 1.25);
    assert.equal(view.steps[0].cost.cumulative, false);
  });

  test('never emits 0, a partial sum, or a pricedUsd field', () => {
    const zero = buildRunView(session([pricedStage('plan', { usage: { costUsd: 0 } })]));
    assert.equal(zero.cost.usd, null);
    assert.equal(zero.steps[0].cost.status, 'not-reported');

    const partial = buildRunView(session([
      pricedStage('plan', { usage: { costUsd: 1.5 } }),
      stage('implementation'),
    ]));
    assert.equal(partial.cost.usd, null, 'one unpriced lineage → no partial sum');

    assert.ok(!JSON.stringify(partial).includes('pricedUsd'));
    for (const step of partial.steps) assert.notEqual(step.cost.usd, 0);
  });
});

describe('run-view: time', () => {
  test('active running time is the sum of per-step runtimes, with or without heartbeats', () => {
    const view = buildRunView(session([
      stage('plan', { telemetry: { runtime: { ms: 1500 }, metrics: [] } }),
      stage('implementation', { telemetry: { runtime: { ms: 2500 }, metrics: [] } }),
    ]));
    assert.equal(view.time.activeMs, 4000);
  });

  test('wall clock runs against now while open; against completedAt once finished', () => {
    const running = buildRunView(
      session([stage('plan')], { dispatchedAt: '2026-07-20T10:00:00.000Z' }),
      { now: new Date('2026-07-20T10:05:00.000Z') }
    );
    assert.equal(running.time.wall.start, '2026-07-20T10:00:00.000Z');
    assert.equal(running.time.wall.end, null);
    assert.equal(running.time.wall.ms, 5 * 60 * 1000);

    const finished = buildRunView(
      session([stage('plan')], { dispatchedAt: '2026-07-20T10:00:00.000Z', completedAt: '2026-07-20T10:03:00.000Z' }),
      { now: new Date('2026-07-20T10:05:00.000Z') }
    );
    assert.equal(finished.time.wall.end, '2026-07-20T10:03:00.000Z');
    assert.equal(finished.time.wall.ms, 3 * 60 * 1000);
  });
});

describe('run-view: waiting clock', () => {
  const now = new Date('2026-07-20T10:10:00.000Z');

  test('[blocked] followed by [usage] still reads waiting, timed from the block', () => {
    const view = buildRunView(session([
      loop({
        loopId: 'w', kind: 'plan', terminalStatus: null,
        feedback: [
          { kind: 'status', message: '[started] working', timestamp: '2026-07-20T10:00:00.000Z' },
          { kind: 'status', message: '[blocked] need your call', timestamp: '2026-07-20T10:05:00.000Z' },
          { kind: 'usage', message: '[usage] {"costUsd":1}', timestamp: '2026-07-20T10:05:01.000Z' },
        ],
      }),
    ]), { now });
    assert.equal(view.waiting.active, true);
    assert.equal(view.waiting.since, '2026-07-20T10:05:00.000Z');
    assert.equal(view.waiting.ms, 5 * 60 * 1000);
    assert.equal(view.waiting.loopId, 'w');
    assert.equal(view.next, 'your answer');
  });

  test('decision-lifecycle stamps do not move the waiting clock (LIN-3037)', () => {
    const view = buildRunView(session([
      loop({
        loopId: 'w', kind: 'plan', terminalStatus: null,
        feedback: [
          { kind: 'status', message: '[blocked] need your call', timestamp: '2026-07-20T10:05:00.000Z' },
          { kind: 'decision-answer', message: '{"decision_id":"d1"}', timestamp: '2026-07-20T10:07:00.000Z' },
          { kind: 'decision-withdrawn', message: '{"decision_id":"d1"}', timestamp: '2026-07-20T10:08:00.000Z' },
          { kind: 'decision-withdrawal-reversed', message: '{"decision_id":"d1"}', timestamp: '2026-07-20T10:09:00.000Z' },
          { kind: 'usage', message: '[usage] {"costUsd":1}', timestamp: '2026-07-20T10:05:02.000Z' },
        ],
      }),
    ]), { now });
    assert.equal(view.waiting.active, true);
    assert.equal(view.waiting.since, '2026-07-20T10:05:00.000Z', 'a stamp never advances the clock');
    assert.equal(view.waiting.ms, 5 * 60 * 1000);
  });

  test('a later [pending] handoff means not waiting on a person', () => {
    const view = buildRunView(session([
      loop({
        loopId: 'w', kind: 'plan', terminalStatus: null,
        feedback: [
          { kind: 'status', message: '[blocked] need your call', timestamp: '2026-07-20T10:05:00.000Z' },
          { kind: 'status', message: '[pending] agent handoff', timestamp: '2026-07-20T10:06:00.000Z' },
        ],
      }),
    ]), { now });
    assert.equal(view.waiting.active, false);
    assert.notEqual(view.next, 'your answer');
  });

  test('a superseded (already-replied) blocked loop is not the waiting loop', () => {
    const view = buildRunView(session([
      loop({ loopId: 'a1', lineageId: 'A', kind: 'plan', terminalStatus: null, feedback: [{ kind: 'status', message: '[blocked]', timestamp: '2026-07-20T10:05:00.000Z' }] }),
      loop({ loopId: 'a2', lineageId: 'A', kind: 'plan', terminalStatus: null, followUpTo: 'a1', feedback: [] }),
    ]), { now });
    assert.equal(view.waiting.active, false);
  });

  test('a finished session is never waiting', () => {
    const view = buildRunView(session([
      loop({ loopId: 'p', kind: 'plan', terminalStatus: 'done', feedback: [{ kind: 'status', message: '[blocked]', timestamp: '2026-07-20T10:05:00.000Z' }] }),
    ]), { now });
    assert.equal(view.waiting.active, false);
    assert.equal(view.waiting.ms, null);
  });
});
