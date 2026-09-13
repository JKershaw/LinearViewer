/**
 * Unit tests for lib/effort-readout.js (LIN-2641).
 *
 * G2 is pinned FIRST per the implementation ruling (`5ec445a0`): the reviewer's
 * exact defect (`583701c2`) was `computePlanReviewRoundTrips` handed a bare row
 * set instead of issue objects, so both survival columns silently ship empty.
 * This suite proves the fix is real by exercising the actual code path, not by
 * citing the contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDispatchRow,
  partitionPopulation,
  buildIssueCorpus,
  tierAbSurvival,
  computeEffortReadout,
  ORCHESTRATION_KINDS,
  NOT_INSTRUMENTED_KINDS,
} from '../../lib/effort-readout.js';
import { computePlanReviewRoundTrips } from '../../lib/plan-review-round-trips.js';

const ASOF = '2026-09-05T16:00:00.000Z';

// A realistic settled history row: raw `status: 'taken'` (what `_archiveItem`
// actually persists — 'done' is never a RAW status, only a derived
// `lifecycleStatus`) plus a terminal `[done]` feedback marker so
// `normalizeDispatchRow` derives `lifecycleStatus: 'done'` with a real
// `completedAt`. `buildTaskCost`'s own filter (`row.status === 'taken'`)
// depends on the raw field staying 'taken'.
function doneRow({ id, issueId, issueIdentifier, kind, dispatchedAt, completedAt }) {
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [{ message: '[done] complete', timestamp: completedAt }],
  };
}

// A 4-row lineage matching Revision 4's own G2 fixture: plan -> plan-review ->
// implementation -> review, all settled, verdict comments present on both
// gate rows.
function fourRowLineageRows({ issueIdentifier = 'LIN-1', issueId = 'issue-1' } = {}) {
  return [
    doneRow({ id: 'r1', issueId, issueIdentifier, kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
    doneRow({ id: 'r2', issueId, issueIdentifier, kind: 'plan-review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:30:00.000Z' }),
    doneRow({ id: 'r3', issueId, issueIdentifier, kind: 'implementation', dispatchedAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T02:30:00.000Z' }),
    doneRow({ id: 'r4', issueId, issueIdentifier, kind: 'review', dispatchedAt: '2026-09-01T03:00:00.000Z', completedAt: '2026-09-01T03:30:00.000Z' }),
  ];
}

function fourRowLineageComments() {
  return [
    { id: 'c1', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z' },
    { id: 'c2', body: 'Verdict: approve', createdAt: '2026-09-01T03:30:00.000Z' },
  ];
}

// A realistic PRICED/timed row (R1, R2): raw `status: 'taken'` plus a genuine
// `[usage]` telemetry entry — the wire shape `parseUsagePayload`
// (lib/session-telemetry.js) actually parses — AND a `[done]` terminal
// marker. This is what a settled worker session that reported cost/effort
// looks like; `doneRow` above deliberately carries no usage telemetry at all
// (it exists to exercise the survival walk, not the cost path), and the
// implementation review's ledger (item 4) named relying on a telemetry-free
// fixture for a cost-path assertion as a defect in its own right.
function pricedRow({ id, issueId, issueIdentifier, kind, dispatchedAt, completedAt, costUsd, effort = null }) {
  const usagePayload = { model: 'test/model' };
  if (costUsd != null) usagePayload.costUsd = costUsd;
  if (effort) usagePayload.effort = effort;
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [
      { kind: 'usage', message: `[usage] ${JSON.stringify(usagePayload)}` },
      { message: '[done] complete', timestamp: completedAt },
    ],
  };
}

// A priced row whose terminal marker carries no `timestamp` — `deriveCompletedAt`
// then returns null even though the row is a settled 'done' (lifecycleStatus
// only needs the MARKER, not its timestamp), so `buildTaskCost` derives a
// `durationMs` of null while `costUsd` still populates from the separate
// `[usage]` entry. Used to exercise a lineage priced but not timed — the
// other half of R2's per-column coverage disclosure.
function pricedRowNoDuration({ id, issueId, issueIdentifier, kind, dispatchedAt, costUsd }) {
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [
      { kind: 'usage', message: `[usage] ${JSON.stringify({ model: 'test/model', costUsd })}` },
      { message: '[done] complete' },
    ],
  };
}

describe('G2 — issue-object contract (plan-review 583701c2)', () => {
  test('RED: passing a bare row set (the plan-review defect) yields an empty walk — rate null, roundTrips.n 0', () => {
    const rows = fourRowLineageRows();
    // The exact mistake J1 found: handing the walk rows directly, not issues.
    const result = computePlanReviewRoundTrips(rows, { asOf: ASOF });
    assert.equal(result.primary.rate, null);
    assert.equal(result.primary.denominator, 0);
    assert.equal(result.roundTrips.n, 0);
  });

  test('GREEN: buildIssueCorpus groups rows into issue objects, producing a populated survival row', () => {
    const rows = fourRowLineageRows();
    const issueContext = new Map([
      ['LIN-1', { id: 'issue-1', description: '', comments: fourRowLineageComments() }],
    ]);
    // `buildIssueCorpus` consumes NORMALIZED rows (lifecycleStatus, not raw
    // status) — 'done' here is the derived value normalizeDispatchRow would
    // have produced from each row's [done] terminal marker.
    const corpus = buildIssueCorpus(rows.map((r) => ({ ...r, lifecycleStatus: 'done', completedAt: r.feedback[0].timestamp })), issueContext);
    assert.equal(corpus.length, 1);
    assert.equal(corpus[0].identifier, 'LIN-1');
    assert.ok(Array.isArray(corpus[0].rows) && corpus[0].rows.length === 4);

    const planResult = computePlanReviewRoundTrips(corpus, { asOf: ASOF });
    assert.equal(planResult.primary.rate, 1);
    assert.equal(planResult.primary.denominator, 1);
    assert.equal(planResult.roundTrips.n, 1);

    const reviewResult = computePlanReviewRoundTrips(corpus, { asOf: ASOF, gateKind: 'review', rePassKind: 'implementation' });
    assert.equal(reviewResult.scale.issuesRead, 1);
  });

  test('computeEffortReadout end-to-end: both survival columns populated from one corpus (G2)', () => {
    const rows = fourRowLineageRows();
    const issueContext = new Map([
      ['LIN-1', { id: 'issue-1', description: '', comments: fourRowLineageComments() }],
    ]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    const planCard = readout.perKind.find((k) => k.kind === 'plan');
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(planCard.survival.state, 'computed');
    assert.equal(planCard.survival.rate, 1);
    assert.equal(implCard.survival.state, 'computed');
    // gateDue/gateHonoured must be present on the plan card, absent from implementation's.
    assert.ok('gateDue' in planCard.survival);
    assert.ok(!('gateDue' in implCard.survival));
  });
});

describe('G3 — asOf threaded, not omitted or improvised per-call', () => {
  test('both computePlanReviewRoundTrips calls receive the exact injected asOf', () => {
    const rows = fourRowLineageRows();
    const issueContext = new Map([['LIN-1', { id: 'issue-1', comments: fourRowLineageComments() }]]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    // No throw (requireAsOf would throw on a missing/bad asOf) and a real result came back.
    assert.ok(readout.perKind.length > 0);
  });

  test('computeEffortReadout throws on a missing asOf rather than silently defaulting', () => {
    assert.throws(() => computeEffortReadout({ liveRows: [], historyRows: [] }), /asOf/);
  });
});

describe('G4 — cost is per-lineage, survival is per-issue', () => {
  test('two implementation lineages on one issue: 2 worker sessions, 1 survival denominator', () => {
    const rows = [
      ...fourRowLineageRows({ issueIdentifier: 'LIN-9', issueId: 'issue-9' }),
      // A second, independent implementation lineage on the SAME issue (different rootItemId/anchor via a distinct id).
      doneRow({ id: 'r5', issueId: 'issue-9', issueIdentifier: 'LIN-9', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T00:30:00.000Z' }),
      doneRow({ id: 'r6', issueId: 'issue-9', issueIdentifier: 'LIN-9', kind: 'review', dispatchedAt: '2026-09-02T01:00:00.000Z', completedAt: '2026-09-02T01:30:00.000Z' }),
    ];
    const issueContext = new Map([
      ['LIN-9', { id: 'issue-9', comments: [
        { id: 'c1', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z' },
        { id: 'c2', body: 'Verdict: approve', createdAt: '2026-09-01T03:30:00.000Z' },
        { id: 'c3', body: 'Verdict: approve', createdAt: '2026-09-02T01:30:00.000Z' },
      ] }],
    ]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.sessionCount, 2, 'two implementation dispatch rows -> two worker-session entries');
    assert.equal(implCard.costUnit, 'lineage');
    assert.equal(implCard.survivalUnit, 'issue');
    // Only ONE issue -> at most one R0 settles per gate walk regardless of how many implementation lineages it has.
    assert.ok(implCard.survival.denominator <= 1);
  });
});

describe('G1 — normalizeDispatchRow closes the live-row three-field gap', () => {
  test('a live-queue row (no status/feedback/completedAt keys) normalizes to queued/[]/null and lands in inFlight, not eligible', () => {
    const liveRow = { id: 'live-1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-05T00:00:00.000Z' };
    const normalized = normalizeDispatchRow(liveRow, { isLive: true });
    assert.equal(normalized.status, 'queued');
    assert.deepEqual(normalized.feedback, []);
    assert.equal(normalized.completedAt, null);
    assert.equal(normalized.lifecycleStatus, 'queued');

    const { eligible, inFlightByKind } = partitionPopulation([normalized]);
    assert.equal(eligible.length, 0);
    assert.equal(inFlightByKind.implementation.queued, 1);
  });

  test('end-to-end: a live row contributes to neither cost/duration/effort nor survival', () => {
    const liveRow = { id: 'live-1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-05T00:00:00.000Z' };
    const readout = computeEffortReadout({ liveRows: [liveRow], historyRows: [], issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.sessionCount, 0);
    assert.equal(implCard.survival.denominator, 0);
    assert.equal(implCard.inFlight.queued, 1);
  });
});

describe('two-vocabulary pin (raw status vs. derived lifecycleStatus)', () => {
  test('a taken row that derives aborted is excluded from both joins, while the raw-status set still sees it as "taken"', () => {
    const row = {
      id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken',
      dispatchedAt: '2026-09-01T00:00:00.000Z',
      feedback: [{ message: '[aborted] cancelled by operator', timestamp: '2026-09-01T01:00:00.000Z' }],
    };
    const normalized = normalizeDispatchRow(row, { isLive: false });
    assert.equal(normalized.lifecycleStatus, 'aborted');
    assert.equal(row.status, 'taken', 'raw status is untouched by normalization');

    const { eligible, excludedByKind } = partitionPopulation([normalized]);
    assert.equal(eligible.length, 0);
    assert.equal(excludedByKind.implementation.aborted, 1);
  });
});

describe('F1 — total kind partition over every kind present', () => {
  test('close-out/spike/breakdown/bug/defer each get a card in state (iv), never dropped by a bucketOf fallback', () => {
    const kinds = ['close-out', 'spike', 'breakdown', 'bug', 'defer'];
    const rows = kinds.map((kind, i) => doneRow({
      id: `r${i}`, issueId: `i${i}`, issueIdentifier: `LIN-${i}`, kind,
      dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z',
    }));
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    for (const kind of kinds) {
      const card = readout.perKind.find((k) => k.kind === kind);
      assert.ok(card, `${kind} must have a card`);
      assert.equal(card.survival.state, 'not_applicable_no_gate', `${kind} must be state (iv), not orchestration`);
      // close-out/spike/breakdown still populate cost/duration/effort from their own worker sessions (state (iv) differs only in survival, never in whether a card has data).
      assert.equal(card.sessionCount, 1);
    }
  });

  test('a custom-kind row renders state (iii) — not-applicable orchestration — via the explicit set, not bucketOf', () => {
    const rows = [{ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'custom', status: 'done', dispatchedAt: '2026-09-01T00:00:00.000Z', feedback: [] }];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const card = readout.perKind.find((k) => k.kind === 'custom');
    assert.equal(card.survival.state, 'not_applicable_orchestration');
  });

  test('a synthetic future kind (absent from every named set) still renders state (iv), never dropped', () => {
    const rows = [{ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'some-future-kind', status: 'done', dispatchedAt: '2026-09-01T00:00:00.000Z', feedback: [] }];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const card = readout.perKind.find((k) => k.kind === 'some-future-kind');
    assert.ok(card);
    assert.equal(card.survival.state, 'not_applicable_no_gate');
    assert.ok(!ORCHESTRATION_KINDS.has('some-future-kind'));
    assert.ok(!NOT_INSTRUMENTED_KINDS.has('some-future-kind'));
  });
});

describe('S1 — review-row tier a/b split, tier-c beside', () => {
  test('one tier-a approve, one tier-c re-pass, one unresolved approve: rate is 1-of-1 over a/b, tier-c counted separately', () => {
    const rows = [
      // Issue A: review row settles tier a (verdict comment present).
      { id: 'a1', issueId: 'ia', issueIdentifier: 'LIN-A', kind: 'implementation', status: 'done', dispatchedAt: '2026-09-01T00:00:00.000Z', feedback: [] },
      { id: 'a2', issueId: 'ia', issueIdentifier: 'LIN-A', kind: 'review', status: 'done', dispatchedAt: '2026-09-01T01:00:00.000Z', feedback: [] },
      // Issue B: review row settles tier c via a request-changes re-pass (implementation follows).
      { id: 'b1', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'implementation', status: 'done', dispatchedAt: '2026-09-01T00:00:00.000Z', feedback: [] },
      { id: 'b2', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'review', status: 'done', dispatchedAt: '2026-09-01T01:00:00.000Z', feedback: [] },
      { id: 'b3', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'implementation', status: 'done', dispatchedAt: '2026-09-01T02:00:00.000Z', feedback: [] },
      // Issue C: review row has NO verdict comment and no re-pass follows -> unresolved, excluded entirely.
      { id: 'c1', issueId: 'ic', issueIdentifier: 'LIN-C', kind: 'implementation', status: 'done', dispatchedAt: '2026-09-01T00:00:00.000Z', feedback: [] },
      { id: 'c2', issueId: 'ic', issueIdentifier: 'LIN-C', kind: 'review', status: 'done', dispatchedAt: '2026-09-01T01:00:00.000Z', feedback: [] },
    ];
    const issueContext = new Map([
      ['LIN-A', { id: 'ia', comments: [{ id: 'ca', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z' }] }],
      ['LIN-B', { id: 'ib', comments: [] }],
      ['LIN-C', { id: 'ic', comments: [] }],
    ]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.survival.denominator, 1, 'tier-c and unresolved rows excluded from the a/b denominator');
    assert.equal(implCard.survival.numerator, 1);
    assert.equal(implCard.survival.rate, 1);
    assert.equal(implCard.survival.tierCCount, 1);
  });
});

describe('D10 — ship_empty effort column', () => {
  test('a workerSession with effort: null renders as no distribution (not reported)', () => {
    const rows = fourRowLineageRows();
    const issueContext = new Map([['LIN-1', { id: 'issue-1', comments: fourRowLineageComments() }]]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    const planCard = readout.perKind.find((k) => k.kind === 'plan');
    // No telemetry in this fixture at all -> sessionCount 0, effort null either way;
    // the shape under test is that `effort` is null when no session reports one.
    assert.equal(planCard.effort, null);
  });
});

describe('R1 — effort-caption honesty (implementation review 62e30986)', () => {
  test('no session in the corpus reports a realised effort: the caption still names LIN-2567 as pending', () => {
    // fourRowLineageRows/doneRow carry no [usage] telemetry at all.
    const rows = fourRowLineageRows();
    const issueContext = new Map([['LIN-1', { id: 'issue-1', comments: fourRowLineageComments() }]]);
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext, asOf: ASOF });
    assert.match(readout.notes.effortShipEmpty, /does not yet report a realised effort value/);
    assert.match(readout.notes.effortShipEmpty, /LIN-2567/);
  });

  test('a session in the corpus reports a realised effort: the caption states what is true instead of a stale universal absence', () => {
    const rows = [
      pricedRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 5, effort: 'high' }),
      // A second, un-stamped (backfill) lineage of the same kind, alongside the stamped one.
      doneRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    assert.doesNotMatch(readout.notes.effortShipEmpty, /does not yet report a realised effort value/, 'the false unconditional claim must not survive once a session reports one');
    assert.match(readout.notes.effortShipEmpty, /LIN-2567/);
    assert.match(readout.notes.effortShipEmpty, /backfill/i, 'must disclose that un-stamped (backfill) rows stay null permanently');
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    // The per-row read path is unchanged: the stamped row's effort still renders, the backfill row's does not.
    assert.deepEqual(implCard.effort, { high: 1 });
  });

  test('a requested (row-level) effort value never substitutes for a realised one, regardless of corpus state', () => {
    const row = { ...pricedRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 5 }), effort: 'low' };
    const readout = computeEffortReadout({ liveRows: [], historyRows: [row], issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.effort, null, 'the dispatch row\'s own REQUESTED effort field must never populate the realised-effort cell');
  });
});

describe('R2 — cost is a SUM, duration is a MEAN, with per-column coverage (implementation review 62e30986)', () => {
  test('two priced lineages and one unpriced (but timed) lineage: cost sums only the priced two, duration means all three, coverage is disclosed', () => {
    const rows = [
      pricedRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', costUsd: 3 }),
      pricedRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T03:00:00.000Z', costUsd: 9 }),
      // No [usage] telemetry at all -> unpriced, but still carries a terminal marker -> still timed.
      doneRow({ id: 'r3', issueId: 'i3', issueIdentifier: 'LIN-3', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T02:00:00.000Z' }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.sessionCount, 3);
    assert.equal(implCard.costUsd, 12, 'cost is the SUM of the two priced lineages, not an average over all three');
    assert.equal(implCard.costAggregation, 'sum');
    assert.equal(implCard.costPricedCount, 2);
    assert.equal(implCard.costUnpricedCount, 1);
    assert.equal(implCard.durationMs, 2 * 60 * 60 * 1000, 'duration is the MEAN of the three (1h, 3h, 2h)');
    assert.equal(implCard.durationAggregation, 'mean');
    assert.equal(implCard.durationCoveredCount, 3);
    assert.equal(implCard.durationMissingCount, 0);
  });

  test('a lineage priced but not timed is excluded from the duration mean while still counting toward cost', () => {
    const rows = [
      pricedRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', costUsd: 4 }),
      // Terminal marker present (so the row is a settled 'done', eligible) but with no
      // timestamp, so `deriveCompletedAt` returns null and `buildTaskCost` derives no duration.
      pricedRowNoDuration({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', costUsd: 8 }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.costUsd, 12, 'both lineages are priced');
    assert.equal(implCard.costPricedCount, 2);
    assert.equal(implCard.costUnpricedCount, 0);
    assert.equal(implCard.durationMs, 60 * 60 * 1000, 'duration means only the one lineage with a resolved terminal duration');
    assert.equal(implCard.durationCoveredCount, 1);
    assert.equal(implCard.durationMissingCount, 1);
  });

  test('notes.costUnit states the three distinct aggregations and does not claim cost is per-lineage the way duration/effort are', () => {
    const readout = computeEffortReadout({ liveRows: [], historyRows: [], issueContext: new Map(), asOf: ASOF });
    assert.match(readout.notes.costUnit, /SUM/);
    assert.match(readout.notes.costUnit, /MEAN/);
    assert.match(readout.notes.costUnit, /COUNT/);
  });
});

describe('a blocked row is right-censored (LIN-2079)', () => {
  test('a row whose lifecycleStatus derives "blocked" is in-flight, not scored', () => {
    const row = {
      id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken',
      dispatchedAt: '2026-09-01T00:00:00.000Z',
      feedback: [{ message: '[blocked] waiting on a human', timestamp: '2026-09-01T01:00:00.000Z' }],
    };
    const normalized = normalizeDispatchRow(row, { isLive: false });
    assert.equal(normalized.lifecycleStatus, 'blocked');
    const { eligible, inFlightByKind } = partitionPopulation([normalized]);
    assert.equal(eligible.length, 0);
    assert.equal(inFlightByKind.implementation.blocked, 1);
  });
});

// ─── LIN-2830: harness/model grouping columns, effort-less rows survive ─────
//
// The bake-off (LIN-2828/LIN-2831) reads this page to compare cost/duration
// across harnesses and models. Two wire shapes matter here, both REAL:
// - claude-code's hook.js postUsageSnapshot: {harness: 'claude-code',
//   model, effort, tokens..., costUsd: null (derived on Harbour's side),
//   lane: 'subscription'}.
// - opencode's opencode-runner.js postUsageFeedback (LIN-1425): {harness:
//   'opencode', model: info.modelID, tokens..., costUsd: <native>, lane:
//   'openrouter'} — and DELIBERATELY NO effort field (Simple Dispatcher
//   omits it for that harness; opencode has no documented effort key).
function claudeCodeUsageRow({ id, issueId, issueIdentifier, kind, dispatchedAt, completedAt, model, effort, costUsd }) {
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [
      { kind: 'usage', message: `[usage] ${JSON.stringify({ schema: 1, harness: 'claude-code', model, effort, inputTokens: 100, outputTokens: 50, costUsd, lane: 'subscription' })}` },
      { message: '[done] complete', timestamp: completedAt },
    ],
  };
}

function opencodeUsageRow({ id, issueId, issueIdentifier, kind, dispatchedAt, completedAt, model = 'z-ai/glm-5.3', costUsd }) {
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [
      { kind: 'usage', message: `[usage] ${JSON.stringify({ schema: 1, harness: 'opencode', model, inputTokens: 100, outputTokens: 50, costUsd, lane: 'openrouter' })}` },
      { message: '[done] complete', timestamp: completedAt },
    ],
  };
}

describe('LIN-2830 — harness/model split rows per kind', () => {
  test('a claude-code run and an opencode run of the same kind land in two distinct rows with their own figures', () => {
    const rows = [
      claudeCodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', model: 'anthropic/claude-sonnet-5', effort: 'high', costUsd: null }),
      opencodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T00:30:00.000Z', costUsd: 0.42 }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.ok(Array.isArray(implCard.rows), 'the kind card must carry a per-(harness, model, effort) rows breakdown');
    assert.equal(implCard.rows.length, 2, 'the two harnesses must be distinguishable — one row each, never merged');
    const claudeRow = implCard.rows.find((r) => r.harness === 'claude-code');
    const opencodeRowRow = implCard.rows.find((r) => r.harness === 'opencode');
    assert.ok(claudeRow, 'the claude-code run is its own row');
    assert.ok(opencodeRowRow, 'the opencode run is its own row');
    assert.equal(claudeRow.model, 'anthropic/claude-sonnet-5');
    assert.equal(claudeRow.effort, 'high');
    assert.equal(claudeRow.sessionCount, 1);
    assert.equal(claudeRow.durationMs, 60 * 60 * 1000);
    assert.equal(opencodeRowRow.model, 'z-ai/glm-5.3');
    assert.equal(opencodeRowRow.sessionCount, 1);
    assert.equal(opencodeRowRow.durationMs, 30 * 60 * 1000);
    // The rows are a partition of the card, never a second population: the
    // row session counts and row costs must sum to the kind-level figures.
    assert.equal(implCard.rows.reduce((sum, r) => sum + r.sessionCount, 0), implCard.sessionCount);
    const pricedRowSum = implCard.rows.reduce((sum, r) => sum + (r.costUsd || 0), 0);
    assert.ok(Math.abs(pricedRowSum - implCard.costUsd) < 1e-9, 'row costs partition the kind-level cost sum');
    assert.ok(Math.abs((claudeRow.costUsd || 0) + (opencodeRowRow.costUsd || 0) - implCard.costUsd) < 1e-9);
  });

  test('same harness and model but different effort levels still split by effort', () => {
    const rows = [
      claudeCodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', model: 'anthropic/claude-sonnet-5', effort: 'high', costUsd: null }),
      claudeCodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T01:00:00.000Z', model: 'anthropic/claude-sonnet-5', effort: 'low', costUsd: null }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 2, 'effort is part of the row key');
    assert.deepEqual(implCard.rows.map((r) => r.effort).sort(), ['high', 'low']);
  });

  // The bake-off's exact distinguishing case (LIN-2830: "a run on opencode is
  // indistinguishable from one on claude-code") — rows that differ ONLY in
  // harness, or ONLY in model, must still split. Pinning each key column in
  // isolation so a grouping that silently drops one column cannot pass.
  test('rows differing only in harness, or only in model, still split — each key column is load-bearing', () => {
    const sameModelDifferentHarness = [
      claudeCodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', model: 'z-ai/glm-5.3', effort: null, costUsd: null }),
      opencodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T01:00:00.000Z', model: 'z-ai/glm-5.3', costUsd: 0.42 }),
    ];
    let readout = computeEffortReadout({ liveRows: [], historyRows: sameModelDifferentHarness, issueContext: new Map(), asOf: ASOF });
    let implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 2, 'same model + same (null) effort, different harness: two rows');
    assert.deepEqual(implCard.rows.map((r) => r.harness).sort(), ['claude-code', 'opencode']);

    const sameHarnessDifferentModel = [
      opencodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', model: 'z-ai/glm-5.3', costUsd: 0.42 }),
      opencodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T01:00:00.000Z', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.10 }),
    ];
    readout = computeEffortReadout({ liveRows: [], historyRows: sameHarnessDifferentModel, issueContext: new Map(), asOf: ASOF });
    implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 2, 'same harness + same (null) effort, different model: two rows');
    assert.deepEqual(implCard.rows.map((r) => r.model).sort(), ['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3']);
  });
});

describe('LIN-2830 — an effort-less opencode row survives, never dropped', () => {
  test('an opencode session with no effort field keeps its own row with effort null', () => {
    const rows = [
      opencodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 0.42 }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.sessionCount, 1);
    assert.equal(implCard.rows.length, 1, 'the effort-less row must not be dropped from the breakdown');
    assert.equal(implCard.rows[0].harness, 'opencode');
    assert.equal(implCard.rows[0].model, 'z-ai/glm-5.3');
    assert.equal(implCard.rows[0].effort, null, 'no effort reported — null, the renderer shows "—"');
    assert.equal(implCard.rows[0].sessionCount, 1);
    assert.equal(implCard.rows[0].costUsd, 0.42);
  });

  test('an effort-less opencode row and a claude-code row with effort never merge into one group', () => {
    const rows = [
      opencodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 0.42 }),
      claudeCodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T01:00:00.000Z', model: 'anthropic/claude-sonnet-5', effort: 'high', costUsd: null }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 2);
    const effortless = implCard.rows.find((r) => r.effort === null);
    assert.ok(effortless, 'the null-effort bucket exists as its own row');
    assert.equal(effortless.harness, 'opencode');
  });

  test('a session with no usage telemetry at all still gets a row (all three columns null)', () => {
    const rows = [doneRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' })];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 1, 'no telemetry is a row with unknown columns, not a dropped row');
    assert.equal(implCard.rows[0].harness, null);
    assert.equal(implCard.rows[0].model, null);
    assert.equal(implCard.rows[0].effort, null);
    assert.equal(implCard.rows[0].sessionCount, 1);
  });

  test('row ordering is deterministic: harness, then model, then effort, nulls last', () => {
    const rows = [
      claudeCodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T01:00:00.000Z', model: 'anthropic/claude-sonnet-5', effort: 'high', costUsd: null }),
      opencodeUsageRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T00:30:00.000Z', costUsd: 0.42 }),
      opencodeUsageRow({ id: 'r3', issueId: 'i3', issueIdentifier: 'LIN-3', kind: 'implementation', dispatchedAt: '2026-09-02T02:00:00.000Z', completedAt: '2026-09-02T02:30:00.000Z', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.10 }),
      doneRow({ id: 'r4', issueId: 'i4', issueIdentifier: 'LIN-4', kind: 'implementation', dispatchedAt: '2026-09-03T00:00:00.000Z', completedAt: '2026-09-03T00:30:00.000Z' }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.deepEqual(
      implCard.rows.map((r) => [r.harness, r.model, r.effort]),
      [
        ['claude-code', 'anthropic/claude-sonnet-5', 'high'],
        ['opencode', 'deepseek/deepseek-v4.1-flash', null],
        ['opencode', 'z-ai/glm-5.3', null],
        [null, null, null],
      ]
    );
  });

  test('requested (row-level) harness/model/effort values never substitute for realised ones (D10 rule, extended)', () => {
    // The dispatch row's own `harness`/`model`/`effort` fields are REQUESTED
    // values (what was asked to run); the row breakdown reports REALISED
    // telemetry only. A row claiming claude-code/wrong-model/high must not
    // leak those into the breakdown when the run's [usage] payload says
    // opencode/z-ai/glm-5.3/absent.
    const row = {
      ...opencodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 0.42 }),
      harness: 'claude-code', model: 'wrong/model', effort: 'high',
    };
    const readout = computeEffortReadout({ liveRows: [], historyRows: [row], issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 1);
    assert.equal(implCard.rows[0].harness, 'opencode', 'the requested row harness must never populate the breakdown');
    assert.equal(implCard.rows[0].model, 'z-ai/glm-5.3');
    assert.equal(implCard.rows[0].effort, null, 'the requested row effort must never populate the breakdown');
  });

  test('row-level cost/duration coverage counts disclose partial figures (R2 discipline, row-scoped)', () => {
    // One priced+timed opencode lineage and one telemetry-free (but still
    // timed — a [done] marker timestamp is enough for duration) lineage: the
    // opencode row reports full coverage, the no-telemetry row reports an
    // unpriced cost only — a row must never present a partial figure as if
    // it covered its sessions.
    const rows = [
      opencodeUsageRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z', costUsd: 0.42 }),
      doneRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'implementation', dispatchedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T00:30:00.000Z' }),
    ];
    const readout = computeEffortReadout({ liveRows: [], historyRows: rows, issueContext: new Map(), asOf: ASOF });
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    const opencodeRowRow = implCard.rows.find((r) => r.harness === 'opencode');
    const unknownRow = implCard.rows.find((r) => r.harness === null);
    assert.equal(opencodeRowRow.costPricedCount, 1);
    assert.equal(opencodeRowRow.durationCoveredCount, 1);
    assert.equal(opencodeRowRow.costUsd, 0.42);
    assert.equal(opencodeRowRow.durationMs, 30 * 60 * 1000);
    // No telemetry ⇒ no price, but the terminal marker still times it.
    assert.equal(unknownRow.costUsd, null);
    assert.equal(unknownRow.costPricedCount, 0);
    assert.equal(unknownRow.durationMs, 30 * 60 * 1000);
    assert.equal(unknownRow.durationCoveredCount, 1);
  });

  test('notes disclose the row provenance: realised telemetry values, and why opencode reads "—" for effort', () => {
    const readout = computeEffortReadout({ liveRows: [], historyRows: [], issueContext: new Map(), asOf: ASOF });
    assert.ok(readout.notes.harnessModelRows, 'the readout must ship the provenance note');
    assert.match(readout.notes.harnessModelRows, /opencode/i);
    assert.match(readout.notes.harnessModelRows, /never the dispatch row/i);
  });
});
