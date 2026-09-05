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
import { __internal as followOnRatioInternal } from '../../lib/follow-on-ratio.js';

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

  test('LIN-2037 item 2: a noGenuineAttempt row is excluded from verdictTier even though its structural tier C would resolve non-null', () => {
    // aborted row's nextRow is a `plan` row, so tier C WOULD resolve to
    // 'request changes' if this row's tally were counted — pinning that it
    // is not, since the row never settled anything (it was skipped, and R0
    // settles two rows later on the DONE-line tier-B resolution instead).
    const iss = issue('verdict-tier-skip', {
      rows: [
        row('aborted-row', 'plan-review', 'aborted', '2026-08-09T10:00:00.000Z', '2026-08-09T10:01:00.000Z'),
        row('next', 'plan', 'done', '2026-08-09T10:05:00.000Z', '2026-08-09T10:10:00.000Z'),
        row('resolved-row', 'plan-review', 'done', '2026-08-09T10:15:00.000Z', '2026-08-09T10:20:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-09T10:20:00.000Z')),
      ],
    });

    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.diagnostics.noGenuineAttempt, 1);
    assert.equal(result.R0.row.id, 'resolved-row');
    assert.deepEqual(result.verdictTier, { a: 0, b: 1, c: 0, none: 0 },
      'the skipped aborted row must not tally into tier c, even though its structural tier would have resolved');

    const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
    assert.deepEqual(agg.diagnostics.verdictTier, { a: 0, b: 1, c: 0, none: 0 },
      'the aggregate total must also exclude the skipped row');
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

  // LIN-2079 S5. This module consumes the DERIVED status of the proxy list
  // endpoint (see its header + scripts/plan-review-round-trips.mjs, which copies
  // `status: item.status` straight off those items). Once `blocked` is derived
  // there, a plan-review row correctly parked on a human stops reporting `taken`
  // — and without 'blocked' in IN_FLIGHT_STATUSES it matches neither closed set,
  // falls through to the structural tier, and is silently scored as a SETTLED
  // attempt. Behaviour-preserving by construction: it keeps such a row censored
  // exactly the way it is censored today.
  test('blocked row (parked on a human) is right-censored like taken, NOT scored as a settled attempt', () => {
    const iss = issue('blocked', {
      rows: [row('r1', 'plan-review', 'blocked', '2026-08-09T10:00:00.000Z', null)],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF });
    assert.equal(result.R0.rightCensored, true, 'a parked row is still in flight, not resolved');
    assert.equal(result.R0.resolved, false);
    assert.equal(result.R0.tier, null, 'must NOT fall through to the structural tier');
    assert.equal(result.diagnostics.noGenuineAttempt, 0);

    const agg = computePlanReviewRoundTrips([iss], { asOf: ASOF });
    assert.equal(agg.diagnostics.rightCensoredFirstPass, 1);
    assert.equal(agg.primary.denominator, 0, 'right-censored rows stay out of the primary denominator');
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

// ─── computeIssueRoundTrips — asOf validation (LIN-2037 item 3) ─────────────

describe('computeIssueRoundTrips — required asOf', () => {
  test('required asOf throws when missing or unparseable, mirroring computePlanReviewRoundTrips', () => {
    const iss = issue('asof-missing', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z')],
    });
    assert.throws(() => computeIssueRoundTrips(iss, {}), /asOf must be a parseable ISO instant/);
    assert.throws(() => computeIssueRoundTrips(iss, { asOf: 'not-a-date' }), /asOf must be a parseable ISO instant/);
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

  test('LIN-2035 B1 regression: denominator=33, numerator=1 must NOT be sufficient (the pre-fix tautology declared this sufficient)', () => {
    const issues = [];
    // 1 approve.
    issues.push(issue('b1-approve', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
        feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:05:00.000Z'))],
    }));
    // 32 request-changes, bringing denominator to 33 with numerator 1 (p1 ≈ 0.03).
    for (let i = 0; i < 32; i++) {
      issues.push(issue(`b1-rc-${i}`, {
        rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-01T00:05:00.000Z'))],
      }));
    }
    const agg = computePlanReviewRoundTrips(issues, { asOf: ASOF });
    assert.equal(agg.primary.denominator, 33);
    assert.equal(agg.primary.numerator, 1);
    assert.equal(agg.primary.sufficient, false,
      'd=33,n=1 (p1≈0.03) must not be declared sufficient — the plan calls for n≈741 at this p1');
  });

  test('LIN-2035 B1 regression: p1=0 at a large denominator must not falsely claim there is no denominator', () => {
    const issues = [];
    for (let i = 0; i < 500; i++) {
      issues.push(issue(`b1-zero-${i}`, {
        rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-01T00:05:00.000Z'))],
      }));
    }
    const agg = computePlanReviewRoundTrips(issues, { asOf: ASOF });
    assert.equal(agg.primary.denominator, 500);
    assert.equal(agg.primary.numerator, 0);
    assert.equal(agg.primary.rate, 0);
    assert.equal(agg.primary.sufficient, false);
    assert.doesNotMatch(agg.definition.sufficiencyFormula, /no primary denominator/,
      'p1=0 with denominator=500 must not claim there is no denominator');
  });

  // ─── LIN-2036: continuous effect model + F3 conjunct drop, at aggregate level ───

  function verdictIssues(idPrefix, approveCount, requestChangesCount) {
    const issues = [];
    for (let i = 0; i < approveCount; i++) {
      issues.push(issue(`${idPrefix}-a${i}`, {
        rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:05:00.000Z'))],
      }));
    }
    for (let i = 0; i < requestChangesCount; i++) {
      issues.push(issue(`${idPrefix}-rc${i}`, {
        rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-01T00:05:00.000Z'))],
      }));
    }
    return issues;
  }

  test('LIN-2036 F2 regression: d=12, p1=0.5 must NOT be sufficient (the pre-fix code declared this sufficient at requiredN=11)', () => {
    const agg = computePlanReviewRoundTrips(verdictIssues('f2-12', 6, 6), { asOf: ASOF });
    assert.equal(agg.primary.denominator, 12);
    assert.equal(agg.primary.rate, 0.5);
    assert.equal(agg.primary.sufficient, false,
      'd=12,p1=0.5 (requiredN=58 under the continuous rule) must not be sufficient');
  });

  test('LIN-2036 F2 regression: d=20, p1=0.45 must NOT be sufficient (the pre-fix code declared this sufficient at requiredN=16)', () => {
    const agg = computePlanReviewRoundTrips(verdictIssues('f2-20', 9, 11), { asOf: ASOF });
    assert.equal(agg.primary.denominator, 20);
    assert.equal(agg.primary.rate, 0.45);
    assert.equal(agg.primary.sufficient, false,
      'd=20,p1=0.45 (requiredN=50 under the continuous rule) must not be sufficient');
  });

  test('LIN-2036 F3 pin: n=52, d=85 must be sufficient — the floating-point knife edge the dropped numerator conjunct got wrong', () => {
    const agg = computePlanReviewRoundTrips(verdictIssues('f3', 52, 33), { asOf: ASOF });
    assert.equal(agg.primary.denominator, 85);
    assert.equal(agg.primary.numerator, 52);
    assert.equal(agg.primary.sufficient, true,
      'requiredN(52/85) === 85 so the denominator check alone passes; the conjunct (dropped) used to flip this to false on a Math.ceil round-up of the requiredNumerator');
  });

  test('LIN-2036 F1: sufficiencyFormula reports the realised ratio, not the constant — 2.000× at p1=0.19, 1.333× (never 2×) at p1=0.6', () => {
    const low = computePlanReviewRoundTrips(verdictIssues('f1-low', 19, 81), { asOf: ASOF });
    assert.equal(low.definition.measuredP1, 0.19);
    assert.match(low.definition.sufficiencyFormula, /2\.000×/);
    assert.match(low.definition.sufficiencyFormula, /min\(/, 'must name the continuous min() rule');

    const high = computePlanReviewRoundTrips(verdictIssues('f1-high', 60, 40), { asOf: ASOF });
    assert.equal(high.definition.measuredP1, 0.6);
    assert.match(high.definition.sufficiencyFormula, /1\.333×/);
    assert.doesNotMatch(high.definition.sufficiencyFormula, /(?<!\d)2×/,
      'must not claim a 2× effect above p1=0.5, where the realised ratio is 1.333×');
    assert.match(high.definition.sufficiencyFormula, /min\(/, 'must name the continuous min() rule');
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

  test('LIN-2035 B2 regression: roundTrips distribution is conditioned on reachedPlanReviewAny, not diluted by issues that never reached plan-review', () => {
    // Reaches plan-review, resolves, zero round trips.
    const reached = issue('b2-reached', {
      rows: [row('r1', 'plan-review', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z',
        feedbackDone('DONE: Verdict: Approve.', '2026-08-01T00:05:00.000Z'))],
    });
    // Never dispatches a plan-review row at all — the workspace-shape bulk
    // the real read pass showed diluting the aggregate 45× (LIN-2035 B2).
    const neverReached = [];
    for (let i = 0; i < 20; i++) {
      neverReached.push(issue(`b2-never-${i}`, {
        rows: [row('p1', 'plan', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z')],
      }));
    }
    const agg = computePlanReviewRoundTrips([reached, ...neverReached], { asOf: ASOF });
    assert.equal(agg.scale.issuesRead, 21);
    assert.equal(agg.scale.reachedPlanReviewAny, 1);
    assert.equal(agg.roundTrips.n, 1, 'roundTrips.n must only count issues that reached plan-review');
    assert.deepEqual(agg.roundTrips.distribution, { 0: 1 });
    assert.equal(agg.roundTrips.mean, 0);
  });

  test('LIN-2037 item 4: an all-non-gate population (no issue reaches plan-review) pins mean=null, distribution={}', () => {
    const neverReached = [];
    for (let i = 0; i < 5; i++) {
      neverReached.push(issue(`f5-never-${i}`, {
        rows: [row('p1', 'plan', 'done', '2026-08-01T00:00:00.000Z', '2026-08-01T00:05:00.000Z')],
      }));
    }
    const agg = computePlanReviewRoundTrips(neverReached, { asOf: ASOF });
    assert.equal(agg.roundTrips.n, 0);
    assert.equal(agg.roundTrips.mean, null);
    assert.deepEqual(agg.roundTrips.distribution, {});
  });

  test('MIN_DENOMINATOR is single-sourced from follow-on-ratio.js\'s __internal bag, not re-declared (LIN-2037 item 1)', () => {
    assert.equal(MIN_DENOMINATOR, followOnRatioInternal.MIN_DENOMINATOR,
      'must be the SAME binding, not merely an equal-by-value local constant');
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

  test('LIN-1984: completeness is a top-level, advisory sibling of diagnostics', () => {
    const clean = computePlanReviewRoundTrips([issue('a1')], { asOf: ASOF });
    assert.deepEqual(clean.completeness, { attempted: 1, read: 1, skipped: 0, complete: true });

    const withSkips = computePlanReviewRoundTrips([issue('a1')], {
      asOf: ASOF, skipped: [{ id: 'x' }, { id: 'y' }],
    });
    assert.deepEqual(withSkips.completeness, { attempted: 3, read: 1, skipped: 2, complete: false });
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
  test('returns null only when there is no primary denominator at all (p1 === null)', () => {
    assert.equal(derivePrimaryFloor(null), null);
  });

  test('LIN-2035 B1: p1 ∈ {0, 1} is a REAL measured proportion, not a missing denominator — returns a finite, very demanding floor, never null', () => {
    const zero = derivePrimaryFloor(0);
    assert.ok(zero, 'p1=0 must not resolve to null (that reads as "no denominator" when one exists)');
    assert.ok(Number.isFinite(zero.requiredN) && zero.requiredN > 0);
    assert.ok(Number.isFinite(zero.requiredNumerator));

    const one = derivePrimaryFloor(1);
    assert.ok(one, 'p1=1 must not resolve to null');
    assert.ok(Number.isFinite(one.requiredN) && one.requiredN > 0);
    assert.ok(Number.isFinite(one.requiredNumerator));
  });

  test('derives a positive required N and numerator floor from a measured p1, via a two-proportion power calc (not a fixed constant)', () => {
    const floor = derivePrimaryFloor(0.19);
    assert.ok(floor.requiredN > 0);
    assert.ok(floor.requiredNumerator > 0);
    assert.equal(floor.p1, 0.19);
    assert.ok(floor.requiredNumerator <= floor.requiredN);
    // The plan's own worked example (LIN-1883 Plan v1 §9): 19%→38%, α=0.05,
    // power=0.80 ⇒ n≈85 per side. Pin the derivation to that neighborhood so
    // a regression back to a fixed constant (LIN-2035 B1) fails loudly.
    assert.ok(floor.requiredN >= 80 && floor.requiredN <= 100,
      `expected requiredN near the plan's n≈85, got ${floor.requiredN}`);
  });

  test('requiredN genuinely depends on p1 (not a constant like the pre-LIN-2035 formula)', () => {
    const low = derivePrimaryFloor(0.05);
    const high = derivePrimaryFloor(0.19);
    assert.notEqual(low.requiredN, high.requiredN);
  });

  // ─── LIN-2036: continuous min() effect model (replaces the p1=0.5 branch) ───

  test('LIN-2036 F2: derivePrimaryFloor(0.5).requiredN is at or above MIN_DENOMINATOR (the pre-fix code returned 11)', () => {
    assert.ok(derivePrimaryFloor(0.5).requiredN >= MIN_DENOMINATOR,
      `expected requiredN(0.5) >= ${MIN_DENOMINATOR}, got ${derivePrimaryFloor(0.5).requiredN}`);
  });

  test('LIN-2036 F2: no p1 in [0,1] yields a requiredN below MIN_DENOMINATOR (the pre-fix code violated this for p1 in ~[0.36, 0.5])', () => {
    for (let i = 0; i <= 1000; i++) {
      const p1 = i / 1000;
      const floor = derivePrimaryFloor(p1);
      assert.ok(floor.requiredN >= MIN_DENOMINATOR,
        `p1=${p1} produced requiredN=${floor.requiredN}, below MIN_DENOMINATOR=${MIN_DENOMINATOR}`);
    }
  });

  test('LIN-2036 F2: continuity at the p1=0.5 fork — requiredN(0.5) === requiredN(0.5001) (the pre-fix code jumped 11 -> 58)', () => {
    assert.equal(derivePrimaryFloor(0.5).requiredN, derivePrimaryFloor(0.5001).requiredN);
  });

  test('LIN-2036 F4: complement-branch coverage at p1 = 0.6, 0.8, 1.0 — p2 stays strictly inside (p1c, 1), requiredN is monotone', () => {
    const mid = derivePrimaryFloor(0.6);
    const higher = derivePrimaryFloor(0.8);
    const boundary = derivePrimaryFloor(1.0);

    // p1=0.6 and p1=0.8 are well clear of the SUFFICIENCY_MIN_P boundary, so
    // p1c === p1 there and `p2 > p1` is the p1c comparison. p1=1.0 is the one
    // case where p1c is clamped away from the raw p1 — the only invariant
    // that survives the clamp (and the one the retired `p2 ∈ (p1, 1)` witness
    // got wrong) is that p2 stays strictly below 1, never saturating back
    // onto 1 (which would reintroduce requiredN = Infinity).
    assert.ok(mid.p2 > 0.6 && mid.p2 < 1);
    assert.ok(higher.p2 > 0.8 && higher.p2 < 1);
    assert.ok(boundary.p2 < 1, 'p2 must never reach exactly 1, even at the p1=1 boundary');

    assert.ok(mid.requiredN < higher.requiredN && higher.requiredN < boundary.requiredN,
      `expected monotone requiredN, got ${mid.requiredN} < ${higher.requiredN} < ${boundary.requiredN}`);
  });

  test('LIN-2036 Decision 3: the accepted p1=1 boundary artifact renders 1.000× and stays finite, and is not special-cased away', () => {
    const floor = derivePrimaryFloor(1.0);
    assert.ok(Number.isFinite(floor.requiredN));
    assert.equal(floor.effectRatio.toFixed(3), '1.000');
    assert.equal(floor.p2.toFixed(4), '1.0000');
  });
});

// ─── LIN-2592: {gateKind, rePassKind} option — same walk, new pair ───────────

describe('computeIssueRoundTrips — {gateKind, rePassKind} option (LIN-2592)', () => {
  test('a {gateKind: "review", rePassKind: "implementation"} walk produces the analogous result to the default plan/plan-review walk over an isomorphic fixture', () => {
    // Two structurally identical fixtures — same timestamps, same verdict-comment
    // convention — differing ONLY in which kind labels play gate vs re-pass.
    const buildRows = (gateKind, rePassKind) => [
      row('r1', rePassKind, 'done', '2026-08-09T09:00:00.000Z', '2026-08-09T09:30:00.000Z'),
      row('r2', gateKind, 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z',
        feedbackDone('DONE: Verdict: Request Changes.', '2026-08-09T10:05:00.000Z')),
      row('r3', rePassKind, 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:40:00.000Z'),
      row('r4', gateKind, 'done', '2026-08-09T11:00:00.000Z', '2026-08-09T11:05:00.000Z',
        feedbackDone('DONE: Verdict: Approve.', '2026-08-09T11:05:00.000Z')),
    ];

    const defaultResult = computeIssueRoundTrips(
      issue('default-pair', { rows: buildRows('plan-review', 'plan') }),
      { asOf: ASOF },
    );
    const newPairResult = computeIssueRoundTrips(
      issue('new-pair', { rows: buildRows('review', 'implementation') }),
      { asOf: ASOF, gateKind: 'review', rePassKind: 'implementation' },
    );

    // Same algorithm, new pair: every derived field that doesn't embed the
    // literal kind string must match exactly.
    assert.equal(newPairResult.R0.tier, defaultResult.R0.tier);
    assert.equal(newPairResult.R0.verdict, defaultResult.R0.verdict);
    assert.equal(newPairResult.R0.resolved, defaultResult.R0.resolved);
    assert.equal(newPairResult.R0.rightCensored, defaultResult.R0.rightCensored);
    assert.equal(newPairResult.reachedPlanReviewAny, defaultResult.reachedPlanReviewAny);
    assert.equal(newPairResult.roundTrips, defaultResult.roundTrips);
    assert.deepEqual(newPairResult.verdictTier, defaultResult.verdictTier);
    assert.deepEqual(newPairResult.crossTierDisagreements, defaultResult.crossTierDisagreements);
    assert.equal(newPairResult.subWindows.length, defaultResult.subWindows.length);

    // And the concrete values are the ones the shared walk is known to produce
    // for this shape (R0 settles on the FIRST gate row, tier B, "request changes";
    // roundTrips=1 for the one re-pass row — r3 — following it).
    assert.equal(newPairResult.R0.tier, 'b');
    assert.equal(newPairResult.R0.verdict, 'request changes');
    assert.equal(newPairResult.roundTrips, 1);
  });

  test('under the review pair, a `plan-review` row is NOT treated as the gate (no silent fallback to the literal)', () => {
    const iss = issue('not-a-gate', {
      rows: [
        row('r1', 'plan-review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z',
          feedbackDone('DONE: Verdict: Approve.', '2026-08-09T10:05:00.000Z')),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF, gateKind: 'review', rePassKind: 'implementation' });
    // If a helper silently fell back to the hardcoded 'plan-review' literal,
    // this row WOULD settle R0 (it carries a perfectly resolving DONE line).
    assert.equal(result.R0, null);
    assert.equal(result.reachedPlanReviewAny, false);
  });

  test('under the review pair, a legacy `plan` row is NOT counted as the re-pass kind by countRoundTrips (no silent fallback to the literal)', () => {
    const iss = issue('not-a-repass', {
      rows: [
        row('r1', 'review', 'done', '2026-08-09T10:00:00.000Z', '2026-08-09T10:05:00.000Z',
          feedbackDone('DONE: Verdict: Request Changes.', '2026-08-09T10:05:00.000Z')),
        // A `plan` row, not `implementation` — must NOT be counted as a re-pass
        // under the {gateKind: 'review', rePassKind: 'implementation'} pair.
        row('r2', 'plan', 'done', '2026-08-09T10:10:00.000Z', '2026-08-09T10:20:00.000Z'),
      ],
    });
    const result = computeIssueRoundTrips(iss, { asOf: ASOF, gateKind: 'review', rePassKind: 'implementation' });
    assert.equal(result.roundTrips, 0);
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
