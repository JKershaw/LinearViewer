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
  ProxyEventStore,
} from '../../lib/proxy-events.js';

const NOW = Date.parse('2026-08-16T20:45:00.000Z');

function row(offsetMsBeforeNow, status, stage = STAGE_PROVIDER_LANE, credentialFingerprint = null) {
  return { status, stage, timestamp: new Date(NOW - offsetMsBeforeNow), credentialFingerprint };
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

  // LIN-2473: `credential-health` read 'ok' immediately after an observed
  // provider-lane 503 rejection, because this detector only ever counted a
  // 401 as faulting. LIN-2216 can reclassify a transient provider-lane
  // rejection as a 503 (routes/proxy.js's logEvent labels this exact shape
  // 'provider-503-transient' — a credential resolved and Linear rejected it
  // anyway) — a fix that turns every 401 into one of these would otherwise
  // make this endpoint read permanently green while the lane still flaps.
  test('degraded when a provider-lane 503 carries a credentialFingerprint — the LIN-2216 transient-provider-auth shape', () => {
    const rows = [row(1000, 503, STAGE_PROVIDER_LANE, 'fp-abc123'), row(35_000, 200), row(65_000, 200)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.verdict, 'degraded');
    assert.equal(result.bucketsFaulting, 1);
    assert.equal(result.failedCalls, 1);
  });

  test('a fingerprinted 503 counts toward failedCalls/callRatio exactly like a 401 does', () => {
    const rows = [row(1000, 503, STAGE_PROVIDER_LANE, 'fp-abc123'), row(35_000, 200)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.totalCalls, 2);
    assert.equal(result.failedCalls, 1);
    assert.equal(result.callRatio, 0.5);
  });

  test('a provider-lane 503 with NO credentialFingerprint is not counted — a bare resolution failure is a different fault class, still invisible here by design', () => {
    const rows = [row(1000, 503, STAGE_PROVIDER_LANE, null), row(35_000, 200), row(65_000, 200)];
    const result = providerLaneOccupancy(rows, { now: NOW, windowMs: 120_000 });
    assert.equal(result.verdict, 'ok');
    assert.equal(result.bucketsFaulting, 0);
    assert.equal(result.failedCalls, 0);
  });
});


/**
 * LIN-2473 (review B2). The three detector tests above hand-build their rows,
 * which is exactly how the first revision of this fix shipped unreachable: the
 * rule was right, but `listSelfCredentialHealth` — the ONLY production feeder
 * for `GET /api/proxy/credential-health` — projected
 * `{status, stage, note, timestamp}` and dropped `credentialFingerprint` at
 * the query, so no real row could ever satisfy it and the endpoint went on
 * answering `ok` through a live provider-lane rejection.
 *
 * These tests therefore drive the REAL store: the row is written by the real
 * `recordEvent` in the exact shape `routes/proxy.js`'s `logEvent` writes for a
 * LIN-2216 transient reclassification (a 503 that DID resolve a credential, so
 * `stage` is stamped provider-lane and the fingerprint is carried), and read
 * back through the real `listSelfCredentialHealth`. The fake collection below
 * applies the projection the way Mongo does — that faithfulness is what makes
 * this test able to fail.
 */
function projectionFaithfulCollection() {
  const docs = [];
  const applyProjection = (doc, projection) => {
    if (!projection) return { ...doc };
    const out = {};
    for (const [field, include] of Object.entries(projection)) {
      if (include && field in doc) out[field] = doc[field];
    }
    return out;
  };
  const matches = (doc, q) => {
    if (q.urlKey !== undefined && doc.urlKey !== q.urlKey) return false;
    if (q.tokenId !== undefined && doc.tokenId !== q.tokenId) return false;
    if (q.expiresAt?.$gt !== undefined && !(doc.expiresAt > q.expiresAt.$gt)) return false;
    if (q.timestamp?.$gt !== undefined && !(new Date(doc.timestamp) > q.timestamp.$gt)) return false;
    if (q.$or && !q.$or.some(clause => Object.entries(clause).every(([k, v]) => doc[k] === v))) return false;
    return true;
  };
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}, options = {}) {
      const rows = docs.filter(d => matches(d, query)).map(d => applyProjection(d, options.projection));
      return { async toArray() { return rows; } };
    },
  };
}

describe('LIN-2473: the credential-health feeder must carry the fingerprint to the detector', () => {
  /** Write the two rows a flapping lane really produces, then age one into an earlier bucket. */
  async function seedFlap(store, collection, { credentialFingerprint }) {
    await store.recordEvent({
      urlKey: 'ws', tokenId: 'tok', tokenLabel: 'runner', method: 'GET', endpoint: '/api/proxy/issues/LIN-1',
      status: 503, stage: STAGE_PROVIDER_LANE, credentialFingerprint,
    });
    await store.recordEvent({
      urlKey: 'ws', tokenId: 'tok', tokenLabel: 'runner', method: 'GET', endpoint: '/api/proxy/issues/LIN-1',
      status: 200, stage: STAGE_PROVIDER_LANE, credentialFingerprint,
    });
    // Two distinct buckets are required before any verdict is trusted; only
    // the timestamp is adjusted, never the row shape under test.
    collection._docs[1].timestamp = new Date(Date.now() - 35_000);
  }

  test('a real transient provider-lane 503 row makes credential-health read degraded, end to end through the store', async () => {
    const collection = projectionFaithfulCollection();
    const store = new ProxyEventStore({ collection });
    await seedFlap(store, collection, { credentialFingerprint: 'a1b2c3d4e5f6' });

    const { occupancy } = await store.listSelfCredentialHealth('ws', 'tok');

    assert.equal(occupancy.verdict, 'degraded',
      'the endpoint must not answer ok through a live provider-lane credential rejection');
    assert.equal(occupancy.failedCalls, 1);
    assert.equal(occupancy.bucketsFaulting, 1);
  });

  test('the same lane without a fingerprint (a bare resolution-failure 503) still reads ok — the fold is unchanged for that class', async () => {
    const collection = projectionFaithfulCollection();
    const store = new ProxyEventStore({ collection });
    await seedFlap(store, collection, { credentialFingerprint: null });

    const { occupancy } = await store.listSelfCredentialHealth('ws', 'tok');

    assert.equal(occupancy.verdict, 'ok');
    assert.equal(occupancy.failedCalls, 0);
  });
});

/**
 * LIN-1938 S3 (plan-review finding fe10a599, recorded as acceptance evidence
 * rather than merely asserted): the new audit row an expired-proxy-token 401
 * writes must not contaminate `/api/proxy/credential-health` for the caller
 * whose OWN token happens to be the recognized-expired one. It is excluded
 * three independent ways — `tokenId: null` (the row names no live caller
 * token), `stage: 'proxy-token'` (not `provider-lane`), and `status: 401`
 * (not `503`) — and this test drives the real store end to end, the same
 * discipline as the LIN-2473 block above, rather than trusting the shape by
 * inspection alone.
 */
describe('LIN-1938 S3: the proxy-token-expiry audit row does not pollute credential-health', () => {
  test('a recognized-expired-token 401 row (tokenId: null, stage: proxy-token) never counts toward the fold', async () => {
    const collection = projectionFaithfulCollection();
    const store = new ProxyEventStore({ collection });

    // Exactly the shape authenticateProxyToken's rejection branch writes.
    await store.recordEvent({
      urlKey: 'ws', tokenId: null, tokenLabel: null, method: 'GET',
      endpoint: '/api/proxy/issues/LIN-1', status: 401, stage: STAGE_PROXY_TOKEN,
      note: 'expired',
    });

    // Two more rows, in TWO distinct buckets, so the fold clears the
    // OCCUPANCY_MIN_BUCKETS sample floor and reports a real verdict rather
    // than 'unknown' — otherwise 'unknown' could mean either "correctly
    // excluded" or "not enough evidence yet", and this test needs to tell
    // those apart.
    await store.recordEvent({
      urlKey: 'ws', tokenId: 'tok', tokenLabel: 'runner', method: 'GET',
      endpoint: '/api/proxy/issues/LIN-1', status: 200, stage: STAGE_PROVIDER_LANE,
      credentialFingerprint: 'fp-real-caller',
    });
    await store.recordEvent({
      urlKey: 'ws', tokenId: 'tok', tokenLabel: 'runner', method: 'GET',
      endpoint: '/api/proxy/issues/LIN-1', status: 200, stage: STAGE_PROVIDER_LANE,
      credentialFingerprint: 'fp-real-caller',
    });
    collection._docs[2].timestamp = new Date(Date.now() - 35_000);

    const { occupancy } = await store.listSelfCredentialHealth('ws', 'tok');

    assert.equal(occupancy.verdict, 'ok', 'the proxy-token-expiry row must not read as a provider-lane fault for this caller');
    assert.equal(occupancy.failedCalls, 0);
    assert.equal(occupancy.totalCalls, 2, 'only the caller\'s own 200s should be visible; the null-tokenId row is invisible to this query entirely');
  });
});
