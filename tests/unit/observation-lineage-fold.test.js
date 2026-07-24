// LIN-1487 (S2c): the Observation feed folds a multi-wake lineage into one
// visual unit at RENDER time, WITHOUT folding the payload. These vm-harness unit
// tests pin the four things the plan judged unit-provable:
//
//   T2 — `sessionSignature` is INVARIANT to lineage grouping (the fold must not
//        touch the repaint/summary-fetch gate), with a positive control that it
//        DOES move on a per-run agentState change (so the invariance isn't a
//        vacuous "signature is constant" pass).
//   T3 — `runsByLineage` grouping: two same-lineage runs → one group; a lone run
//        → its own group (rendered bare); THREE null-lineage runs → THREE groups,
//        never one bogus mega-group; mixed order preserved.
//   T4 — exactly one `is-rail-start` and one `is-rail-end` per task block,
//        regardless of grouping; a single-run block stamps BOTH on its one run.
//   T6 — a lineage spanning two issues splits across task blocks (deliberate
//        limitation): `runsByTask` groups by issue BEFORE the fold sees it.
//
// public/observation.js is a browser script, not an ES module, so we evaluate it
// in a vm sandbox (as observation-render.test.js does) and drive the real pure
// helpers exported through its test-only `module.exports` seam.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

const escapeHtml = (str) => {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};
const sandbox = {
  module: { exports: {} },
  window: { addEventListener() {} },
  document: { addEventListener() {} },
  escapeHtml,
  console,
};
vm.runInNewContext(src, sandbox, { filename: 'observation.js' });
const { sessionSignature, runsByLineage, renderTaskBlock, renderTasks } = sandbox.module.exports;

// A minimal worker run. `agentState` drives the signature term and the node
// state; `lineageId`/`issueIdentifier` drive the grouping.
function run(loopId, { lineageId, agentState = 'complete', issueIdentifier = 'LIN-1' } = {}) {
  return {
    loopId,
    // Only set the key when explicitly provided, so `undefined` models a stale
    // doc that never carried a lineageId.
    ...(lineageId !== undefined ? { lineageId } : {}),
    issueIdentifier,
    issueTitle: `Title ${loopId}`,
    agentState,
    stage: null, promptName: 'implementation', kind: 'implementation',
    iteration: null, agentSummary: null, runtime: null, metrics: [], toolPeak: null,
    producedArtifacts: [],
  };
}
const session = (runs, extra = {}) => ({
  sessionId: 's1', status: 'in-progress', runCount: runs.length,
  lastActivity: '2026-07-24T00:00:00.000Z', tasksTouched: [], runs, ...extra,
});
// `runsByLineage` runs inside the vm sandbox, so its arrays carry the sandbox
// realm's Array.prototype. Rebuild in THIS realm (Array.from) so deepStrictEqual,
// which checks prototype identity, compares structure not realm.
const ids = (groups) => Array.from(groups, g => Array.from(g, r => r.loopId));
const count = (hay, needle) => hay.split(needle).length - 1;

// ─── T2: signature invariance to the fold, with a positive control ───────────
test.describe('T2 — sessionSignature is invariant to lineage grouping', () => {
  test('adding lineageId to runs does not move the signature', () => {
    const plain = session([run('a', { lineageId: undefined }), run('b', { lineageId: undefined })]);
    const folded = session([run('a', { lineageId: 'L' }), run('b', { lineageId: 'L' })]);
    // Same loopIds + agentStates → identical signature, whether or not the two
    // runs now share a lineage. The fold is presentation-only.
    assert.equal(sessionSignature(folded), sessionSignature(plain));
  });

  test('POSITIVE CONTROL: a per-run agentState change DOES move the signature', () => {
    const before = session([run('a', { lineageId: 'L', agentState: 'running' }), run('b', { lineageId: 'L' })]);
    const after = session([run('a', { lineageId: 'L', agentState: 'complete' }), run('b', { lineageId: 'L' })]);
    // If the signature had folded the run term away, this transition inside a
    // lineage would be invisible and the open card would freeze. It must change.
    assert.notEqual(sessionSignature(after), sessionSignature(before));
  });
});

// ─── T3: the grouping function, including the null-collapse hazard ───────────
test.describe('T3 — runsByLineage grouping', () => {
  test('two runs sharing a lineage fold into one group', () => {
    const groups = runsByLineage([run('a', { lineageId: 'L' }), run('b', { lineageId: 'L' })]);
    assert.deepEqual(ids(groups), [['a', 'b']]);
  });

  test('a lone run is its own group (renders bare)', () => {
    const groups = runsByLineage([run('a', { lineageId: 'L' })]);
    assert.deepEqual(ids(groups), [['a']]);
  });

  test('THREE null-lineage runs → THREE groups, never one mega-group', () => {
    // The one bug that must not be written: grouping on raw `r.lineageId` would
    // collapse all three under a single `undefined` key. The `?? loopId`
    // fallback keeps them as three lineages-of-one.
    const groups = runsByLineage([
      run('a', { lineageId: undefined }),
      run('b', { lineageId: undefined }),
      run('c', { lineageId: null }),
    ]);
    assert.deepEqual(ids(groups), [['a'], ['b'], ['c']]);
  });

  test('mixed lineages preserve first-seen order; a lineage moves together', () => {
    // a(L1), b(L2), c(L1) → L1 folds [a,c] at a's position, then L2 [b].
    const groups = runsByLineage([
      run('a', { lineageId: 'L1' }),
      run('b', { lineageId: 'L2' }),
      run('c', { lineageId: 'L1' }),
    ]);
    assert.deepEqual(ids(groups), [['a', 'c'], ['b']]);
  });

  test('a group of ≥2 wraps in an obs-lineage unit; a group of 1 renders bare', () => {
    const two = renderTaskBlock(session([]), 'LIN-1', null,
      [run('a', { lineageId: 'L' }), run('b', { lineageId: 'L' })]);
    assert.match(two, /obs-lineage/, 'multi-run lineage is wrapped');
    assert.match(two, /obs-lineage-runs/);
    // Both runs keep their own per-run node/toggle target underneath.
    assert.ok(count(two, 'obs-worker-head') === 2, 'both runs keep their own head');
    assert.ok(count(two, 'data-loop="a"') === 1 && count(two, 'data-loop="b"') === 1,
      'each run keeps its own data-loop key');

    const one = renderTaskBlock(session([]), 'LIN-1', null, [run('a', { lineageId: 'L' })]);
    assert.doesNotMatch(one, /obs-lineage/, 'a lone run is never wrapped (byte-identical to before the fold)');
  });
});

// ─── T4: rail-trim classes — exactly one start/end per task block ────────────
test.describe('T4 — rail classes are stamped once per task block', () => {
  for (const n of [1, 2, 5]) {
    test(`${n} run(s), one lineage: exactly one is-rail-start and one is-rail-end`, () => {
      const runs = Array.from({ length: n }, (_, i) => run(`r${i}`, { lineageId: 'L' }));
      const html = renderTaskBlock(session([]), 'LIN-1', null, runs);
      assert.equal(count(html, 'is-rail-start'), 1, 'exactly one rail start');
      assert.equal(count(html, 'is-rail-end'), 1, 'exactly one rail end');
    });
  }

  test('mixed grouping (folded + bare) still yields exactly one start and one end', () => {
    const runs = [
      run('a', { lineageId: 'L1' }), run('b', { lineageId: 'L1' }), // folded pair
      run('c', { lineageId: undefined }),                          // bare
    ];
    const html = renderTaskBlock(session([]), 'LIN-1', null, runs);
    assert.equal(count(html, 'is-rail-start'), 1);
    assert.equal(count(html, 'is-rail-end'), 1);
  });

  test('a single-run block stamps BOTH classes on its one worker (matches the old sole :first+:last)', () => {
    const html = renderTaskBlock(session([]), 'LIN-1', null, [run('a', { lineageId: 'L' })]);
    // Both trims land on the same <li class="obs-worker …">.
    assert.match(html, /class="obs-worker is-rail-start is-rail-end"/);
  });

  test('an empty task block emits no rail classes', () => {
    const html = renderTaskBlock(session([]), 'LIN-1', null, []);
    assert.equal(count(html, 'is-rail-start'), 0);
    assert.equal(count(html, 'is-rail-end'), 0);
  });
});

// ─── T6: cross-issue lineage splits across task blocks (deliberate) ──────────
test.describe('T6 — a lineage spanning two issues splits (accepted limitation)', () => {
  test('two same-lineage runs on different issues render as two separate folds', () => {
    // One lineage 'L', but the two wakes ran against different issues. renderTasks
    // groups by issueIdentifier FIRST (runsByTask), so the fold — nested inside
    // each task block — never sees them together. Two task blocks, each a
    // lineage-of-one (bare), NOT one merged obs-lineage unit.
    const runs = [
      run('a', { lineageId: 'L', issueIdentifier: 'LIN-10' }),
      run('b', { lineageId: 'L', issueIdentifier: 'LIN-20' }),
    ];
    const html = renderTasks(session(runs, { tasksTouched: ['LIN-10', 'LIN-20'] }));
    assert.equal(count(html, 'obs-task-head'), 2, 'two task blocks, one per issue');
    // Neither block wraps: each holds a single run, so no obs-lineage unit is
    // emitted — the cross-issue lineage is deliberately NOT merged.
    assert.doesNotMatch(html, /obs-lineage/, 'the cross-issue lineage is split, not folded into one unit');
    assert.ok(count(html, 'data-loop="a"') === 1 && count(html, 'data-loop="b"') === 1);
  });
});
