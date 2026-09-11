/**
 * Unit tests for lib/escalation-kpis.js (LIN-1736)
 *
 * Run with: node --test tests/unit/escalation-kpis.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { computeEscalationKpis } from '../../lib/escalation-kpis.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { resolvedDecisionEvents } from '../../lib/pipeline-loops.js';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMsFromNow) {
  return new Date(NOW.getTime() + offsetMsFromNow).toISOString();
}

describe('computeEscalationKpis — empty input', () => {
  test('defaults are all present and zeroed/null, never throws or omits a key', () => {
    const result = computeEscalationKpis({ now: NOW });
    assert.deepStrictEqual(result.escalationRate, { raisedInWindow: 0, perDay: 0, targetPerDay: null, overTarget: null });
    assert.deepStrictEqual(result.timeToResponse, { count: 0, medianMs: null, maxMs: null });
    assert.deepStrictEqual(result.falseEscalation, { dismissed: 0, answered: 0, total: 0, rate: null });
    assert.deepStrictEqual(result.unansweredAge, { count: 0, staleCount: 0, maxAgeMs: 0, staleThresholdMs: DAY_MS });
  });

  test('non-array inputs are tolerated, never throw', () => {
    const result = computeEscalationKpis({ resolvedEvents: null, unansweredRows: undefined, now: NOW });
    assert.strictEqual(result.escalationRate.raisedInWindow, 0);
  });
});

describe('computeEscalationKpis — escalation rate', () => {
  test('counts both still-unanswered and already-resolved decisions raised in the window', () => {
    const result = computeEscalationKpis({
      unansweredRows: [{ decisionId: 'd-1', raisedAt: iso(-DAY_MS) }],
      resolvedEvents: [{ decisionId: 'd-2', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' }],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.escalationRate.raisedInWindow, 2);
  });

  test('a decision raised BEFORE the window does not count', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [{ decisionId: 'd-1', raisedAt: iso(-40 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' }],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.escalationRate.raisedInWindow, 0);
  });

  test('perDay divides the count by the window length in days', () => {
    const result = computeEscalationKpis({
      unansweredRows: [
        { decisionId: 'd-1', raisedAt: iso(-DAY_MS) },
        { decisionId: 'd-2', raisedAt: iso(-DAY_MS) },
      ],
      windowMs: 10 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.escalationRate.raisedInWindow, 2);
    assert.strictEqual(result.escalationRate.perDay, 0.2);
  });

  test('with no targetPerDay, overTarget is null (no fabricated verdict)', () => {
    const result = computeEscalationKpis({ now: NOW });
    assert.strictEqual(result.escalationRate.targetPerDay, null);
    assert.strictEqual(result.escalationRate.overTarget, null);
  });

  test('a supplied targetPerDay produces a real over/under verdict', () => {
    const under = computeEscalationKpis({
      unansweredRows: [{ decisionId: 'd-1', raisedAt: iso(-DAY_MS) }],
      windowMs: 10 * DAY_MS,
      targetPerDay: 5,
      now: NOW,
    });
    assert.strictEqual(under.escalationRate.overTarget, false);

    const over = computeEscalationKpis({
      unansweredRows: Array.from({ length: 20 }, (_, i) => ({ decisionId: `d-${i}`, raisedAt: iso(-DAY_MS) })),
      windowMs: 10 * DAY_MS,
      targetPerDay: 0.5,
      now: NOW,
    });
    assert.strictEqual(over.escalationRate.overTarget, true);
  });
});

describe('computeEscalationKpis — time-to-response', () => {
  test('computes the duration from raisedAt to resolvedAt for resolved-in-window events', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [
        { decisionId: 'd-1', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' },
      ],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.timeToResponse.count, 1);
    assert.strictEqual(result.timeToResponse.medianMs, DAY_MS);
    assert.strictEqual(result.timeToResponse.maxMs, DAY_MS);
  });

  test('median/max over several events', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [
        { decisionId: 'd-1', raisedAt: iso(-3 * DAY_MS), resolvedAt: iso(-2 * DAY_MS), outcome: 'answered' }, // 1 day
        { decisionId: 'd-2', raisedAt: iso(-5 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' }, // 4 days
        { decisionId: 'd-3', raisedAt: iso(-10 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'dismissed' }, // 9 days
      ],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.timeToResponse.count, 3);
    assert.strictEqual(result.timeToResponse.medianMs, 4 * DAY_MS);
    assert.strictEqual(result.timeToResponse.maxMs, 9 * DAY_MS);
  });

  test('an event resolved OUTSIDE the window is excluded even if raised inside it', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [{ decisionId: 'd-1', raisedAt: iso(-DAY_MS), resolvedAt: iso(-40 * DAY_MS), outcome: 'answered' }],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.timeToResponse.count, 0);
  });

  test('an event with no raisedAt contributes to false-escalation counts but not a duration', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [{ decisionId: 'd-1', raisedAt: null, resolvedAt: iso(-DAY_MS), outcome: 'answered' }],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.timeToResponse.count, 0);
    assert.strictEqual(result.falseEscalation.answered, 1);
  });
});

describe('computeEscalationKpis — false-escalation rate', () => {
  test('rate = dismissed / (answered + dismissed), among resolved-in-window events', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [
        { decisionId: 'd-1', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' },
        { decisionId: 'd-2', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'dismissed' },
        { decisionId: 'd-3', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'dismissed' },
      ],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.falseEscalation.answered, 1);
    assert.strictEqual(result.falseEscalation.dismissed, 2);
    assert.strictEqual(result.falseEscalation.total, 3);
    assert.strictEqual(result.falseEscalation.rate, 2 / 3);
  });

  test('rate is null (not 0) when nothing resolved in the window — an absence of data is not a perfect score', () => {
    const result = computeEscalationKpis({ now: NOW });
    assert.strictEqual(result.falseEscalation.total, 0);
    assert.strictEqual(result.falseEscalation.rate, null);
  });
});

describe('computeEscalationKpis — unanswered age', () => {
  test('age is measured from raisedAt to now, independent of the window', () => {
    const result = computeEscalationKpis({
      unansweredRows: [{ decisionId: 'd-1', raisedAt: iso(-3 * DAY_MS) }],
      windowMs: DAY_MS, // window shorter than the age — must not hide it
      now: NOW,
    });
    assert.strictEqual(result.unansweredAge.count, 1);
    assert.strictEqual(result.unansweredAge.maxAgeMs, 3 * DAY_MS);
  });

  test('staleCount counts rows older than staleThresholdMs; the threshold itself is not stale', () => {
    const result = computeEscalationKpis({
      unansweredRows: [
        { decisionId: 'd-1', raisedAt: iso(-DAY_MS - 1) }, // just over 24h
        { decisionId: 'd-2', raisedAt: iso(-DAY_MS + 1) }, // just under 24h
      ],
      staleThresholdMs: DAY_MS,
      now: NOW,
    });
    assert.strictEqual(result.unansweredAge.staleCount, 1);
    assert.strictEqual(result.unansweredAge.count, 2);
  });

  test('a row with no parseable raisedAt is excluded from age stats entirely (never counted as age 0)', () => {
    const result = computeEscalationKpis({
      unansweredRows: [{ decisionId: 'd-1', raisedAt: null }, { decisionId: 'd-2', raisedAt: 'not-a-date' }],
      now: NOW,
    });
    assert.strictEqual(result.unansweredAge.count, 0);
    assert.strictEqual(result.unansweredAge.maxAgeMs, 0);
  });

  test('a custom staleThresholdMs is echoed back for the renderer to label correctly', () => {
    const result = computeEscalationKpis({ staleThresholdMs: 6 * 60 * 60 * 1000, now: NOW });
    assert.strictEqual(result.unansweredAge.staleThresholdMs, 6 * 60 * 60 * 1000);
  });
});

// LIN-2650 WS0 §6: 'self-resolved' gets its own bucket, and the fix's own
// atomicity depends on getting ALL of this right in one commit — one
// fixture mixing dismissed/answered/self-resolved, one assertion block over
// every sub-object the return value carries, so a fix landing on only one
// metric cannot pass.
describe('computeEscalationKpis — self-resolved outcome (LIN-2650)', () => {
  test('a self-resolved row is excluded from falseEscalation and timeToResponse, still counted as raised, and reported in its own selfResolved.count', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [
        { decisionId: 'd-answered', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'answered' },
        { decisionId: 'd-dismissed', raisedAt: iso(-2 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'dismissed' },
        { decisionId: 'd-self-resolved', raisedAt: iso(-3 * DAY_MS), resolvedAt: iso(-DAY_MS), outcome: 'self-resolved' },
      ],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });

    // escalationRate.raisedInWindow: the self-resolved row was genuinely
    // RAISED in-window and must still count as having been raised — the
    // early `continue` lives in the SEPARATE resolved-in-window loop
    // (:115-122), not this raised-in-window one (:104-107), so all three
    // rows count here regardless of outcome.
    assert.strictEqual(result.escalationRate.raisedInWindow, 3);

    // falseEscalation.total/.dismissed/.answered/.rate: computed as if the
    // self-resolved row did not exist — the exact pre-existing 2/3 shape
    // from the false-escalation describe block above, unaffected by adding
    // a third outcome value to the fixture.
    assert.strictEqual(result.falseEscalation.answered, 1);
    assert.strictEqual(result.falseEscalation.dismissed, 1);
    assert.strictEqual(result.falseEscalation.total, 2, 'the self-resolved row must not book into either counter');
    assert.strictEqual(result.falseEscalation.rate, 0.5);

    // timeToResponse.count/.medianMs/.maxMs: computed as if the self-resolved
    // row did not exist — it never reaches the guarded durations.push.
    assert.strictEqual(result.timeToResponse.count, 2, 'the self-resolved row must not reach durations.push');
    assert.strictEqual(result.timeToResponse.medianMs, DAY_MS);
    assert.strictEqual(result.timeToResponse.maxMs, DAY_MS);

    // selfResolved.count: the one row, correctly bucketed.
    assert.deepStrictEqual(result.selfResolved, { count: 1 });
  });

  test('a self-resolved row resolved OUTSIDE the window contributes to nothing, same as any other outcome', () => {
    const result = computeEscalationKpis({
      resolvedEvents: [{ decisionId: 'd-1', raisedAt: iso(-DAY_MS), resolvedAt: iso(-40 * DAY_MS), outcome: 'self-resolved' }],
      windowMs: 30 * DAY_MS,
      now: NOW,
    });
    assert.deepStrictEqual(result.selfResolved, { count: 0 });
  });
});

describe('computeEscalationKpis — windowMs is echoed back', () => {
  test('the effective window is reported on the result', () => {
    const result = computeEscalationKpis({ windowMs: 7 * DAY_MS, now: NOW });
    assert.strictEqual(result.windowMs, 7 * DAY_MS);
  });
});

// ─── LIN-2754 close-out, ledger L2 — Acceptance clause 2's KPI half ───────
// Plan Step 11 witness 3, landed. Until now nothing in this file observed
// the thing the whole ticket exists to fix: a relayed human ruling that is
// cleared via Agree must book as ANSWERED, not inflate the false-escalation
// numerator the way a bulk dismissal did (`lib/escalation-kpis.js`'s
// `dismissed / (answered + dismissed)`).
//
// Deliberately NOT hand-built event literals: both stamps below come out of
// the REAL writers the Agree paths call — `DispatchQueueStore#markDecisionAnswered`
// for a loop-backed ruling and `TaskDecisionsStore#markOutcome` for a
// task-bound one — read back through the REAL readers the KPI route uses
// (`resolvedDecisionEvents` / `listResolvedForWorkspaces`), so the witness
// covers the whole chain rather than the arithmetic alone.
describe('computeEscalationKpis — a relayed answer books as answered, not a false escalation (LIN-2754 L2)', () => {
  const KPI_URL_KEY = 'acme';
  const TASK_ISSUE_ID = '11111111-2222-3333-4444-555555555555';
  const TASK_HASH = 'c'.repeat(64);

  // The real writers stamp `outcomeAt`/`timestamp` with `new Date()`, so
  // these tests run on the real clock rather than this file's frozen NOW —
  // `now` is read AFTER the stamps so every resolution sits inside the
  // window (`resolvedMs <= nowMs`), with raise times backdated by hand.
  const afterStamps = () => new Date(Date.now() + 1000);

  async function loopWithDecision(store, { decisionId, raisedAt }) {
    const item = await store.addItem(KPI_URL_KEY, { prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-2754' });
    await store.takeItem(item._id, KPI_URL_KEY, 'token-a');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    doc.feedback = doc.feedback || [];
    // The raise side: a `decision` feedback entry, exactly the kind a runner
    // writes (`FEEDBACK_ENTRY_KINDS` includes 'decision'), so `raisedAt` is
    // read off real stored data rather than asserted.
    doc.feedback.push({ kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Ship it?' }), timestamp: raisedAt });
    return item._id;
  }

  test('a loop-backed Agree-as-answer stamp (with option_id) lands in the ANSWERED bucket, and a dismissal still lands in the false-escalation numerator', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

    const answeredLoop = await loopWithDecision(store, { decisionId: 'd-relayed-answer', raisedAt: new Date(Date.now() - 2 * DAY_MS) });
    const dismissedLoop = await loopWithDecision(store, { decisionId: 'd-noise', raisedAt: new Date(Date.now() - 2 * DAY_MS) });

    // The new path: Agree on a PROPOSED ANSWER — no `outcome` argument, and a
    // chosen option id (LIN-2754 Shape B). This is the exact call
    // routes/workspace-api.js's comment route makes for a relayed ruling.
    await store.markDecisionAnswered(answeredLoop, KPI_URL_KEY, 'd-relayed-answer', undefined, 'opt-yes');
    // The old-and-still-correct path for genuine noise: Agree on a proposed
    // DISMISSAL, which is what every relayed ruling used to be cleared as.
    await store.markDecisionAnswered(dismissedLoop, KPI_URL_KEY, 'd-noise', 'dismissed');

    const events = store.historyCollection._docs.flatMap(d => resolvedDecisionEvents(d.feedback));
    assert.strictEqual(events.length, 2);

    const answerEvent = events.find(e => e.decisionId === 'd-relayed-answer');
    assert.strictEqual(answerEvent.outcome, 'answered', 'the relayed answer must read back as answered — an option_id on the stamp must not change how it books');

    // Shape B, on the stored stamp itself: the chosen option rides the
    // durable message, so the resolution is self-contained rather than
    // inferred from the suggestion row.
    const stamp = store.historyCollection._docs
      .flatMap(d => d.feedback || [])
      .find(f => f.kind === 'decision-answer' && f.message.includes('d-relayed-answer'));
    assert.deepStrictEqual(JSON.parse(stamp.message), { decision_id: 'd-relayed-answer', option_id: 'opt-yes' });

    const kpis = computeEscalationKpis({ resolvedEvents: events, windowMs: 30 * DAY_MS, now: afterStamps() });
    assert.strictEqual(kpis.falseEscalation.answered, 1);
    assert.strictEqual(kpis.falseEscalation.dismissed, 1);
    assert.strictEqual(kpis.falseEscalation.total, 2);
    assert.strictEqual(kpis.falseEscalation.rate, 0.5);
  });

  test('the pre-LIN-2754 behaviour is the contrast: clearing the SAME relayed ruling as a dismissal doubles the false-escalation rate', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const answeredLoop = await loopWithDecision(store, { decisionId: 'd-relayed-answer', raisedAt: new Date(Date.now() - 2 * DAY_MS) });
    const dismissedLoop = await loopWithDecision(store, { decisionId: 'd-noise', raisedAt: new Date(Date.now() - 2 * DAY_MS) });

    // Both cleared as dismissals — the only bulk exit that existed before.
    await store.markDecisionAnswered(answeredLoop, KPI_URL_KEY, 'd-relayed-answer', 'dismissed');
    await store.markDecisionAnswered(dismissedLoop, KPI_URL_KEY, 'd-noise', 'dismissed');

    const kpis = computeEscalationKpis({
      resolvedEvents: store.historyCollection._docs.flatMap(d => resolvedDecisionEvents(d.feedback)),
      windowMs: 30 * DAY_MS,
      now: afterStamps()
    });
    assert.strictEqual(kpis.falseEscalation.rate, 1, 'every relayed ruling used to count as a false escalation — this is the number the ticket exists to fix');
  });

  test('a task-bound Agree-as-answer (markOutcome + option_id) also books as answered through listResolvedForWorkspaces', async () => {
    const store = new TaskDecisionsStore({ collection: createMockCollection() });
    await store.recordScan({
      urlKey: KPI_URL_KEY, issueId: TASK_ISSUE_ID, issueIdentifier: 'LIN-2754',
      inputHash: TASK_HASH,
      decision: { decision_id: 'scan_11111111_cccccccccccc', question: 'Ship it?', options: [{ id: 'opt-yes', label: 'Yes' }], free_text: false }
    });
    const id = TaskDecisionsStore.buildId(TASK_ISSUE_ID, TASK_HASH);
    const record = await store.markOutcome({ urlKey: KPI_URL_KEY, issueId: TASK_ISSUE_ID, id, outcome: 'answered', optionId: 'opt-yes' });
    assert.strictEqual(record.optionId, 'opt-yes');

    // The same normalisation routes/dashboard.js applies before the KPI call.
    const rows = await store.listResolvedForWorkspaces([KPI_URL_KEY], Date.now() - 30 * DAY_MS);
    const events = rows.map(r => ({ decisionId: r.id, raisedAt: r.scannedAt, resolvedAt: r.outcomeAt, outcome: r.outcome }));

    const kpis = computeEscalationKpis({ resolvedEvents: events, windowMs: 30 * DAY_MS, now: afterStamps() });
    assert.strictEqual(kpis.falseEscalation.answered, 1, 'a task-bound relayed answer must book as answered');
    assert.strictEqual(kpis.falseEscalation.dismissed, 0);
    assert.strictEqual(kpis.falseEscalation.rate, 0, 'no false escalation is recorded for a ruling the human actually answered');
  });
});
