/**
 * LIN-3011 (LIN-2996 Phase 3): direct unit coverage for `isFreshDigest` and
 * `applyHarvestedAbortToDigest`, the two new `lib/digest-feedback.js` exports
 * this phase adds. Neither exists at HEAD yet (LIN-3008/Phase 0 landed
 * `digestFeedback`/`deriveLoopFacingFacts`, but not these two), so this whole
 * file fails to LOAD today:
 *
 *   SyntaxError: The requested module '../../lib/digest-feedback.js' does not
 *   provide an export named 'isFreshDigest'
 *
 * That import-time crash IS this file's red evidence — every case below is new
 * coverage for behavior that does not exist yet, so a whole-file failure is the
 * correct (and only possible) TDD-red signal at this granularity. It is
 * deliberately kept in its own file, isolated from `digest-feedback.test.js`
 * (which already covers `digestFeedback` and passes today), so this crash
 * cannot hide any currently-passing test's ability to run.
 *
 * `isFreshDigest(doc)` mirrors Phase 4's Mongo `FRESH_DIGEST` `$cond` in JS:
 * `v(doc) = doc.feedbackVersion ?? 0`; fresh iff `doc.feedbackDigest` is a
 * non-null object AND `doc.feedbackDigest.version === v(doc)`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isFreshDigest, applyHarvestedAbortToDigest } from '../../lib/digest-feedback.js';

// The six row shapes the plan's real-mongod freshness-agreement test also
// seeds (mongo-smoke.test.js) — pinned here in pure JS first.
describe('isFreshDigest(doc) — v(doc) = doc.feedbackVersion ?? 0', () => {
  test('legacy: both feedbackVersion and feedbackDigest absent -> not fresh', () => {
    assert.equal(isFreshDigest({}), false);
  });

  test('seeded-empty: feedbackVersion:0, feedbackDigest:null -> not fresh', () => {
    assert.equal(isFreshDigest({ feedbackVersion: 0, feedbackDigest: null }), false);
  });

  test('fresh: feedbackDigest.version === feedbackVersion -> fresh', () => {
    assert.equal(isFreshDigest({ feedbackVersion: 3, feedbackDigest: { version: 3 } }), true);
  });

  test('stale: feedbackDigest.version !== feedbackVersion -> not fresh', () => {
    assert.equal(isFreshDigest({ feedbackVersion: 3, feedbackDigest: { version: 2 } }), false);
  });

  test('healed-at-0: a legacy row healed once, version 0 on both sides -> fresh', () => {
    assert.equal(isFreshDigest({ feedbackVersion: 0, feedbackDigest: { version: 0 } }), true);
  });

  test('digest without a `.version` key -> not fresh (never crashes on the missing key)', () => {
    assert.equal(isFreshDigest({ feedbackVersion: 0, feedbackDigest: { terminal: null } }), false);
  });

  test('feedbackVersion absent, digest present with version 0 -> fresh (v(doc) defaults to 0)', () => {
    assert.equal(isFreshDigest({ feedbackDigest: { version: 0 } }), true);
  });
});

describe('applyHarvestedAbortToDigest(digest, abortEntry, dispatchedAt) — V4 + W1', () => {
  const baseDigest = () => ({
    version: 1,
    terminal: null,
    wake: { marker: 'blocked', waitingMessage: 'waiting on a human' },
    decision: { decision_id: 'd-1' },
    decisionCase: ['case text'],
    answeredDecisionId: 'd-0',
    parkedWait: { reason: 'ci-poll' },
    telemetry: {
      runtime: { ms: null, dispatchedAt: '2026-04-10T09:00:00.000Z', completedAt: null, crossCheck: null },
      metrics: [], toolPeak: null
    }
  });

  test('terminal becomes the abort', () => {
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const out = applyHarvestedAbortToDigest(baseDigest(), abortEntry, '2026-04-10T09:00:00.000Z');
    assert.equal(out.terminal.status, 'aborted');
    assert.equal(out.terminal.entry.timestamp, abortEntry.timestamp);
  });

  test('wake becomes {marker:"aborted", waitingMessage:null}', () => {
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const out = applyHarvestedAbortToDigest(baseDigest(), abortEntry, '2026-04-10T09:00:00.000Z');
    assert.deepEqual(out.wake, { marker: 'aborted', waitingMessage: null });
  });

  test('parkedWait becomes null', () => {
    // LIN-3011 beat-4 fix: `parkedWait` is TOP-LEVEL on the persisted digest
    // shape (lib/digest-feedback.js's digestFeedback: `parkedWait: facts.
    // telemetry.parkedWait ?? null`), never nested under `.telemetry` — this
    // beat-2 fixture already seeded it top-level (see baseDigest above), but
    // the assertion below checked the wrong path (`out.telemetry.parkedWait`)
    // and would have passed vacuously against `undefined`. Corrected to match
    // the real digestFeedback shape this function actually operates on.
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const out = applyHarvestedAbortToDigest(baseDigest(), abortEntry, '2026-04-10T09:00:00.000Z');
    assert.equal(out.parkedWait, null);
  });

  test('runtime.completedAt/ms reproduce deriveRuntime(dispatchedAt, abortEntry.timestamp, [abortEntry])', () => {
    const dispatchedAt = '2026-04-10T09:00:00.000Z';
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const out = applyHarvestedAbortToDigest(baseDigest(), abortEntry, dispatchedAt);
    assert.equal(out.telemetry.runtime.completedAt, abortEntry.timestamp);
    assert.equal(out.telemetry.runtime.ms, Date.parse(abortEntry.timestamp) - Date.parse(dispatchedAt));
  });

  test('decision fields are unaffected', () => {
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const digest = baseDigest();
    const out = applyHarvestedAbortToDigest(digest, abortEntry, '2026-04-10T09:00:00.000Z');
    assert.deepEqual(out.decision, digest.decision);
    assert.deepEqual(out.decisionCase, digest.decisionCase);
    assert.equal(out.answeredDecisionId, digest.answeredDecisionId);
  });

  test('F1 millisecond-exact guard: a genuine terminal 700ms LATER than the abort is kept, never rewound', () => {
    const digest = baseDigest();
    digest.terminal = { status: 'done', entry: { message: '[done] shipped', timestamp: '2026-04-10T10:00:00.900Z' } };
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.200Z' };
    const out = applyHarvestedAbortToDigest(digest, abortEntry, '2026-04-10T09:00:00.000Z');
    assert.equal(out.terminal.status, 'done', 'the later genuine terminal must not be overridden by an earlier abort');
    assert.equal(out.terminal.entry.timestamp, '2026-04-10T10:00:00.900Z');
  });

  test('F1 millisecond-exact guard: a 700ms-LATER abort wins over an earlier genuine terminal (the sub-second reproduction case)', () => {
    const digest = baseDigest();
    digest.terminal = { status: 'failed', entry: { message: '[failed] ... in 3m', timestamp: '2026-04-10T10:00:00.200Z' } };
    const abortEntry = { message: '[aborted] cancelled', timestamp: '2026-04-10T10:00:00.900Z' };
    const out = applyHarvestedAbortToDigest(digest, abortEntry, '2026-04-10T09:00:00.000Z');
    assert.equal(out.terminal.status, 'aborted');
    assert.equal(out.terminal.entry.timestamp, '2026-04-10T10:00:00.900Z');
  });
});
