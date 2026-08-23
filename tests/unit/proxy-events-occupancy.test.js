/**
 * LIN-2076 (Half B) — pure-function tests for `providerLaneOccupancy`, the
 * time-bucketed provider-lane fault detector lib/proxy-events.js adds beside
 * (never forking) the existing `credentialVerdict`/`foldCredentialHealth`
 * model. See that module's own doc comment for why occupancy — not a raw
 * call-ratio — is the primary detector, and why `unknown` is required below
 * a sample floor rather than a false `ok`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  providerLaneOccupancy,
  resolveOccupancyWindow,
  OCCUPANCY_MIN_WINDOW_MS,
  OCCUPANCY_BUCKET_MS,
  STAGE_PROVIDER_LANE,
  STAGE_PROXY_TOKEN,
} from '../../lib/proxy-events.js';

const NOW = Date.parse('2026-08-16T20:45:00.000Z');

function row(offsetMsBeforeNow, status, stage = STAGE_PROVIDER_LANE) {
  return { status, stage, timestamp: new Date(NOW - offsetMsBeforeNow) };
}

describe('resolveOccupancyWindow', () => {
  test('enforces a 60s floor even when a shorter window is requested', () => {
    assert.equal(resolveOccupancyWindow(1000), OCCUPANCY_MIN_WINDOW_MS);
  });

  test('junk/non-positive falls back to the credential-health default, still floored', () => {
    assert.equal(resolveOccupancyWindow(0), 15 * 60 * 1000);
    assert.equal(resolveOccupancyWindow(-500), 15 * 60 * 1000);
    assert.equal(resolveOccupancyWindow(undefined), 15 * 60 * 1000);
  });

  test('clamps an oversized window to the 24h cap', () => {
    assert.equal(resolveOccupancyWindow(7 * 24 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);
  });
});

describe('providerLaneOccupancy', () => {
  test('unknown when there is no evidence at all — never a false ok from silence', () => {
    const result = providerLaneOccupancy([], { now: NOW });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.occupancy, null);
    assert.equal(result.bucketsWithEvidence, 0);
  });

  test('unknown below the bucket sample floor, even with real evidence', () => {
    // A single bucket's worth of calls, all failing — still not enough
    // DISTINCT buckets to trust a verdict.
    const rows = [row(1000, 401), row(2000, 401)];
    const result = providerLaneOccupancy(rows, { now: NOW });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.bucketsWithEvidence, 1);
  });

  test('ok when every bucket carrying provider-lane traffic succeeded', () => {
    const rows = [row(1000, 200), row(35_000, 200), row(65_000, 200)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.verdict, 'ok');
    assert.equal(result.occupancy, 0);
    assert.ok(result.bucketsWithEvidence >= 2);
  });

  test('degraded when at least one bucket carrying provider-lane traffic saw a 401', () => {
    const rows = [row(1000, 401), row(35_000, 200), row(65_000, 200)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.verdict, 'degraded');
    assert.equal(result.bucketsFaulting, 1);
    assert.ok(result.occupancy > 0 && result.occupancy < 1);
  });

  test('bucket occupancy, not call count, is the detector: many retried failures in one bucket weigh the same as one', () => {
    // Bucket A: 5 failing retries within the same 30s bucket.
    // Bucket B, C, D: one clean call each, in three distinct later buckets.
    const rows = [
      row(1000, 401), row(2000, 401), row(3000, 401), row(4000, 401), row(5000, 401),
      row(35_000, 200),
      row(65_000, 200),
      row(95_000, 200),
    ];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.bucketsWithEvidence, 4);
    assert.equal(result.bucketsFaulting, 1);
    assert.equal(result.occupancy, 0.25);
    // The naive call ratio would read much worse (5/8) than the bucket
    // occupancy (1/4) — exactly the retry-cadence distortion the ticket
    // calls out; both are reported, but occupancy is what sets the verdict.
    assert.equal(result.callRatio, 5 / 8);
    assert.equal(result.verdict, 'degraded');
  });

  test('proxy-token-stage rows are excluded entirely — they are not provider-lane evidence', () => {
    const rows = [
      row(1000, 401, STAGE_PROXY_TOKEN),
      row(2000, 401, STAGE_PROXY_TOKEN),
      row(35_000, 401, STAGE_PROXY_TOKEN),
    ];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.totalCalls, 0);
    assert.equal(result.bucketsWithEvidence, 0);
  });

  test('rows outside the window are dropped', () => {
    const rows = [row(1000, 200), row(35_000, 200), row(10 * 60 * 1000, 401)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.totalCalls, 2, 'the row 10 minutes back falls outside a 120s window');
  });

  test('a requested window under 60s is floored, not honoured literally', () => {
    const rows = [row(1000, 200), row(35_000, 401)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 5000 });
    assert.equal(result.windowMs, OCCUPANCY_MIN_WINDOW_MS);
    // Both rows fall inside the floored 60s window even though the caller asked for 5s.
    assert.equal(result.totalCalls, 2);
  });

  test('default bucket width is 30 seconds', () => {
    assert.equal(OCCUPANCY_BUCKET_MS, 30_000);
  });
});
