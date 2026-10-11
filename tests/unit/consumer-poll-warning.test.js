/**
 * Unit tests for lib/consumer-poll-warning.js (LIN-2885).
 *
 * Pins: the fixed 20-minute NOBODY_LISTENING_MS limit and its boundary,
 * `getConsumerLastSeenAt`'s max-across-tokens resolution and its
 * "never" (null) case, and `buildConsumerPollWarning`'s three outcomes — live
 * (null), stale (a "since <time>" message), and never (a "no consumer has
 * ever polled" message).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOBODY_LISTENING_MS,
  getConsumerLastSeenAt,
  buildConsumerPollWarning
} from '../../lib/consumer-poll-warning.js';

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

  test('NOBODY_LISTENING_MS is 20 minutes', () => {
    assert.strictEqual(NOBODY_LISTENING_MS, 20 * 60 * 1000);
  });

  const ago = (ms) => new Date(now.getTime() - ms).toISOString();

  test('returns null when the last poll is within the limit (live workspace)', () => {
    assert.strictEqual(buildConsumerPollWarning(ago(5 * 60 * 1000), { now }), null);
    assert.strictEqual(buildConsumerPollWarning(ago(19 * 60 * 1000 + 59 * 1000), { now }), null);
  });

  test('is exactly at the limit boundary: not yet stale', () => {
    assert.strictEqual(buildConsumerPollWarning(ago(NOBODY_LISTENING_MS), { now }), null);
  });

  test('warns with a "since <time>" message just past the limit', () => {
    for (const ageMs of [NOBODY_LISTENING_MS + 1, 21 * 60 * 1000]) {
      const stamp = ago(ageMs);
      const warning = buildConsumerPollWarning(stamp, { now });
      assert.ok(warning);
      assert.ok(warning.includes(stamp));
      assert.doesNotMatch(warning, /ever polled/i);
    }
  });

  test('a runner gone 30 minutes now warns (LIN-2953; was silent under the old 1h window)', () => {
    assert.ok(buildConsumerPollWarning(ago(30 * 60 * 1000), { now }));
  });

  test('uses the real clock when no now is passed', () => {
    const warning = buildConsumerPollWarning(new Date(Date.now() - (NOBODY_LISTENING_MS + 1000)).toISOString());
    assert.ok(warning);
  });
});
