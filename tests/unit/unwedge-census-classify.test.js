/**
 * Unit tests for docs/papers/harbour/unwedge-or-breakdown-scripts/classify.mjs (LIN-3932).
 * Fixtures only: no network, no live service. The first test is the positive control for
 * the unwedge class: the classifier must be able to return U, or its "0 unwedge cases"
 * census result means nothing. The rest pin the exclusions and the loop-rule eras.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  eraOf,
  replayFirstStop,
  carveChild,
  classifyBlocker,
  classifyRefactor,
  breakdownCase,
} from '../../docs/papers/harbour/unwedge-or-breakdown-scripts/classify.mjs';

// A run of Request Changes verdicts in time order: run([3, 2, 1]) is three rounds, blocking 3, 2, then 1.
const run = (blockings) => blockings.map((blocking, i) => ({
  body: `## Plan Review Verdict\n\nVerdict: **Request Changes**\n\nBlocking findings: ${blocking}\n`,
  createdAt: `2026-10-20T10:${String(i).padStart(2, '0')}:00.000Z`,
}));

describe('eraOf: the loop rule in force on a date', () => {
  test('dates each era by the commit that introduced it', () => {
    assert.strictEqual(eraOf('2026-07-25T23:59:00.000Z'), 'none');
    assert.strictEqual(eraOf('2026-07-26T00:00:00.000Z'), 'one-cycle');
    assert.strictEqual(eraOf('2026-10-04T23:59:00.000Z'), 'one-cycle');
    assert.strictEqual(eraOf('2026-10-05T00:00:00.000Z'), 'bound-3');
    assert.strictEqual(eraOf('2026-10-17T23:59:00.000Z'), 'bound-3');
    assert.strictEqual(eraOf('2026-10-18T00:00:00.000Z'), 'ceiling-5');
  });
});

describe('replayFirstStop: where a plan-review run stops, under the rule in force', () => {
  test('one-cycle era stops at the second Request Changes', () => {
    const comments = run([2, 1]);
    const stop = replayFirstStop(comments, 'one-cycle');
    assert.ok(stop);
    assert.strictEqual(stop.count, 2);
    assert.strictEqual(stop.at, comments[1].createdAt);
  });

  test('bound-3 era stops at the third verdict, not the second', () => {
    const comments = run([3, 2, 1]);
    assert.strictEqual(replayFirstStop(comments.slice(0, 2), 'bound-3'), null);
    const stop = replayFirstStop(comments, 'bound-3');
    assert.strictEqual(stop.count, 3);
  });

  test('ceiling-5 era lets a converging run go on, then stops at the ceiling', () => {
    // 3, 2, 1, 1: the last two are both Request Changes and the count is falling or flat at 1
    const converging = run([3, 2, 1, 1]);
    assert.strictEqual(replayFirstStop(converging, 'ceiling-5'), null);
    const stop = replayFirstStop(run([3, 2, 1, 1, 1]), 'ceiling-5');
    assert.strictEqual(stop.count, 5);
    assert.strictEqual(stop.kind, 'ceiling');
  });

  test('none era never stops', () => {
    assert.strictEqual(replayFirstStop(run([1, 1, 1, 1]), 'none'), null);
  });
});

describe('carveChild: the root-task-ratio carve rule', () => {
  test('a parent link plus an announcing opening is a carve', () => {
    assert.strictEqual(carveChild({ parent: 'LIN-10', description: 'Phase 2 of LIN-10: the seam.' }, 'LIN-10'), true);
  });
  test('a parent link alone is not a carve (follow-ups under the same parent)', () => {
    assert.strictEqual(carveChild({ parent: 'LIN-10', description: 'A follow-up from the close-out.' }, 'LIN-10'), false);
  });
  test('an announcing opening under another parent is not a carve of this one', () => {
    assert.strictEqual(carveChild({ parent: 'LIN-11', description: 'Phase 2 of LIN-11.' }, 'LIN-10'), false);
  });
});

describe('classifyBlocker: unwedge (U) against the exclusions', () => {
  // X is planned at 10:00, implemented at 12:00. Y is the candidate blocker.
  const X = {
    identifier: 'LIN-100',
    parent: 'LIN-50',
    createdAt: '2026-10-01T08:00:00.000Z',
    firstPlanAt: '2026-10-01T10:00:00.000Z',
    firstImplAt: '2026-10-01T12:00:00.000Z',
    children: [],
  };
  const Y = (over) => ({
    identifier: 'LIN-200',
    parent: null,
    createdAt: '2026-10-01T11:00:00.000Z',
    completedAt: '2026-10-01T11:30:00.000Z',
    state: { type: 'completed' },
    ...over,
  });

  test('positive control: a blocker filed and finished between plan and implementation is U', () => {
    assert.strictEqual(classifyBlocker(X, Y({})), 'U');
  });

  test('a blocker created before the first plan is P, not U', () => {
    assert.strictEqual(classifyBlocker(X, Y({ createdAt: '2026-10-01T09:00:00.000Z', completedAt: '2026-10-01T09:30:00.000Z' })), 'P');
  });

  test('a blocker created after the first implementation is not U', () => {
    assert.strictEqual(classifyBlocker(X, Y({ createdAt: '2026-10-01T13:00:00.000Z', completedAt: '2026-10-01T13:30:00.000Z' })), 'after-impl');
  });

  test('a blocker not Done before the first implementation is not U', () => {
    assert.strictEqual(classifyBlocker(X, Y({ completedAt: '2026-10-01T12:30:00.000Z' })), 'not-done');
  });

  test('a same-parent sibling created within ten minutes of X is a breakdown sibling, not U', () => {
    const sibling = Y({ parent: 'LIN-50', createdAt: '2026-10-01T08:05:00.000Z', completedAt: '2026-10-01T09:00:00.000Z' });
    assert.strictEqual(classifyBlocker(X, sibling), 'sibling');
  });

  test("X's own child is not U", () => {
    assert.strictEqual(classifyBlocker(X, Y({ parent: 'LIN-100' })), 'own-child');
  });

  test('no candidate blocker means no class', () => {
    assert.strictEqual(classifyBlocker(X, null), null);
  });
});

describe('classifyRefactor and breakdownCase', () => {
  test('a blocking-refactor title is an R (LIN-397) subtask', () => {
    assert.strictEqual(classifyRefactor({ title: 'Consolidate the seam (blocking refactor)' }), true);
    assert.strictEqual(classifyRefactor({ title: 'Home page copy' }), false);
  });

  test('a breakdown session or a carve child makes a breakdown case', () => {
    assert.strictEqual(breakdownCase({ identifier: 'LIN-1', sessions: [{ kind: 'breakdown' }], carveChildren: [] }).b1, true);
    const b = breakdownCase({ identifier: 'LIN-1', sessions: [], carveChildren: ['LIN-2'] });
    assert.strictEqual(b.b2, true);
    assert.strictEqual(b.b1, false);
  });
});
