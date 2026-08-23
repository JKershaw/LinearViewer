/**
 * LIN-1746 — a proxy-token-authenticated worker can now read its own
 * "am I permanently dead as a workspace credential" signal for the
 * non-ownerless death class (session_expired / owner_signed_out /
 * owner_mismatch / not_connected), which arrives as a 503 BEFORE any
 * provider-lane credential resolves — invisible to LIN-2076's
 * providerLaneOccupancy (stage-filtered to 'provider-lane') and outside
 * credentialVerdict's ownerless-only model.
 *
 * Block A: lib/proxy-events.js's recentFailureReasons (pure).
 * Block B: GET /api/proxy/credential-health's extended response (route-level).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  recentFailureReasons,
  RECENT_REASON_MIN_STREAK,
  ProxyEventStore,
} from '../../lib/proxy-events.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const NOW = Date.parse('2026-08-23T16:00:00.000Z');

function row(offsetMsBeforeNow, status, note) {
  return { status, note, timestamp: new Date(NOW - offsetMsBeforeNow) };
}

describe('recentFailureReasons (LIN-1746, Block A)', () => {
  test('unknown when there is no evidence at all — never a false verdict from silence', () => {
    const result = recentFailureReasons([], { now: NOW });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.dominantReason, null);
    assert.equal(result.totalFailures, 0);
  });

  test('a SINGLE failure stays unknown — genuinely ambiguous between transient and dead (this ticket\'s own framing)', () => {
    const rows = [row(1000, 503, 'session_expired')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.dominantReason, null);
    assert.deepEqual(result.reasons, { session_expired: 1 });
    assert.equal(result.totalFailures, 1);
  });

  test(`${RECENT_REASON_MIN_STREAK} repeats of the SAME reason -> likely_dead, naming the reason`, () => {
    const rows = [row(1000, 503, 'owner_mismatch'), row(2000, 503, 'owner_mismatch')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.verdict, 'likely_dead');
    assert.equal(result.dominantReason, 'owner_mismatch');
    assert.equal(result.reasons.owner_mismatch, 2);
  });

  test('a MIX of different reasons never crosses the streak threshold for any single one — stays unknown', () => {
    const rows = [row(1000, 503, 'session_expired'), row(2000, 503, 'owner_mismatch'), row(3000, 503, 'not_connected')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.dominantReason, null);
    assert.equal(result.totalFailures, 3);
  });

  test('the DOMINANT reason is named even among a mix, once it alone crosses the streak', () => {
    const rows = [
      row(1000, 503, 'owner_signed_out'), row(2000, 503, 'owner_signed_out'), row(3000, 503, 'owner_signed_out'),
      row(4000, 503, 'not_connected'),
    ];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.verdict, 'likely_dead');
    assert.equal(result.dominantReason, 'owner_signed_out');
    assert.equal(result.reasons.owner_signed_out, 3);
    assert.equal(result.reasons.not_connected, 1);
  });

  // Found by code review: `rows` arrives from an unsorted Mongo find() in
  // production, so a count-tie between two reasons must not resolve by
  // incidental iteration order.
  test('a COUNT TIE between two reasons breaks deterministically toward whichever one\'s MOST RECENT occurrence is more recent', () => {
    const rows = [
      // owner_mismatch: most recent hit at offset 500 (i.e. closer to `now`)
      row(500, 503, 'owner_mismatch'), row(4000, 503, 'owner_mismatch'),
      // session_expired: most recent hit at offset 1000 — older than owner_mismatch's
      row(1000, 503, 'session_expired'), row(3000, 503, 'session_expired'),
    ];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.reasons.owner_mismatch, 2);
    assert.equal(result.reasons.session_expired, 2);
    assert.equal(result.dominantReason, 'owner_mismatch', 'tied on count 2-2; owner_mismatch\'s latest hit (offset 500) is more recent than session_expired\'s (offset 1000)');

    // Same data, rows supplied in the OPPOSITE order — the tie-break must not
    // depend on which one the loop happened to see first.
    const reordered = [...rows].reverse();
    const reorderedResult = recentFailureReasons(reordered, { now: NOW });
    assert.equal(reorderedResult.dominantReason, 'owner_mismatch', 'row order must not change the outcome');
  });

  // Found by code review (round 5): two reasons can tie on BOTH count and
  // latest-occurrence timestamp (rows sharing the exact same millisecond),
  // which would otherwise fall back to Object.entries' insertion order —
  // itself downstream of the unsorted Mongo find()'s row order.
  test('a tie on BOTH count and latest-occurrence timestamp breaks deterministically, alphabetically by reason name', () => {
    const rows = [
      // owner_mismatch: 2 hits, most recent at offset 500
      row(500, 503, 'owner_mismatch'), row(2000, 503, 'owner_mismatch'),
      // not_connected: 2 hits, most recent ALSO at offset 500 — the same millisecond
      row(500, 503, 'not_connected'), row(3000, 503, 'not_connected'),
    ];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.reasons.owner_mismatch, 2);
    assert.equal(result.reasons.not_connected, 2);
    assert.equal(result.dominantReason, 'not_connected', '"not_connected" < "owner_mismatch" alphabetically, tied on count and latest timestamp');

    const reordered = [...rows].reverse();
    const reorderedResult = recentFailureReasons(reordered, { now: NOW });
    assert.equal(reorderedResult.dominantReason, 'not_connected', 'row order must not change the outcome');
  });

  test('a 401 (a different failure class entirely) is never counted here — this reads workspaceUnavailable 503s only', () => {
    const rows = [row(1000, 401, 'provider-401'), row(2000, 401, 'provider-401')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 0);
    assert.equal(result.verdict, 'unknown');
  });

  test('a 503 with no note (should not occur — workspaceUnavailable always attaches one — but defensive) is skipped, not counted', () => {
    const rows = [row(1000, 503, null), row(2000, 503, undefined)];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 0);
  });

  test('a successful (2xx) row is never counted', () => {
    const rows = [row(1000, 200, null)];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 0);
  });

  // Found by code review: an earlier revision counted EVERY 503 reason,
  // including two the function's own doc explicitly excludes.
  test('token_ownerless 503s are NEVER counted — a distinct fault (the calling token, not the workspace credential) with its own LIN-1448 remedy (re-issue the token, not re-dispatch)', () => {
    const rows = [row(1000, 503, 'token_ownerless'), row(2000, 503, 'token_ownerless'), row(3000, 503, 'token_ownerless')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 0);
    assert.equal(result.verdict, 'unknown');
  });

  test('store_unreachable 503s are NEVER counted — a transient infra blip, not a credential-death signal', () => {
    const rows = [row(1000, 503, 'store_unreachable'), row(2000, 503, 'store_unreachable'), row(3000, 503, 'store_unreachable')];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 0);
    assert.equal(result.verdict, 'unknown');
  });

  test('a mix of excluded and included reasons only tallies the included ones', () => {
    const rows = [
      row(1000, 503, 'token_ownerless'), row(2000, 503, 'store_unreachable'),
      row(3000, 503, 'owner_mismatch'), row(4000, 503, 'owner_mismatch'),
    ];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 2);
    assert.deepEqual(result.reasons, { owner_mismatch: 2 });
    assert.equal(result.verdict, 'likely_dead');
    assert.equal(result.dominantReason, 'owner_mismatch');
  });

  test('rows outside the window are dropped', () => {
    const rows = [row(1000, 503, 'session_expired'), row(20 * 60 * 1000, 503, 'session_expired')];
    const result = recentFailureReasons(rows, { now: NOW, windowMs: 5 * 60 * 1000 });
    assert.equal(result.totalFailures, 1, 'only the row inside the 5-minute window counts');
  });

  // Found by code review: providerLaneOccupancy floors its window at 60s
  // (resolveOccupancyWindow) but this function originally used the UNFLOORED
  // resolveCredentialHealthWindow — a caller-requested sub-60s window would
  // silently bypass the floor this endpoint's own docs promise for BOTH
  // halves, letting a bursty failure pattern alias into a flip-flopping
  // verdict exactly the way the floor exists to prevent for occupancy.
  test('a requested window under 60s is floored, not honoured literally — matches providerLaneOccupancy\'s own floor', () => {
    const rows = [row(1000, 503, 'session_expired'), row(50_000, 503, 'session_expired')];
    const result = recentFailureReasons(rows, { now: NOW, windowMs: 5000 });
    assert.equal(result.windowMs, 60_000, 'floored to 60s, not honoured literally at 5s');
    assert.equal(result.totalFailures, 2, 'both rows fall inside the floored 60s window even though 5s was requested');
  });

  // Found by code review (round 4): providerLaneOccupancy guards against a
  // row timestamped AHEAD of the injected `now` (dyno clock skew); this
  // function originally lacked the same guard, so a future-stamped row
  // could push a reason to the streak threshold one failure earlier than
  // its sibling ever would for the identical event stream.
  test('a row timestamped AHEAD of `now` (clock skew) is excluded, matching providerLaneOccupancy\'s own guard', () => {
    const rows = [
      row(1000, 503, 'session_expired'),
      row(-5000, 503, 'session_expired'), // 5s in the future relative to NOW
    ];
    const result = recentFailureReasons(rows, { now: NOW });
    assert.equal(result.totalFailures, 1, 'the future-stamped row must not count');
    assert.equal(result.verdict, 'unknown', 'only one legitimate failure remains — below the streak threshold');
  });
});

// ---------------------------------------------------------------------------
// Block B — GET /api/proxy/credential-health (route-level)
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  const proxyEventStore = new ProxyEventStore({ collection: fakeCollection() });

  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async (bearer) => ({ tokenId: bearer, urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' }),
    },
    proxyEventStore,
    resolveWorkspaceAccess: async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    }),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: { name: 'linear', supports: () => true, viewer: async () => ({ id: 'u1' }) },
  }));
  return { app, proxyEventStore };
}

function fakeCollection() {
  const docs = [];
  const collection = {
    docs,
    findCalls: [],
    insertOne: async (doc) => { docs.push(doc); return { insertedId: doc._id }; },
    find: (query = {}, opts = {}) => ({
      toArray: async () => {
        collection.findCalls.push(query);
        let matched = docs.filter(d => {
          if (query.urlKey !== undefined && d.urlKey !== query.urlKey) return false;
          if (query.tokenId !== undefined && d.tokenId !== query.tokenId) return false;
          if (query.stage !== undefined && d.stage !== query.stage) return false;
          if (query.status !== undefined && d.status !== query.status) return false;
          if (query.expiresAt && d.expiresAt <= query.expiresAt.$gt) return false;
          if (query.timestamp && d.timestamp <= query.timestamp.$gt) return false;
          if (query.$or && !query.$or.some(clause => Object.entries(clause).every(([k, v]) => d[k] === v))) return false;
          return true;
        });
        if (opts.projection) {
          const keys = Object.keys(opts.projection);
          matched = matched.map(d => Object.fromEntries(keys.map(k => [k, d[k]])));
        }
        return matched;
      },
    }),
  };
  return collection;
}

async function request(app, path, bearer) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/proxy/credential-health — workspaceAccess extension (LIN-1746, Block B)', () => {
  test('a token with no history at all reads workspaceAccess.verdict:"unknown"', async () => {
    const { app } = buildApp();
    const { status, body } = await request(app, '/api/proxy/credential-health', 'token-a');
    assert.equal(status, 200);
    assert.equal(body.workspaceAccess.verdict, 'unknown');
    assert.equal(body.workspaceAccess.totalFailures, 0);
  });

  test('repeated owner_mismatch 503s for THIS token surface as likely_dead', async () => {
    const { app, proxyEventStore } = buildApp();
    const now = Date.now();
    const seed = async (offsetMs) => {
      const doc = await proxyEventStore.recordEvent({
        urlKey: 'acme', tokenId: 'token-a', tokenLabel: 'x', method: 'GET', endpoint: '/api/proxy/issues',
        status: 503, note: 'owner_mismatch',
      });
      doc.timestamp = new Date(now - offsetMs);
    };
    await seed(1000);
    await seed(2000);

    const { body } = await request(app, '/api/proxy/credential-health', 'token-a');
    assert.equal(body.workspaceAccess.verdict, 'likely_dead');
    assert.equal(body.workspaceAccess.dominantReason, 'owner_mismatch');
  });

  // Found by code review: an earlier revision issued TWO separate find()
  // calls (one per half) against the same collection/tokenId on every poll
  // of a route explicitly meant to be cheap enough to poll.
  test('exactly ONE find() query serves BOTH halves of the response — not two', async () => {
    const { app, proxyEventStore } = buildApp();
    await request(app, '/api/proxy/credential-health', 'token-a');
    assert.equal(proxyEventStore.collection.findCalls.length, 1, `expected exactly 1 find() call, saw ${proxyEventStore.collection.findCalls.length}`);
  });

  // Found by code review (round 5): the consolidated query fetched EVERY row
  // for (urlKey, tokenId) in the window with no stage/status filter at all —
  // wasted I/O on a route documented as "cheap enough to poll" for a busy
  // token's unrelated stage:'proxy-token' 2xx traffic (dispatch polling,
  // /api/proxy/status, …), which neither half's fold needs.
  test('the query is scoped to only the rows either half could ever use — not every row for this token', async () => {
    const { app, proxyEventStore } = buildApp();
    await proxyEventStore.recordEvent({
      urlKey: 'acme', tokenId: 'token-a', tokenLabel: 'x', method: 'GET', endpoint: '/api/proxy/status',
      status: 200, stage: 'proxy-token',
    });
    await request(app, '/api/proxy/credential-health', 'token-a');
    const query = proxyEventStore.collection.findCalls[0];
    assert.ok(query.$or, 'expected the query to union the two halves\' row shapes via $or');
    const irrelevant = { stage: 'proxy-token', status: 200 };
    assert.ok(
      !query.$or.some(clause => Object.entries(clause).every(([k, v]) => irrelevant[k] === v)),
      'a stage:proxy-token 2xx row must not match either $or clause'
    );
  });

  test('bounded to the calling token — another token\'s owner_mismatch history never leaks in', async () => {
    const { app, proxyEventStore } = buildApp();
    const now = Date.now();
    const seed = async (tokenId, offsetMs) => {
      const doc = await proxyEventStore.recordEvent({
        urlKey: 'acme', tokenId, tokenLabel: 'x', method: 'GET', endpoint: '/api/proxy/issues',
        status: 503, note: 'owner_mismatch',
      });
      doc.timestamp = new Date(now - offsetMs);
    };
    await seed('token-b', 1000);
    await seed('token-b', 2000);
    await seed('token-b', 3000);

    const { body } = await request(app, '/api/proxy/credential-health', 'token-a');
    assert.equal(body.workspaceAccess.verdict, 'unknown');
    assert.equal(body.workspaceAccess.totalFailures, 0);
  });

  test('the existing top-level providerLaneOccupancy fields are unchanged by this addition — additive, not a reshape', async () => {
    const { app } = buildApp();
    const { body } = await request(app, '/api/proxy/credential-health', 'token-a');
    assert.ok('verdict' in body);
    assert.ok('occupancy' in body);
    assert.ok('bucketMs' in body);
    assert.ok('workspaceAccess' in body);
  });
});
