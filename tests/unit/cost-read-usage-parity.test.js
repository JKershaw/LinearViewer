/**
 * LIN-4179 parity (plan W8): the two named copies of "which entry is a row's usage" agree with `lastUsageEntry`
 * (lib/row-usage.js), the one answer the fold reads.
 *
 *  - the digest's `kpiUsageEntry` (lib/digest-feedback.js, via `digestFeedback`), a JS path; and
 *  - the Mongo aggregation's `$last` over `kind: 'usage'` (lib/kpi-stats.js `dispatchHistoryPipeline`, read through
 *    `loadDispatchHistory`), which a query can run only on a real server.
 *
 * The Mongo half needs a real mongod (MangoDB restates `$last` in JS and would prove nothing), so it follows
 * mongo-smoke.test.js: it runs when MONGODB_TEST_URI is set, skips locally otherwise, and fails hard in CI when the
 * URI is missing rather than passing with zero coverage.
 *
 * Run with: MONGODB_TEST_URI=mongodb://127.0.0.1:27017 node --test tests/unit/cost-read-usage-parity.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { lastUsageEntry } from '../../lib/row-usage.js';
import { digestFeedback } from '../../lib/digest-feedback.js';
import { loadDispatchHistory } from '../../lib/kpi-stats.js';

const uri = process.env.MONGODB_TEST_URI || '';
if (!uri && process.env.CI) {
  throw new Error('cost-read-usage-parity: MONGODB_TEST_URI is not set in CI; the $last parity would silently not run');
}

const at = (minutes) => new Date(Date.UTC(2026, 10, 1, 0, minutes));

/** Each fixture is one row's raw feedback (Date timestamps, as the store holds them). */
export const FIXTURES = {
  twoUsageEntries: [
    { message: '[usage] first', timestamp: at(1), kind: 'usage' },
    { message: 'work', timestamp: at(2), kind: 'telemetry' },
    { message: '[usage] last', timestamp: at(3), kind: 'usage' },
  ],
  usageThenEvidence: [
    { message: '[usage] only usage', timestamp: at(1), kind: 'usage' },
    { message: '[evidence] pr', timestamp: at(2), kind: 'evidence' },
  ],
  noUsage: [
    { message: 'started', timestamp: at(1), kind: 'telemetry' },
  ],
  usageWithoutMessage: [
    { timestamp: at(5), kind: 'usage' },
  ],
  usageWithoutTimestamp: [
    { message: '[usage] undated', kind: 'usage' },
  ],
  empty: [],
};

/**
 * The oracle: the last `kind: 'usage'` entry, found by a plain scan that does NOT call lib/row-usage.js. The copies
 * are compared to this, so a change to `lastUsageEntry` cannot move the expectation along with the code under test.
 */
export function oracleLastUsage(feedback) {
  let last = null;
  for (const entry of feedback) if (entry && entry.kind === 'usage') last = entry;
  return last;
}

/** The three fields both copies carry (`kpiUsageEntry`, the aggregation's projection), or null. */
export function normalizedUsage(feedback) {
  const entry = oracleLastUsage(feedback);
  if (!entry) return null;
  return {
    message: entry.message ?? null,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : (entry.timestamp ?? null),
    kind: entry.kind ?? null,
  };
}

const isoOrNull = (value) => (value instanceof Date ? value.toISOString() : (value ?? null));

describe('lastUsageEntry is the last usage entry (the oracle)', () => {
  for (const [name, feedback] of Object.entries(FIXTURES)) {
    test(`fixture ${name}`, () => {
      assert.deepEqual(lastUsageEntry(feedback) ?? null, oracleLastUsage(feedback) ?? null);
    });
  }
});

describe('the digest copy (kpiUsageEntry) reads lastUsageEntry', () => {
  for (const [name, feedback] of Object.entries(FIXTURES)) {
    test(`fixture ${name}`, () => {
      const digest = digestFeedback({ _id: `row-${name}`, urlKey: 'acme', dispatchedAt: at(0), feedback });
      const expected = normalizedUsage(feedback);
      const actual = digest.kpiUsageEntry === null || digest.kpiUsageEntry === undefined
        ? null
        : { message: digest.kpiUsageEntry.message ?? null, timestamp: isoOrNull(digest.kpiUsageEntry.timestamp), kind: digest.kpiUsageEntry.kind ?? null };
      assert.deepEqual(actual, expected);
    });
  }
});

describe('the Mongo copy ($last over kind usage) reads lastUsageEntry (real MongoDB)', {
  skip: uri ? false : 'MONGODB_TEST_URI not set; skipping the real-Mongo $last parity (local dev)',
}, () => {
  let client;
  let db;

  before(async () => {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(`usage_parity_${Date.now()}`);
  });

  after(async () => {
    if (db) await db.dropDatabase();
    if (client) await client.close();
  });

  test('the aggregation reports the same usage entry as lastUsageEntry for every fixture', async () => {
    const names = Object.keys(FIXTURES);
    const history = db.collection('dispatch-history');
    await history.insertMany(names.map((name, i) => ({
      _id: `row-${name}`,
      urlKey: 'acme',
      dispatchedAt: new Date(Date.UTC(2026, 10, 1, 0, 0) + i),
      status: 'taken',
      rootItemId: `row-${name}`,
      feedback: FIXTURES[name],
    })));
    const rows = await loadDispatchHistory(history, { urlKey: 'acme' });
    const byId = new Map(rows.map(row => [row._id, row]));

    for (const name of names) {
      const row = byId.get(`row-${name}`);
      assert.ok(row, `${name}: the row comes back from the aggregation`);
      const actual = row.usageEntry
        ? { message: row.usageEntry.message ?? null, timestamp: isoOrNull(row.usageEntry.timestamp), kind: row.usageEntry.kind ?? null }
        : null;
      assert.deepEqual(actual, normalizedUsage(FIXTURES[name]), `${name}: $last must agree with lastUsageEntry`);
    }
  });
});
