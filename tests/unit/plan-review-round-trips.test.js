/**
 * Unit tests for lib/plan-review-round-trips.js (LIN-1883 Session 1 — v3).
 *
 * The pure half of the plan-review round-trips instrument: the "before"
 * number LIN-1871's template fix is judged against. `scripts/plan-review-
 * round-trips.mjs` owns the network read; nothing here touches it.
 *
 * Several fixtures below are modeled directly on the real record cited by
 * LIN-1883's Implementation Plan (v3) and its approving plan-review verdict
 * (`b44b782f`) — the five extraction surface forms, the LIN-1714-shaped
 * directional-bias regression, and the LIN-1408 abort-skip sequence
 * (`plan-review(50960260, aborted) → plan → plan-review(70eac018, done)`,
 * independently confirmed live against the real dispatch record while writing
 * this suite).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVerdict, computeIssueRoundTrips, computePlanReviewRoundTrips,
  derivePrimaryFloor, MIN_DENOMINATOR, __internal,
} from '../../lib/plan-review-round-trips.js';

const ASOF = '2026-08-09T12:00:00.000Z';

// ─── fixture builders ────────────────────────────────────────────────────────

function row(id, kind, status, dispatchedAt, completedAt = null, feedback = undefined) {
  const r = { id, kind, status, dispatchedAt, completedAt };
  if (feedback !== undefined) r.feedback = feedback;
  return r;
}

function comment(id, body, createdAt) {
  return { id, body, createdAt };
}

function feedbackDone(message, timestamp) {
  return [{ message, timestamp }];
}

function issue(id, { description = '', comments = [], rows = [] } = {}) {
  return { id, identifier: `LIN-${id}`, description, comments, rows };
}

// ─── extractVerdict — the five measured surface forms (G1) ──────────────────

describe('extractVerdict — surface forms', () => {
  test('label+value bolded together: **Verdict: Request Changes**', () => {
    assert.equal(extractVerdict('**Verdict: Request Changes** — hand back to plan.'), 'request changes');
  });

  test('bold value under a header, trailing period inside the bold', () => {
    const text = '### Plan Review Verdict\n\n**Request Changes.** — the fold\'s structure is sound.';
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('heading form with a backtick value', () => {
    const text = '### Verdict: `Request Changes`\n\nSee findings below.';
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('fenced code block, no bold at all', () => {
    const text = 'Summary:\n```\nVerdict: Request Changes\n```\n';
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('DONE-line form: the value PRECEDES the word "verdict" (bidirectional window)', () => {
    const text = 'DONE: Plan review complete and verified — Request Changes verdict posted as Linear comment `27deb244` (HTTP 201).';
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('a forward-only window would miss the value-precedes-label form', () => {
    // Pin the reason the window is bidirectional, not forward-only: strip
    // everything AFTER the anchor and confirm the token still resolves only
    // because it is captured by the backward half of the window.
    const text = 'Request Changes verdict';
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('no anchor at all → null, no unanchored fallback', () => {
    assert.equal(extractVerdict('This plan looks solid and is approved on its merits.'), null);
  });

  test('empty/non-string input → null', () => {
    assert.equal(extractVerdict(''), null);
    assert.equal(extractVerdict(null), null);
    assert.equal(extractVerdict(undefined), null);
  });
});

// ─── G1 — directional-bias regression ────────────────────────────────────────

describe('extractVerdict — directional-bias regression', () => {
  test('remediation prose ("...is **approved** on its merits") with no nearby verdict anchor does not resolve, and a real verdict elsewhere still wins', () => {
    const text = [
      'Layer 1 is **approved** on its merits — none of them changes the **approved** mechanism.',
      '',
      'Elsewhere in this review:',
      '',
      '**Verdict: Request Changes** — see findings 1-3.',
    ].join('\n');
    assert.equal(extractVerdict(text), 'request changes');
  });

  test('"**Verdict: Approved**" does not resolve — \\bapprove\\b does not match "Approved" (trailing -d breaks the word boundary)', () => {
    assert.equal(extractVerdict('**Verdict: Approved** — proceed.'), null);
  });

  test('"approves"/"approved" alone, anywhere, never resolves as a token', () => {
    assert.equal(extractVerdict('The verdict here is that everyone approved this already.'), null);
  });
});

// ─── computeIssueRoundTrips — R0 eligibility walk (G2) ───────────────────────

describe('computeIssueRoundTrips — R0 eligibility (extraction-first, state-second)', () => {
  test('LIN-1408-shaped: abort is skipped, R0 settles on the next resolving row, roundTrips=2', () => {
    // Mirrors the real live sequence: plan-review(aborted) → plan →
    // plan-review(done, resolves) → plan → plan-review(done).
    const iss = issue('1408', {
      rows: [
        row('50960260', 'plan-review', 'aborted', '2026-08-02T22:51:14.958Z', '2026-08-02T22:52:19.373Z',
          feedbackDone('[aborted] Cancelled running session 414ca37c (EXECUTING).', '2026-08-02T22:52:19.373Z')),
        row('8627353e', 'plan', 'done', '2026-08-02T22:52:05.863Z', '2026-08-02T22:59:39.348Z'),
        row('70eac018', 'plan-review', 'done', '2026-08-02T23:00:48.086Z', '2026-08-02T23:08:05.046Z',
          feedbackDone('DONE: Plan review complete and verified — Request Changes verdict posted as Linear comment `27deb244`.', '2026-08-02T23:08:03.775Z')),
        row('1acc202d', 'plan', 'done', '2026-08-02T23:08:53.500Z', '2026-08-02T23:21:10.596Z'),
        row('6faad2c8', 'plan-review', 'done', '2026-08-02T23:21:58.799Z', '2026-08-02T23:32:57.908Z'),
      ],
      comments: [
        comment('27deb244', '### Plan Review Verdict\n\n**Verdict: Request Changes** — hand back to `plan`.', '2026-08-02T23:07:40.360Z'),
      ],
    });

    const result = computeIssueRoundTrips(iss, { asOf: ASOF });

    assert.equal(result.R0.row.id, '70eac018', 'R0 must not land on the aborted row');
    assert.equal(result.R0.verdict, 'request changes');
    assert.equal(result.R0.tier, 'a');
    assert.equal(result.R0.resolved, true);
    assert.equal(result.R0.rightCensored, false);
    assert.equal(result.diagnostics.noGenuineAttempt, 1);
    assert.deepEqual(result.diagnostics.noGenuineAttemptRowIds, ['50960260']);
    assert.equal(result.roundTrips, 2);
    assert.equal(result.lineageBleed, false);
  });

  for (const status of ['cancelled', 'canceled', 'expired', 'aborted', 'failed']) {
    test(`all-rows-${status}: issue excluded via noGenuineAttemptIssues, distinct from right-censoring`, () => {
      const iss = issue(`allskip-${status}`, {
        rows: [
          row('r1', 'plan-review', status, '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'),
          row('r2', 'plan-review', status, '2026-08-01T01:00:00.000Z', '2026-08-01T01:05:00.000Z'),
        ],
      });
      const result = computeIssueRoundTrips(iss, { asOf: ASOF });
      assert.equal(result.R0, null);
      assert.equal(result.diagnostics.noGenuineAttempt, 2);
      assert.equal(result.reachedPlanReviewAny, false);

      const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
      assert.equal(agg.diagnostics.noGenuineAttemptIssues, 1);
      assert.equal(agg.primary.denominator, 0);
    });
  }

  test('still-in-flight row (taken, completedAt null, no next row) retains right-censoring, not noGenuineAttempt', () => {
    const iss = issue('inflight', {
      rows: [
        row('r1', 'plan-review', 'taken', '2026-08-09T10:00:00.000Z', null),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.rightCensored, true);
    assert.equal(result.R0.resolved, false);
    assert.equal(result.diagnostics.noGenuineAttempt, 0);

    const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
    assert.equal(agg.diagnostics.rightCensoredFirstPass, 1);
    assert.equal(agg.diagnostics.noGenuineAttemptIssues, 0);
    assert.equal(agg.primary.denominator, 0, 'right-censored rows are excluded from the primary denominator');
  });

  test('queued row (not yet taken) is also right-censored, not skipped', () => {
    const iss = issue('queued', {
      rows: [row('r1', 'plan-review', 'queued', '2026-08-09T10:00:00.000Z', null)],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.rightCensored, true);
    assert.equal(result.diagnostics.noGenuineAttempt, 0);
  });

  test('done row with no next row and no resolvable text falls to tier C, which is null with no next row → reachedButUnresolvedFirstPass', () => {
    const iss = issue('unresolved', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z')],
      comments: [],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.resolved, false);
    assert.equal(result.R0.tier, null);

    const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
    assert.equal(agg.diagnostics.reachedButUnresolvedFirstPass, 1);
    assert.equal(agg.primary.denominator, 0);
  });

  test('done row with no resolvable text but a next `plan` row falls to tier C ⇒ "request changes"', () => {
    const iss = issue('structural-rc', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z'),
        row('r2', 'plan', 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.tier, 'c');
    assert.equal(result.R0.verdict, 'request changes');
    assert.equal(result.R0.resolved, true);
  });

  test('done row with no resolvable text but a next non-plan row falls to tier C ⇒ "approve"', () => {
    const iss = issue('structural-approve', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z'),
        row('r2', 'implementation', 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.tier, 'c');
    assert.equal(result.R0.verdict, 'approve');
  });
});

// ─── verdict precedence (tier A > tier B), window bound, lineageBleed ────────

describe('verdict tier precedence and the shared window bound', () => {
  test('tier A (comment) wins over tier B (DONE-line) when they disagree', () => {
    const iss = issue('precedence', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z',
          feedbackDone('DONE: Verdict: Approve — proceed.', '2026-08-09T10:05:00.000Z')),
      ],
      comments: [
        comment('c1', '**Verdict: Request Changes** — see findings.', '2026-08-09T10:02:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.tier, 'a');
    assert.equal(result.R0.verdict, 'request changes');
    assert.equal(result.crossTierDisagreements.aVsB, 1);
  });

  test('most-recently-posted comment inside the window wins when more than one resolves', () => {
    const iss = issue('most-recent', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z'),
      ],
      comments: [
        comment('c1', '**Verdict: Approve** — early, superseded.', '2026-08-09T10:05:00.000Z'),
        comment('c2', '**Verdict: Request Changes** — later, wins.', '2026-08-09T10:15:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.verdict, 'request changes');
  });

  test('windowStart = row-own dispatchedAt: a comment BEFORE the row dispatched does not count', () => {
    const iss = issue('before-window', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z'),
      ],
      comments: [
        comment('c0', '**Verdict: Approve** — stale, from a PRIOR row.', '2026-08-09T09:00:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.resolved, false, 'the out-of-window comment must not resolve tier A');
  });

  test('windowEnd = next pipeline row dispatchedAt (any kind), not just the next plan-review row', () => {
    const iss = issue('window-end-any-kind', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z'),
        row('r2', 'plan', 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
      comments: [
        // Posted AFTER r2 dispatched — outside r1's window (which ends at r2.dispatchedAt).
        comment('c1', '**Verdict: Approve** — too late for r1\'s window.', '2026-08-09T10:12:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    // Falls through to tier C since the comment is out of window and there's no DONE line.
    assert.equal(result.R0.tier, 'c');
    assert.equal(result.R0.verdict, 'request changes'); // next row is `plan`
  });

  test('orchestration rows (wake/autopilot) are excluded from the pipeline sequence entirely', () => {
    const iss = issue('orchestration-transparent', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z'),
        row('wake1', 'wake', 'done', '2026-08-09T10:05:00.000Z', '2026-08-09T10:05:30.000Z'),
        row('r2', 'plan', 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    // windowEnd for r1 should be r2's dispatchedAt (10:10), skipping the wake row.
    assert.equal(result.R0.windowEnd, '2026-08-09T10:10:00.000Z');
  });

  test('lineageBleed fires when R0 completedAt postdates the next pipeline row dispatchedAt', () => {
    const iss = issue('bleed', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-09T10:30:00.000Z')),
        // Next pipeline row dispatched BEFORE r1's (lineage-merged) completedAt.
        row('r2', 'plan', 'done', '2026-08-09T10:15:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.lineageBleed, true);
  });

  test('lineageBleed is never evaluated on a skipped (noGenuineAttempt) row', () => {
    const iss = issue('bleed-skip', {
      rows: [
        row('r1', 'plan-review', 'aborted', '2026-08-09T10:00:00.000Z', '2026-08-09T10:30:00.000Z'),
        row('r2', 'plan', 'done', '2026-08-09T10:05:00.000Z', '2026-08-09T10:10:00.000Z'),
        row('r3', 'plan-review', 'done', '2026-08-09T10:15:00.000Z', '2026-08-09T10:20:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-09T10:20:00.000Z')),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.row.id, 'r3');
    // r1's completedAt (10:30) postdates r2's dispatchedAt (10:05), which WOULD
    // be a bleed if evaluated — but r1 was skipped, so lineageBleed reflects
    // only R0 (r3), which has no bleed.
    assert.equal(result.lineageBleed, false);
  });
});

// ─── gate-due / gate-honoured (unconditioned series) ─────────────────────────

describe('gate-due / gate-honoured', () => {
  test('gateDue requires BOTH a plan dispatch and the description marker; gateHonoured additionally requires reaching plan-review', () => {
    const gateDueAndHonoured = issue('gate-1', {
      description: 'plan-review due: yes — (a) needs multiple sessions.',
      rows: [
        row('p1', 'plan', 'done', '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z'),
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-09T10:05:00.000Z')),
      ],
    });
    const r1 = computeIssueRoundTrips(gateDueAndHonoured, { asOf: ASOF });
    assert.equal(r1.gateDue, true);
    assert.equal(r1.gateHonoured, true);

    const gateDueNotHonoured = issue('gate-2', {
      description: 'plan-review due: yes — (a) needs multiple sessions.',
      rows: [
        row('p1', 'plan', 'done', '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z'),
        // Gate declared due, but the only plan-review row never attempted.
        row('r1', 'plan-review', 'cancelled', '2026-08-09T10:00:00.000Z', '2026-08-09T10:01:00.000Z'),
      ],
    });
    const r2 = computeIssueRoundTrips(gateDueNotHonoured, { asOf: ASOF });
    assert.equal(r2.gateDue, true);
    assert.equal(r2.gateHonoured, false);

    const noGateMarker = issue('gate-3', {
      description: 'plan-review due: no — none of (a)-(d).',
      rows: [row('p1', 'plan', 'done', '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z')],
    });
    const r3 = computeIssueRoundTrips(noGateMarker, { asOf: ASOF });
    assert.equal(r3.gateDue, false);

    const noPlanDispatch = issue('gate-4', {
      description: 'plan-review due: yes — (c) relaxes a guard.',
      rows: [row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z')],
    });
    const r4 = computeIssueRoundTrips(noPlanDispatch, { asOf: ASOF });
    assert.equal(r4.gateDue, false, 'gateDue requires a plan dispatch even when the marker is present');
  });

  test('the marker is scoped to the description only, not comments', () => {
    const iss = issue('gate-comment-only', {
      description: 'No marker here.',
      comments: [comment('c1', 'plan-review due: yes — mentioned only in a comment.', '2026-08-09T09:00:00.000Z')],
      rows: [row('p1', 'plan', 'done', '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z')],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.gateDue, false);
  });
});

// ─── aggregate: computePlanReviewRoundTrips ──────────────────────────────────

describe('computePlanReviewRoundTrips — aggregate', () => {
  test('required asOf throws when missing or unparseable', () => {
    assert.throws(() => computePlanReviewRoundTrips([], {}), /asOf must be a parseable ISO instant/);
    assert.throws(() => computePlanReviewRoundTrips([], { asOf: 'not-a-date' }), /asOf must be a parseable ISO instant/);
  });

  test('primary numerator/denominator aggregate across issues, excluding the three separately-countable buckets', () => {
    const approved = issue('a1', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
        feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:05:00.000Z'))],
    });
    const requestChanges = issue('a2', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
        feedbackDone('DONE: Verdict: Request Changes.', '2026-08-01T00:05:00.000Z'))],
    });
    const rightCensored = issue('a3', {
      rows: [row('r1', 'plan-review', 'taken', '2026-08-01T00:00:00.000Z', null)],
    });
    const noAttempt = issue('a4', {
      rows: [row('r1', 'plan-review', 'aborted', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z')],
    });

    const agg = computePlanReviewRoundTrips([approved, requestChanges, rightCensored, noAttempt], { asOf: ASOF });

    assert.equal(agg.primary.numerator, 1);
    assert.equal(agg.primary.denominator, 2); // approved + requestChanges, both resolved
    assert.equal(agg.primary.rate, 0.5);
    assert.equal(agg.diagnostics.rightCensoredFirstPass, 1);
    assert.equal(agg.diagnostics.noGenuineAttemptIssues, 1);
    assert.equal(agg.scale.issuesRead, 4);
  });

  test('round-trip distribution and mean', () => {
    const zero = issue('rt0', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
        feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:05:00.000Z'))],
    });
    const two = issue('rt2', {
      rows: [
        row('r1', 'plan-review', 'aborted', '2026-08-02T22:51:14.958Z', '2026-08-02T22:52:19.373Z'),
        row('r2', 'plan', 'done', '2026-08-02T22:52:05.863Z', '2026-08-02T22:59:39.348Z'),
        row('r3', 'plan-review', 'done', '2026-08-02T23:00:48.086Z', '2026-08-02T23:08:05.046Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-02T23:08:03.775Z')),
        row('r4', 'plan', 'done', '2026-08-02T23:08:53.500Z', '2026-08-02T23:21:10.596Z'),
        row('r5', 'plan-review', 'done', '2026-08-02T23:21:58.799Z', '2026-08-02T23:32:57.908Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-02T23:32:57.908Z')),
      ],
    });

    const agg = computePlanReviewRoundTrips([zero, two], { asOf: ASOF });
    assert.deepEqual(agg.roundTrips.distribution, { 0: 1, 2: 1 });
    assert.equal(agg.roundTrips.mean, 1);
    assert.equal(agg.roundTrips.n, 2);
  });

  test('gate-due / gate-honoured rates aggregate, with the MIN_DENOMINATOR floor', () => {
    const issues = [];
    for (let i = 0; i < MIN_DENOMINATOR - 1; i++) {
      issues.push(issue(`gd${i}`, {
        description: 'plan-review due: yes.',
        rows: [
          row('p1', 'plan', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'),
          row('r1', 'plan-review', 'done', '2026-08-01T00:10:00.000Z', '2026-08-01T00:15:00.000Z',
            feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:15:00.000Z')),
        ],
      }));
    }
    const under = computePlanReviewRoundTrips(issues, { asOf: ASOF });
    assert.equal(under.gate.due, MIN_DENOMINATOR - 1);
    assert.equal(under.gate.sufficient, false);

    issues.push(issue('gdN', {
      description: 'plan-review due: yes.',
      rows: [
        row('p1', 'plan', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'),
        row('r1', 'plan-review', 'done', '2026-08-01T00:10:00.000Z', '2026-08-01T00:15:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:15:00.000Z')),
      ],
    }));
    const atFloor = computePlanReviewRoundTrips(issues, { asOf: ASOF });
    assert.equal(atFloor.gate.due, MIN_DENOMINATOR);
    assert.equal(atFloor.gate.sufficient, true);
    assert.equal(atFloor.gate.honouredRate, 1);
  });

  test('rulerContamination flags R0 rows whose window straddles the ruler change instant', () => {
    const straddles = issue('ruler-straddle', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'),
        row('r2', 'plan', 'done', '2026-08-03T00:00:00.000Z', '2026-08-03T00:05:00.000Z'),
      ],
    });
    const notStraddling = issue('ruler-clean', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-05T00:00:00.000Z', '2026-08-05T00:05:00.000Z'),
        row('r2', 'plan', 'done', '2026-08-06T00:00:00.000Z', '2026-08-06T00:05:00.000Z'),
      ],
    });
    const agg = computePlanReviewRoundTrips([straddles, notStraddling], {
      asOf: ASOF, rulerChangeAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(agg.diagnostics.rulerContamination, 1);
  });

  test('rulerContamination is omitted from diagnostics when no rulerChangeAt is supplied', () => {
    const agg = computePlanReviewRoundTrips([], { asOf: ASOF });
    assert.equal('rulerContamination' in agg.diagnostics, false);
  });

  test('perIssue exposes the R0 resolution for validation against a real record', () => {
    const iss = issue('LIN-1408-shape', {
      rows: [
        row('50960260', 'plan-review', 'aborted', '2026-08-02T22:51:14.958Z', '2026-08-02T22:52:19.373Z'),
        row('8627353e', 'plan', 'done', '2026-08-02T22:52:05.863Z', '2026-08-02T22:59:39.348Z'),
        row('70eac018', 'plan-review', 'done', '2026-08-02T23:00:48.086Z', '2026-08-02T23:08:05.046Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-02T23:08:03.775Z')),
      ],
    });
    const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
    assert.equal(agg.perIssue.length, 1);
    assert.equal(agg.perIssue[0].R0.rowId, '70eac018');
    assert.equal(agg.perIssue[0].noGenuineAttemptRowIds[0], '50960260');
  });
});

// ─── sufficiency floor derivation ────────────────────────────────────────────

describe('derivePrimaryFloor', () => {
  test('returns null at the boundary (p1 undefined, 0, or 1)', () => {
    assert.equal(derivePrimaryFloor(null), null);
    assert.equal(derivePrimaryFloor(0), null);
    assert.equal(derivePrimaryFloor(1), null);
  });

  test('derives a positive required N and numerator floor from a measured p1', () => {
    const floor = derivePrimaryFloor(0.19);
    assert.ok(floor.requiredN > 0);
    assert.ok(floor.requiredNumerator > 0);
    assert.equal(floor.p1, 0.19);
    assert.ok(floor.requiredNumerator <= floor.requiredN);
  });
});

// ─── __internal sanity (mirrors follow-on-ratio.test.js's pattern) ──────────

describe('__internal', () => {
  test('pipelineRowsOf drops orchestration kinds and sorts by dispatchedAt', () => {
    const rows = [
      row('b', 'plan', 'done', '2026-08-01T00:10:00.000Z', '2026-08-01T00:15:00.000Z'),
      row('wake', 'wake', 'done', '2026-08-01T00:05:00.000Z', '2026-08-01T00:05:30.000Z'),
      row('a', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z'),
    ];
    const sorted = __internal.pipelineRowsOf({ rows });
    assert.deepEqual(sorted.map((r) => r.id), ['a', 'b']);
  });
});
