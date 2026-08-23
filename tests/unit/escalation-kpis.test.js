/**
 * Unit tests for lib/escalation-kpis.js (LIN-1736)
 *
 * Run with: node --test tests/unit/escalation-kpis.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { computeEscalationKpis } from '../../lib/escalation-kpis.js';

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

describe('computeEscalationKpis — windowMs is echoed back', () => {
  test('the effective window is reported on the result', () => {
    const result = computeEscalationKpis({ windowMs: 7 * DAY_MS, now: NOW });
    assert.strictEqual(result.windowMs, 7 * DAY_MS);
  });
});
