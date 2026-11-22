/**
 * LIN-4519 (slice 3, P6): the plan-review and code-review round trips read verdict RECORDS, not comments.
 *
 * Witnesses (each red on the comments reader, which these tests pin against by contrast):
 *   - a gate verdict is the verdict record of the gate's judgement written inside the row's window; the latest wins, a
 *     withdrawn one is excluded, and the outcome words are the comment vocabulary (request changes, needs discussion);
 *   - a comment that says "Verdict: approve" with no record reads no verdict: the text is not read in records mode;
 *   - a gate row dispatched before the cutover is not measured (the issue is counted apart, never in the no-attempt or
 *     unresolved buckets, never a structural guess), while a row the status settles (no attempt, in flight) still is;
 *   - after the cutover, a done row with no verdict record settles on the structural tier, as the comment reader did;
 *   - the aggregate counts the not-measured issues, and the configured coverage instant is what decides;
 *   - the comments source stays available for the historic reproduction, and its output is unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIssueRoundTrips, computePlanReviewRoundTrips, recordVerdictOf,
} from '../../lib/plan-review-round-trips.js';
import { VERDICT_RECORDS_SINCE } from '../../lib/records/verdict-facts.js';

const ASOF = '2026-11-30T12:00:00.000Z';
const EPOCH = '1970-01-01T00:00:00.000Z';

function row(id, kind, status, dispatchedAt, completedAt = null, feedback = undefined) {
  return { id, kind, status, dispatchedAt, completedAt, ...(feedback !== undefined ? { feedback } : {}) };
}
const verdict = (id, judgement, outcome, at, extra = {}) => ({ id, judgement, outcome, at, state: 'stands', in: 'task-1', on: [], ...extra });

// A plan review dispatched after the cutover, then an implementation: the plan-review row settles on its record.
const LATE_REVIEW_ROWS = [
  row('p1', 'plan', 'done', '2026-11-25T00:00:00.000Z', '2026-11-25T00:30:00.000Z'),
  row('pr1', 'plan-review', 'done', '2026-11-25T01:00:00.000Z', '2026-11-25T01:20:00.000Z'),
  row('p2', 'plan', 'done', '2026-11-25T02:00:00.000Z', '2026-11-25T02:30:00.000Z'),
  row('pr2', 'plan-review', 'done', '2026-11-25T03:00:00.000Z', '2026-11-25T03:20:00.000Z'),
];
const issue = (rows, verdicts, extra = {}) => ({ id: 'issue-1', identifier: 'LIN-1', comments: [], rows, verdicts, ...extra });
const facts = (verdicts, identifier = 'LIN-1') => new Map([[identifier, { measured: true, taskId: 'task-1', verdicts }]]);

describe('recordVerdictOf: the verdict a window settles on', () => {
  const views = [
    verdict('a', 'plan-review', 'approve', '2026-11-25T01:05:00.000Z'),
    verdict('b', 'plan-review', 'request-changes', '2026-11-25T01:10:00.000Z'),
    verdict('c', 'plan-review', 'needs-discussion', '2026-11-25T01:15:00.000Z', { state: 'withdrawn' }),
    verdict('d', 'review', 'approve', '2026-11-25T01:12:00.000Z'),
    verdict('e', 'plan-review', 'approve', '2026-11-25T01:20:00.000Z'),
  ];
  const q = { judgement: 'plan-review', windowStart: '2026-11-25T01:00:00.000Z', windowEnd: '2026-11-25T01:20:00.000Z' };

  test('the latest of its judgement inside the half-open window, withdrawn excluded, outcome in the comment vocabulary', () => {
    assert.equal(recordVerdictOf(views, q), 'request changes', 'b is the latest inside; e is at the end, so out; c is withdrawn; d is a review');
    assert.equal(recordVerdictOf(views, { ...q, judgement: 'review' }), 'approve');
    assert.equal(recordVerdictOf(views, { ...q, windowStart: '2026-11-26T00:00:00.000Z', windowEnd: '2026-11-27T00:00:00.000Z' }), null, 'no verdict in the window');
    assert.equal(recordVerdictOf(views, { ...q, windowStart: 'not-a-date' }), null, 'a junk window bound reads nothing');
  });

  test('a needs-discussion verdict reads as the words the comment extractor used', () => {
    const only = [verdict('x', 'plan-review', 'needs-discussion', '2026-11-25T01:05:00.000Z')];
    assert.equal(recordVerdictOf(only, q), 'needs discussion');
  });
});

describe('a gate row settles on its verdict record', () => {
  test('an approve record in the plan-review window is the R0 verdict, from tier a, and the text is not read', () => {
    const iss = issue(LATE_REVIEW_ROWS, [verdict('v1', 'plan-review', 'approve', '2026-11-25T01:05:00.000Z')]);
    const r = computeIssueRoundTrips(iss, { asOf: ASOF, verdictFacts: facts([verdict('v1', 'plan-review', 'approve', '2026-11-25T01:05:00.000Z')]) });
    assert.equal(r.R0.row.id, 'pr1');
    assert.equal(r.R0.verdict, 'approve');
    assert.equal(r.R0.tier, 'a');
    assert.equal(r.R0.resolved, true);
    assert.equal(r.verdictNotMeasured, null);
  });

  test('a comment that says "Verdict: approve" with no record reads no verdict in records mode (red on the comment reader)', () => {
    const iss = { ...issue(LATE_REVIEW_ROWS, undefined), comments: [{ id: 'c1', body: 'Verdict: approve', createdAt: '2026-11-25T01:05:00.000Z' }] };
    const r = computeIssueRoundTrips(iss, { asOf: ASOF, verdictFacts: facts([]) });
    assert.notEqual(r.R0?.tier, 'a', 'no tier-a verdict: the comment is not read');
    assert.equal(r.R0?.tier, 'c', 'a done row with no verdict record settles on the structural tier, as it always did');
    const commentsReading = computeIssueRoundTrips(iss, { asOf: ASOF, verdictSource: 'comments' });
    assert.equal(commentsReading.R0.tier, 'a', 'the comments source (historic) reads the same comment as tier a');
  });

  test('the latest verdict of the window wins, and a withdrawn one does not count', () => {
    const vs = [
      verdict('early', 'plan-review', 'request-changes', '2026-11-25T01:02:00.000Z'),
      verdict('late', 'plan-review', 'approve', '2026-11-25T01:15:00.000Z'),
      verdict('gone', 'plan-review', 'request-changes', '2026-11-25T01:16:00.000Z', { state: 'withdrawn' }),
    ];
    const r = computeIssueRoundTrips(issue(LATE_REVIEW_ROWS, vs), { asOf: ASOF, verdictFacts: facts(vs) });
    assert.equal(r.R0.verdict, 'approve');
  });
});

describe('the cutover: a gate row before the verdict records is not measured, never guessed', () => {
  const EARLY_ROWS = [
    row('p1', 'plan', 'done', '2026-11-10T00:00:00.000Z', '2026-11-10T00:30:00.000Z'),
    row('pr1', 'plan-review', 'done', '2026-11-10T01:00:00.000Z', '2026-11-10T01:20:00.000Z'),
    row('p2', 'plan', 'done', '2026-11-10T02:00:00.000Z', '2026-11-10T02:30:00.000Z'),
  ];

  test('a done gate row before the cutover is not measured: the issue carries the reason and no R0', () => {
    const vs = [verdict('old', 'plan-review', 'approve', '2026-11-10T01:05:00.000Z')];
    const r = computeIssueRoundTrips(issue(EARLY_ROWS, vs), { asOf: ASOF, verdictFacts: facts(vs) });
    assert.equal(r.R0, null);
    assert.match(r.verdictNotMeasured, /dispatched before the verdict records \(2026-11-22T04:20Z\)/);
    assert.equal(r.reachedPlanReviewAny, false, 'not reached: its verdict is unknown, so it is out of the round-trip series');
  });

  test('the aggregate counts it apart from no-attempt and unresolved, and out of the primary', () => {
    const vs = [verdict('old', 'plan-review', 'approve', '2026-11-10T01:05:00.000Z')];
    const agg = computePlanReviewRoundTrips([issue(EARLY_ROWS, vs), issue(LATE_REVIEW_ROWS, [verdict('v1', 'plan-review', 'approve', '2026-11-25T01:05:00.000Z')], { id: 'issue-2', identifier: 'LIN-2' })],
      { asOf: ASOF, verdictFacts: new Map([...facts(vs, 'LIN-1'), ...facts([verdict('v1', 'plan-review', 'approve', '2026-11-25T01:05:00.000Z')], 'LIN-2')]) });
    assert.equal(agg.diagnostics.verdictNotMeasured, 1);
    assert.equal(agg.diagnostics.noGenuineAttemptIssues, 0, 'not counted as no attempt');
    assert.equal(agg.diagnostics.reachedButUnresolvedFirstPass, 0, 'nor as unresolved');
    assert.equal(agg.primary.denominator, 1, 'only the measured issue is in the primary');
    assert.equal(agg.primary.numerator, 1);
    assert.equal(agg.scale.issuesRead, 2);
    assert.equal(agg.window.verdictSource, 'records');
    assert.equal(agg.window.verdictRecordsSince, VERDICT_RECORDS_SINCE);
    assert.match(agg.definition.verdictExtraction, /is not measured/);
  });

  test('a no-attempt row before the cutover is still skipped by its status, not counted as not measured', () => {
    const rows = [
      row('p1', 'plan', 'done', '2026-11-10T00:00:00.000Z', '2026-11-10T00:30:00.000Z'),
      row('pr1', 'plan-review', 'failed', '2026-11-10T01:00:00.000Z', '2026-11-10T01:05:00.000Z'),
    ];
    const r = computeIssueRoundTrips(issue(rows, []), { asOf: ASOF, verdictFacts: facts([]) });
    assert.equal(r.verdictNotMeasured, null, 'the status decides, as it did before');
    assert.equal(r.diagnostics.noGenuineAttempt, 1);
    assert.equal(r.R0, null);
  });

  test('an in-flight gate row before the cutover is right-censored by its status, not not-measured', () => {
    const rows = [
      row('p1', 'plan', 'done', '2026-11-10T00:00:00.000Z', '2026-11-10T00:30:00.000Z'),
      row('pr1', 'plan-review', 'queued', '2026-11-10T01:00:00.000Z', null),
    ];
    const r = computeIssueRoundTrips(issue(rows, []), { asOf: ASOF, verdictFacts: facts([]) });
    assert.equal(r.verdictNotMeasured, null);
    assert.equal(r.R0.rightCensored, true);
  });

  test('the coverage instant is the test seam: an epoch covers every row, a null covers none', () => {
    const vs = [verdict('old', 'plan-review', 'approve', '2026-11-10T01:05:00.000Z')];
    const covered = computeIssueRoundTrips(issue(EARLY_ROWS, vs), { asOf: ASOF, verdictFacts: facts(vs), verdictRecordsSince: EPOCH });
    assert.equal(covered.R0.verdict, 'approve');
    const none = computeIssueRoundTrips(issue(EARLY_ROWS, vs), { asOf: ASOF, verdictFacts: facts(vs), verdictRecordsSince: null });
    assert.equal(none.R0, null);
    assert.match(none.verdictNotMeasured, /dispatched before/);
  });

  test('a ticket the records never read is not measured, with the reason; an unmeasured facts reading says why', () => {
    const r1 = computeIssueRoundTrips(issue(LATE_REVIEW_ROWS, []), { asOf: ASOF, verdictFacts: new Map() });
    assert.match(r1.verdictNotMeasured, /no verdict records were read for this ticket/);
    const r2 = computeIssueRoundTrips(issue(LATE_REVIEW_ROWS, []), { asOf: ASOF, verdictFacts: new Map([['LIN-1', { measured: false, reason: 'db down' }]]) });
    assert.equal(r2.verdictNotMeasured, 'db down');
  });
});

describe('the review gate reads the review judgement', () => {
  test('a review verdict settles the review gate; a plan-review verdict does not', () => {
    const rows = [
      row('i1', 'implementation', 'done', '2026-11-25T02:00:00.000Z', '2026-11-25T02:30:00.000Z'),
      row('r1', 'review', 'done', '2026-11-25T03:00:00.000Z', '2026-11-25T03:20:00.000Z'),
    ];
    const vs = [verdict('pr', 'plan-review', 'request-changes', '2026-11-25T03:05:00.000Z'), verdict('rv', 'review', 'approve', '2026-11-25T03:10:00.000Z')];
    const r = computeIssueRoundTrips(issue(rows, vs), { asOf: ASOF, gateKind: 'review', rePassKind: 'implementation', verdictFacts: facts(vs) });
    assert.equal(r.R0.row.id, 'r1');
    assert.equal(r.R0.verdict, 'approve');
    assert.equal(r.R0.tier, 'a');
  });
});

describe('the default is records; the comments source is the historic reproduction', () => {
  test('a computation with no verdictSource reads records', () => {
    const r = computePlanReviewRoundTrips([issue(LATE_REVIEW_ROWS, [], { comments: [{ id: 'c1', body: 'Verdict: approve', createdAt: '2026-11-25T01:05:00.000Z' }] })], { asOf: ASOF, verdictFacts: facts([]) });
    assert.equal(r.window.verdictSource, 'records');
    assert.equal(r.perIssue[0].R0.tier, 'c', 'the comment is not read');
  });

  test('the comments source reads the comment trail as before', () => {
    const iss = issue(LATE_REVIEW_ROWS, [], { comments: [{ id: 'c1', body: 'Verdict: request changes', createdAt: '2026-11-25T01:05:00.000Z' }] });
    const r = computePlanReviewRoundTrips([iss], { asOf: ASOF, verdictSource: 'comments' });
    assert.equal(r.window.verdictSource, 'comments');
    assert.equal(r.window.verdictRecordsSince, null);
    assert.equal(r.perIssue[0].R0.verdict, 'request changes');
    assert.equal(r.perIssue[0].R0.tier, 'a');
  });
});
