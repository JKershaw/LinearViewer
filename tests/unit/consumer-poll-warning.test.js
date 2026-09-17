/**
 * Unit tests for lib/consumer-poll-warning.js (LIN-2885).
 *
 * Pins: the configurable threshold (default + env override + invalid-value
 * fallback), `getConsumerLastSeenAt`'s max-across-tokens resolution and its
 * "never" (null) case, and `buildConsumerPollWarning`'s three outcomes — live
 * (null), stale (a "since <time>" message), and never (a "no consumer has
 * ever polled" message).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS,
  getConsumerPollWarningThresholdMs,
  getConsumerLastSeenAt,
  buildConsumerPollWarning
} from '../../lib/consumer-poll-warning.js';

describe('getConsumerPollWarningThresholdMs (LIN-2885)', () => {
  afterEach(() => {
    delete process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS;
  });

  test('defaults to 1 hour when unset', () => {
    delete process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS;
    assert.strictEqual(getConsumerPollWarningThresholdMs(), DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS);
    assert.strictEqual(DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS, 60 * 60 * 1000);
  });

  test('honors a configured positive value', () => {
    process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS = '120000';
    assert.strictEqual(getConsumerPollWarningThresholdMs(), 120000);
  });

  test('falls back to the default on a non-numeric value', () => {
    process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS = 'not-a-number';
    assert.strictEqual(getConsumerPollWarningThresholdMs(), DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS);
  });

  test('falls back to the default on a zero or negative value', () => {
    process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS = '0';
    assert.strictEqual(getConsumerPollWarningThresholdMs(), DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS);
    process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS = '-500';
    assert.strictEqual(getConsumerPollWarningThresholdMs(), DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS);
  });
});

describe('getConsumerLastSeenAt (LIN-2885)', () => {
  test('returns null when the store has no tokens', async () => {
    const store = { listTokens: async () => [] };
    assert.strictEqual(await getConsumerLastSeenAt(store, 'acme'), null);
  });

  test('returns null when no dispatchTokenStore is provided', async () => {
    assert.strictEqual(await getConsumerLastSeenAt(null, 'acme'), null);
  });

  test('returns the MAX lastUsedAt across multiple tokens', async () => {
    const older = new Date('2026-06-01T00:00:00.000Z');
    const newer = new Date('2026-06-05T00:00:00.000Z');
    const store = {
      listTokens: async () => [
        { tokenId: 'a', lastUsedAt: older.toISOString() },
        { tokenId: 'b', lastUsedAt: newer.toISOString() },
        { tokenId: 'c', lastUsedAt: null } // never used — ignored, not treated as "oldest"
      ]
    };
    assert.strictEqual(await getConsumerLastSeenAt(store, 'acme'), newer.toISOString());
  });

  test('returns null ("never") when every token has a null lastUsedAt', async () => {
    const store = { listTokens: async () => [{ tokenId: 'a', lastUsedAt: null }] };
    assert.strictEqual(await getConsumerLastSeenAt(store, 'acme'), null);
  });

  test('fails soft to null on a store read error', async () => {
    const store = { listTokens: async () => { throw new Error('backend down'); } };
    await assert.doesNotReject(() => getConsumerLastSeenAt(store, 'acme'));
    assert.strictEqual(await getConsumerLastSeenAt(store, 'acme'), null);
  });
});

describe('buildConsumerPollWarning (LIN-2885)', () => {
  const now = new Date('2026-06-06T12:00:00.000Z');

  test('returns the "never" message when consumerLastSeenAt is null', () => {
    const warning = buildConsumerPollWarning(null, { now });
    assert.ok(warning);
    assert.match(warning, /ever polled/i);
  });

  test('returns null when the last poll is within the threshold (live workspace)', () => {
    const recent = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min ago
    assert.strictEqual(buildConsumerPollWarning(recent, { now, thresholdMs: 60 * 60 * 1000 }), null);
  });

  test('returns a "since <time>" message when the last poll is older than the threshold', () => {
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    const warning = buildConsumerPollWarning(stale, { now, thresholdMs: 60 * 60 * 1000 });
    assert.ok(warning);
    assert.ok(warning.includes(stale));
    assert.doesNotMatch(warning, /ever polled/i);
  });

  test('is exactly at the threshold boundary: not yet stale', () => {
    const boundary = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // exactly 1h ago
    assert.strictEqual(buildConsumerPollWarning(boundary, { now, thresholdMs: 60 * 60 * 1000 }), null);
  });

  test('uses the configured default threshold when none is passed explicitly', () => {
    delete process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS;
    const justOverAnHour = new Date(Date.now() - (60 * 60 * 1000 + 1000)).toISOString();
    const warning = buildConsumerPollWarning(justOverAnHour);
    assert.ok(warning);
  });
});
