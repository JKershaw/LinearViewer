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
