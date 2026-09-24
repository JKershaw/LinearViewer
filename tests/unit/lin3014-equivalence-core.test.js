/**
 * scripts/lin3014/lib/equivalence-core.mjs (LIN-3014)
 *
 * The output-equivalence comparator: `deepStrictEqual` with NO normalisation
 * (research beat 3, `299efc16`, step 7 A — a JSON round-trip would pass a
 * Date-vs-ISO-string divergence and an omitted-vs-undefined key, both of
 * which must fail here), the row-classification predicates the sample
 * selection needs to name its abort-harvest/lineage/legacy/healed cases, and
 * the `lineageLastActivityMs` non-decreasing-timestamp screen.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyRow,
  comparisonKeyFor,
  compareLoops,
  compareSessionCounts,
  compareSessions,
  computeAbortHarvestStats,
  hasNonDecreasingTimestamps,
  selectSample
} from '../../scripts/lin3014/lib/equivalence-core.mjs';

function baseLoop(overrides = {}) {
  return {
    loopId: 'l1',
    terminalStatus: 'completed',
    terminalCompletedAt: new Date('2026-09-24T15:49:07.209Z'),
    wakeMarker: null,
    promptText: 'irrelevant (exempt)',
    feedback: [],
    toolPeak: 3,
    telemetry: { metrics: [{ ts: 1 }], runtime: { model: 'x' } },
    lineageMetrics: [{ ts: 1 }],
    ...overrides
  };
}

test('LIN-3014 compareLoops: identical loops (after exemptions) PASS', () => {
  const lean = baseLoop();
  const baseline = baseLoop();
  const result = compareLoops(lean, baseline);
  assert.strictEqual(result.equal, true);
});

test('LIN-3014 compareLoops: exempt-only differences (promptText/feedback/toolPeak/telemetry.metrics/lineageMetrics) still PASS', () => {
  const lean = baseLoop({ promptText: undefined, feedback: [], toolPeak: 7, telemetry: { metrics: [{ ts: 99 }], runtime: { model: 'x' } }, lineageMetrics: [{ ts: 99 }] });
  const baseline = baseLoop({ promptText: 'full prompt text', feedback: [{ kind: 'status' }], toolPeak: null, telemetry: { metrics: [{ ts: 1 }, { ts: 2 }], runtime: { model: 'x' } }, lineageMetrics: [{ ts: 1 }] });
  const result = compareLoops(lean, baseline);
  assert.strictEqual(result.equal, true, `exempt-only differences must not fail: ${result.message}`);
});

test('LIN-3014 compareLoops PLANTED DIFFERENCE: a Date vs its own ISO string is caught (a JSON round-trip would call it equal)', () => {
  const d = new Date('2026-09-24T15:49:07.209Z');
  const lean = baseLoop({ terminalCompletedAt: d });
  const baseline = baseLoop({ terminalCompletedAt: d.toISOString() });
  // Sanity: a JSON-normalised comparison WOULD treat these as equal.
  assert.strictEqual(JSON.stringify(lean.terminalCompletedAt), JSON.stringify(baseline.terminalCompletedAt));
  const result = compareLoops(lean, baseline);
  assert.strictEqual(result.equal, false, 'deepStrictEqual must distinguish a Date from an ISO string, unlike JSON normalisation');
});

test('LIN-3014 compareLoops PLANTED DIFFERENCE: an omitted key vs an explicit undefined is caught', () => {
  const lean = baseLoop({ wakeMarker: undefined });
  delete lean.wakeMarker; // genuinely omitted
  const baseline = baseLoop({ wakeMarker: undefined }); // explicitly present, value undefined
  assert.strictEqual('wakeMarker' in lean, false);
  assert.strictEqual('wakeMarker' in baseline, true);
  const result = compareLoops(lean, baseline);
  assert.strictEqual(result.equal, false, 'deepStrictEqual must distinguish an omitted key from an explicit undefined, unlike JSON normalisation (which drops both)');
});

test('LIN-3014 compareLoops PLANTED DIFFERENCE: a changed non-exempt scalar is caught', () => {
  const lean = baseLoop({ terminalStatus: 'completed' });
  const baseline = baseLoop({ terminalStatus: 'failed' });
  const result = compareLoops(lean, baseline);
  assert.strictEqual(result.equal, false);
  assert.match(result.message, /terminalStatus/);
});

test('LIN-3014 compareSessionCounts: equal count maps PASS, a changed count FAILS', () => {
  assert.strictEqual(compareSessionCounts({ 'LIN-1': 2 }, { 'LIN-1': 2 }).equal, true);
  assert.strictEqual(compareSessionCounts({ 'LIN-1': 2 }, { 'LIN-1': 3 }).equal, false);
});

test('LIN-3014 hasNonDecreasingTimestamps: true for non-decreasing, empty, or single-entry feedback', () => {
  assert.strictEqual(hasNonDecreasingTimestamps([]), true);
  assert.strictEqual(hasNonDecreasingTimestamps(undefined), true);
  assert.strictEqual(hasNonDecreasingTimestamps([{ timestamp: new Date(1000) }]), true);
  assert.strictEqual(hasNonDecreasingTimestamps([{ timestamp: new Date(1000) }, { timestamp: new Date(2000) }, { timestamp: new Date(2000) }]), true);
});

test('LIN-3014 hasNonDecreasingTimestamps: false for the counterexample shape (a late-position, earlier-timestamped beat)', () => {
  // research beat 3, step 7 C: the counterexample that refutes "lineageLastActivityMs identical in principle"
  const feedback = [
    { timestamp: new Date('2026-09-24T09:13:06.309Z') },
    { timestamp: new Date('2026-09-24T01:13:06.309Z') } // out of order
  ];
  assert.strictEqual(hasNonDecreasingTimestamps(feedback), false);
});

test('LIN-3014 classifyRow: distinguishes legacy-unhealed, heal-written, healed-legacy, abort, lineage, stale', () => {
  assert.deepStrictEqual(
    classifyRow({}),
    { legacyUnhealed: true, healWritten: false, healedLegacy: false, abortSource: false, lineageMember: false, stale: true }
  );
  assert.strictEqual(classifyRow({ feedbackDigest: { version: 0 } }).healWritten, true);
  assert.strictEqual(classifyRow({ feedbackDigest: { version: 0 } }).healedLegacy, true, 'feedbackVersion absent + digest object = healed-legacy');
  assert.strictEqual(classifyRow({ feedbackVersion: 0, feedbackDigest: null }).legacyUnhealed, false, 'seeded-empty (feedbackVersion:0, digest:null) is not legacy-unhealed');
  assert.strictEqual(classifyRow({ abort: true }).abortSource, true);
  assert.strictEqual(classifyRow({ rootItemId: 'root-1' }).lineageMember, true);
  assert.strictEqual(classifyRow({ feedbackVersion: 2, feedbackDigest: { version: 2 } }).stale, false);
});

test('LIN-3014 selectSample: covers each named class when present, and reports what is missing rather than guessing', () => {
  const docs = [
    { _id: 'legacy-1' }, // legacyUnhealed
    { _id: 'healed-1', feedbackDigest: { version: 0 } }, // healWritten
    { _id: 'abort-1', abort: true },
    { _id: 'lineage-1', rootItemId: 'root-1' },
    { _id: 'plain-1', feedbackVersion: 3, feedbackDigest: { version: 3 } }
  ];
  const { sample, coverage, missing } = selectSample(docs, { targetSize: 20 });
  assert.strictEqual(coverage.legacyUnhealed, true);
  assert.strictEqual(coverage.healWritten, true);
  assert.strictEqual(coverage.abortSource, true);
  assert.strictEqual(coverage.lineageMember, true);
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(sample.length, docs.length);
});

// LIN-3014 beat 3 production-run finding: an abort row is never its own
// standalone loop (it only harvests onto its TARGET's loop via `abortTo`),
// so looking it up by its own _id always misses on BOTH lean and non-lean —
// a false "ROW DROPPED" that isn't a real equivalence failure. Found running
// the actual tangle equivalence sample: both sampled abort rows reported
// "lean=false baseline=false" (agreement, not divergence) yet were still
// counted as failures.
test('LIN-3014 comparisonKeyFor: an abort row resolves to its TARGET loop id (abortTo), not its own _id', () => {
  assert.strictEqual(comparisonKeyFor({ _id: 'abort-row-1', abort: true, abortTo: 'target-loop-1' }), 'target-loop-1');
});

test('LIN-3014 comparisonKeyFor: an ordinary (non-abort) row resolves to its own _id', () => {
  assert.strictEqual(comparisonKeyFor({ _id: 'loop-1', abort: false }), 'loop-1');
  assert.strictEqual(comparisonKeyFor({ _id: 'loop-2' }), 'loop-2');
});

test('LIN-3014 comparisonKeyFor: abort:true with no abortTo falls back to its own _id rather than losing the row entirely', () => {
  assert.strictEqual(comparisonKeyFor({ _id: 'malformed-abort', abort: true }), 'malformed-abort');
});

test('LIN-3014 selectSample: a class with no population is reported MISSING, not silently skipped', () => {
  const docs = [{ _id: 'plain-1', feedbackVersion: 1, feedbackDigest: { version: 1 } }];
  const { coverage, missing } = selectSample(docs);
  assert.strictEqual(coverage.legacyUnhealed, false);
  assert.ok(missing.includes('legacy row'));
  assert.ok(missing.includes('just-healed row'));
  assert.ok(missing.includes('abort-harvest source'));
  assert.ok(missing.includes('lineage member'));
});

// Review ledger L1(a) on PR #1563 (`2fa813e3`): the run only checked
// lean -> pre-digest-lean, so a session dropped entirely from lean was
// invisible. compareSessions itself had no direct test — a mutant that
// always returned equal survived. These plant a non-exempt difference
// INSIDE loops[] (not at the session's own top level), which is exactly
// what a session-level comparator could get wrong by only checking fields
// outside `loops[]`.
function baseSession(overrides = {}) {
  return {
    sessionId: 's1',
    loops: [
      {
        loopId: 'l1',
        terminalStatus: 'completed',
        promptText: 'irrelevant (exempt)',
        feedback: [],
        toolPeak: 3,
        telemetry: { metrics: [{ ts: 1 }] },
        lineageMetrics: [{ ts: 1 }]
      }
    ],
    ...overrides
  };
}

test('LIN-3014 compareSessions: identical sessions (after loops[] exemptions) PASS', () => {
  const lean = baseSession();
  const baseline = baseSession();
  assert.strictEqual(compareSessions(lean, baseline).equal, true);
});

test('LIN-3014 compareSessions: exempt-only loops[] differences (toolPeak/telemetry.metrics/lineageMetrics/feedback/promptText) still PASS', () => {
  const lean = baseSession({
    loops: [{ ...baseSession().loops[0], promptText: undefined, toolPeak: 9, telemetry: { metrics: [{ ts: 42 }] }, lineageMetrics: [{ ts: 42 }] }]
  });
  const baseline = baseSession({
    loops: [{ ...baseSession().loops[0], promptText: 'full text', toolPeak: null, telemetry: { metrics: [{ ts: 1 }, { ts: 2 }] }, lineageMetrics: [{ ts: 1 }] }]
  });
  const result = compareSessions(lean, baseline);
  assert.strictEqual(result.equal, true, `exempt-only loops[] differences must not fail: ${result.message}`);
});

test('LIN-3014 compareSessions PLANTED DIFFERENCE: a non-exempt field INSIDE loops[] is caught', () => {
  const lean = baseSession();
  const baseline = baseSession({ loops: [{ ...baseSession().loops[0], terminalStatus: 'failed' }] });
  const result = compareSessions(lean, baseline);
  assert.strictEqual(result.equal, false, 'a changed non-exempt loops[] field must fail the session comparison');
  assert.match(result.message, /terminalStatus/);
});

// Review ledger L1(b)/(iii): the V2 bounds require abort source/target
// counts and at least one W1 sub-second case (a target whose own genuine
// terminal predates the abort) to be identified, not just sampled.
test('LIN-3014 computeAbortHarvestStats: counts sources and distinct targets', () => {
  const rows = [
    { _id: 'a1', abort: true, abortTo: 't1', feedback: [{ message: '[aborted]', timestamp: '2026-09-24T10:00:00.000Z' }] },
    { _id: 'a2', abort: true, abortTo: 't1', feedback: [{ message: '[aborted]', timestamp: '2026-09-24T10:00:01.000Z' }] }, // same target
    { _id: 'a3', abort: true, abortTo: 't2', feedback: [{ message: '[aborted]', timestamp: '2026-09-24T10:00:00.000Z' }] },
    { _id: 't1' },
    { _id: 't2' },
    { _id: 'plain-1' }
  ];
  const stats = computeAbortHarvestStats(rows);
  assert.strictEqual(stats.sourceCount, 3);
  assert.strictEqual(stats.targetCount, 2); // t1, t2 — deduplicated
});

test('LIN-3014 computeAbortHarvestStats W1 case: the harvested abort wins when the target\'s own terminal predates it', () => {
  const rows = [
    {
      _id: 'target-1',
      // Target's own genuine terminal, well before the abort.
      feedback: [{ message: '[done]', timestamp: '2026-09-24T09:00:00.000Z' }]
    },
    {
      _id: 'abort-1',
      abort: true,
      abortTo: 'target-1',
      // Sub-second-later abort — must win per the app's own F1 guard.
      feedback: [{ message: '[aborted]', timestamp: '2026-09-24T09:00:00.500Z' }]
    }
  ];
  const stats = computeAbortHarvestStats(rows);
  assert.deepStrictEqual(stats.w1Cases, [{ sourceId: 'abort-1', targetId: 'target-1', gapMs: 500 }]);
  assert.deepStrictEqual(stats.noPriorTerminal, []);
});

test('LIN-3014 computeAbortHarvestStats: NOT a W1 case when the target\'s own terminal is AFTER the abort (guard keeps the later genuine terminal)', () => {
  const rows = [
    {
      _id: 'target-1',
      feedback: [{ message: '[done]', timestamp: '2026-09-24T09:00:01.000Z' }]
    },
    {
      _id: 'abort-1',
      abort: true,
      abortTo: 'target-1',
      feedback: [{ message: '[aborted]', timestamp: '2026-09-24T09:00:00.000Z' }]
    }
  ];
  const stats = computeAbortHarvestStats(rows);
  assert.deepStrictEqual(stats.w1Cases, []);
  assert.deepStrictEqual(stats.noPriorTerminal, []);
});

test('LIN-3014 computeAbortHarvestStats F1: a target with no prior terminal at all is NOT a W1 case (nothing to predate) — it is reported separately', () => {
  const rows = [
    { _id: 'target-1', feedback: [] },
    { _id: 'abort-1', abort: true, abortTo: 'target-1', feedback: [{ message: '[aborted]', timestamp: '2026-09-24T09:00:00.000Z' }] }
  ];
  const stats = computeAbortHarvestStats(rows);
  assert.deepStrictEqual(stats.w1Cases, []);
  assert.deepStrictEqual(stats.noPriorTerminal, [{ sourceId: 'abort-1', targetId: 'target-1' }]);
});
