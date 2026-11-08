/**
 * LIN-4200 beat 3 (D13): tests for the pure helpers of scripts/lin-4200-d13-volume-timing.mjs. The I/O
 * (production reads, the scratch copy) is measured by the script, not here.
 *
 * Run with: node --test tests/unit/lin-4200-d13.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentileOf, distributionOf, bucketCountsOf, summarizeExplain, fitLinear, projectMs,
  steadyStateRecordsOf, sumRecordsByLineage, hostPortOf, assertScratchTarget, deltaPctOf
} from '../../scripts/lin-4200-d13-volume-timing.mjs';
import { seedPinnedCatalog } from './helpers/pinned-catalog.js';

// LIN-4358: rates and names come from the catalog; price from the pinned 8 Nov 2026 snapshot.
seedPinnedCatalog();

describe('timing delta', () => {
  test('deltaPctOf is the percentage change from the stamped base to the loader (positive = slower)', () => {
    assert.equal(deltaPctOf(100, 105), 5);
    assert.equal(deltaPctOf(200, 150), -25);
    assert.equal(deltaPctOf(0, 5), null, 'a zero base has no delta');
    assert.equal(deltaPctOf(null, 5), null);
  });
});

describe('volume distribution', () => {
  test('nearest-rank percentiles', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentileOf(v, 50), 5);
    assert.equal(percentileOf(v, 95), 10);
    assert.equal(percentileOf([], 50), null);
  });

  test('distribution reports min, median, p95, max and count', () => {
    const d = distributionOf([15, 30, 295, 60]);
    assert.deepEqual(d, { count: 4, min: 15, median: 30, p95: 295, max: 295 });
  });

  test('records are bucketed per UTC day and per UTC hour', () => {
    const ms = [Date.parse('2026-11-04T05:10:00Z'), Date.parse('2026-11-04T05:50:00Z'), Date.parse('2026-11-04T06:01:00Z')];
    assert.deepEqual(bucketCountsOf(ms, 'day'), { '2026-11-04': 3 });
    assert.deepEqual(bucketCountsOf(ms, 'hour'), { '2026-11-04T05': 2, '2026-11-04T06': 1 });
  });

  test('unparseable instants are skipped, not counted', () => {
    assert.deepEqual(bucketCountsOf([NaN, Date.parse('2026-11-04T00:00:00Z')], 'day'), { '2026-11-04': 1 });
  });
});

describe('explain summary', () => {
  test('finds the index under an FETCH over an IXSCAN and reads the counters', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'urlKey_1_rootItemId_1' } } },
      executionStats: { nReturned: 81, totalKeysExamined: 3975, totalDocsExamined: 81, executionTimeMillis: 2 }
    };
    const s = summarizeExplain(explain);
    assert.equal(s.indexName, 'urlKey_1_rootItemId_1');
    assert.equal(s.usesIxScan, true);
    assert.equal(s.usesCollScan, false);
    assert.deepEqual([s.nReturned, s.keysExamined, s.docsExamined], [81, 3975, 81]);
  });

  test('a COLLSCAN is reported as one, so a missing index cannot pass silently', () => {
    const explain = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, executionStats: { nReturned: 0 } };
    const s = summarizeExplain(explain);
    assert.equal(s.usesCollScan, true);
    assert.equal(s.usesIxScan, false);
    assert.equal(s.indexName, null);
  });

  test('stages under inputStages (an OR or a merge) are walked too', () => {
    const explain = {
      queryPlanner: { winningPlan: { stage: 'SORT_MERGE', inputStages: [{ stage: 'IXSCAN', indexName: 'a' }, { stage: 'COLLSCAN' }] } },
      executionStats: {}
    };
    const s = summarizeExplain(explain);
    assert.equal(s.usesCollScan, true);
    assert.equal(s.indexName, 'a');
  });
});

describe('projection', () => {
  test('a least-squares line through exact points recovers its slope and intercept', () => {
    const fit = fitLinear([{ n: 1000, ms: 12 }, { n: 2000, ms: 22 }, { n: 4000, ms: 42 }]);
    assert.ok(Math.abs(fit.b - 0.01) < 1e-9);
    assert.ok(Math.abs(fit.a - 2) < 1e-9);
    assert.ok(Math.abs(projectMs(fit, 100000) - 1002) < 1e-6);
  });

  test('fewer than two points give no fit', () => {
    assert.equal(fitLinear([{ n: 1, ms: 1 }]), null);
  });

  test('steady-state records scale the observed rate to the window', () => {
    // 900 records over 3 hours is 300/hour; 30 days is 720 hours: 216,000.
    assert.equal(steadyStateRecordsOf({ recordsSinceStart: 900, hoursSinceStart: 3, windowDays: 30 }), 216000);
    assert.equal(steadyStateRecordsOf({ recordsSinceStart: 900, hoursSinceStart: 0, windowDays: 30 }), null);
  });
});

describe('records-sum path', () => {
  test('priceRequest per record, summed per lineage; unpriceable records are counted, not summed', () => {
    const base = { harness: 'claude-code', model: 'claude-haiku-5-5', effort: null, lane: null, agent: 'main', at: '2026-11-04T05:40:00Z', cacheCreation1hInputTokens: 0 };
    const records = [
      { ...base, rootItemId: 'L1', requestId: 'a', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { ...base, rootItemId: 'L1', requestId: 'b', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { ...base, rootItemId: 'L2', requestId: 'c', model: 'no-such-model', inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
    ];
    const out = sumRecordsByLineage(records);
    assert.equal(out.records, 3);
    assert.equal(out.lineages, 1);
    assert.equal(out.unpriced, 1);
  });
});

describe('scratch guard (review finding 6)', () => {
  test('a loopback scratch on the requested port is accepted, and the port defaults to 27017', () => {
    assert.deepEqual(hostPortOf('mongodb://127.0.0.1:27017'), { host: '127.0.0.1', port: 27017 });
    assert.deepEqual(hostPortOf('mongodb://localhost'), { host: '127.0.0.1', port: 27017 });
    assert.equal(assertScratchTarget({ scratchUri: 'mongodb://127.0.0.1:27017', prodUri: 'mongodb://127.0.0.1:27018/?x=1', scratchPort: 27017 }).port, 27017);
  });

  test('a non-loopback scratch host is refused', () => {
    assert.throws(() => assertScratchTarget({ scratchUri: 'mongodb://db.example.com:27017', scratchPort: 27017 }), /not loopback/);
  });

  test('a scratch port other than --scratch-port is refused', () => {
    assert.throws(() => assertScratchTarget({ scratchUri: 'mongodb://127.0.0.1:27019', scratchPort: 27017 }), /not --scratch-port/);
  });

  test('a scratch target equal to MONGODB_URI is refused, including the localhost alias', () => {
    assert.throws(() => assertScratchTarget({ scratchUri: 'mongodb://127.0.0.1:27017', prodUri: 'mongodb://127.0.0.1:27017', scratchPort: 27017 }), /equals MONGODB_URI/);
    assert.throws(() => assertScratchTarget({ scratchUri: 'mongodb://127.0.0.1:27017', prodUri: 'mongodb://localhost:27017', scratchPort: 27017 }), /equals MONGODB_URI/);
  });
});

