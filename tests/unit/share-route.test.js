/**
 * Unit tests for routes/share.js (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/share-route.test.js
 *
 * Exercises the owner/revocation matrix rows 1-7, the security headers, the
 * token-format guard, revoke immediacy, the refresh throttle/single-flight,
 * zero provider reads when throttled, and the 429 limiter — via a real Express
 * app on 127.0.0.1 with a fake store + injected seams (no provider, no Mongo).
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createShareRoutes, createShareLimiters, FAILURE_BACKOFF_MS, SHARE_REFRESH_TIMEOUT_MS } from '../../routes/share.js';

const TOKEN = `${'A'.repeat(43)}`;
const OWNER_OK = async () => ({ status: 'owner' });
const NOOP_TIMEOUT = (promise) => promise;
const NOOP_LIMITER = (req, res, next) => next();

function baseRecord(overrides = {}) {
  return {
    _id: 'hash-1',
    tokenHash: 'hash-1',
    urlKey: 'ws-1',
    workspaceId: 'ws-uuid-1',
    ownerAccountId: 'acct-1',
    subject: { type: 'collection', kind: 'label', id: 'bug' },
    includeDescriptions: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt: null,
    snapshot: { title: 'OLD', items: [{ identifier: 'LIN-1', title: 'old task', state: { type: 'started' }, priority: 0, updatedAt: 'x' }] },
    snapshotAt: new Date(),
    lastRefreshAttemptAt: null,
    ...overrides
  };
}

function makeStore(record) {
  const calls = { getByToken: 0, saveSnapshot: [] };
  return {
    record,
    calls,
    async getByToken() {
      calls.getByToken++;
      return record ? { ...record } : null;
    },
    async saveSnapshot(tokenHash, snapshot, { at = new Date() } = {}) {
      calls.saveSnapshot.push({ tokenHash, snapshot, at });
      if (!record) return false;
      record.lastRefreshAttemptAt = at;
      if (snapshot != null) {
        record.snapshot = snapshot;
        record.snapshotAt = at;
      }
      return true;
    }
  };
}

function buildApp({ store, readOwnerIssues, workspaceOwnerCheck = OWNER_OK, withTimeout = NOOP_TIMEOUT, readLimiter = NOOP_LIMITER }) {
  const app = express();
  app.use(createShareRoutes({ shareStore: store, readOwnerIssues, workspaceOwnerCheck, withTimeout, readLimiter }));
  return app;
}

async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /s/:token — owner/revocation matrix', () => {
  test('row 1: unknown token → 404', async () => {
    const store = makeStore(null);
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 404);
    assert.equal(store.calls.getByToken, 1);
  });

  test('malformed token → 404 with no store read', async () => {
    const store = makeStore(baseRecord());
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, '/s/not-a-token');
    assert.equal(res.status, 404);
    assert.equal(store.calls.getByToken, 0, 'a malformed token never reaches the store');
  });

  test('row 2: revoked → 410', async () => {
    const store = makeStore(baseRecord({ revokedAt: new Date() }));
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 410);
  });

  test('row 3: owner check says not-owner / no-owner → 410 with no content', async () => {
    for (const status of ['not-owner', 'no-owner']) {
      const store = makeStore(baseRecord());
      const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }), workspaceOwnerCheck: async () => ({ status }) });
      const res = await request(app, `/s/${TOKEN}`);
      assert.equal(res.status, 410);
      assert.equal(res.body, '', `${status} must not leak content`);
    }
  });

  test('row 4: owner check throws → 503 with no content', async () => {
    const store = makeStore(baseRecord());
    const app = buildApp({
      store,
      readOwnerIssues: async () => ({ reason: 'ok', issues: [] }),
      workspaceOwnerCheck: async () => { throw new Error('store down'); }
    });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 503);
    assert.equal(res.body, '');
  });

  test('row 5: fresh snapshot serves with zero provider reads', async () => {
    let reads = 0;
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 5_000) }));
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'));
    assert.equal(reads, 0, 'a fresh snapshot never reads the provider');
  });

  test('row 6: stale snapshot + failed refresh serves last-good "as of"', async () => {
    const staleAt = new Date(Date.now() - 120_000);
    const store = makeStore(baseRecord({ snapshotAt: staleAt }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'session_expired', issues: null }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'), 'last-good content is served');
    assert.ok(res.body.includes('as of'), 'marked with the snapshot time');
    assert.ok(res.body.includes(staleAt.toISOString()));
    assert.equal(reads, 1, 'one refresh attempt');
    assert.deepEqual(store.record.snapshot, baseRecord().snapshot, 'the last-good snapshot is preserved');
  });

  test('row 6: stale snapshot + successful refresh serves the new snapshot', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000) }));
    const issues = [{ identifier: 'LIN-9', title: 'New', state: { type: 'started' }, priority: 0, updatedAt: 'x', labels: [{ name: 'bug' }] }];
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('New'));
    assert.ok(!res.body.includes('OLD'));
    assert.equal(store.record.snapshot.items[0].identifier, 'LIN-9');
  });

  test('row 7: null snapshot + failed refresh → 503 with no content', async () => {
    const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'not_connected', issues: null }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 503);
    assert.equal(res.body, '');
    assert.equal(reads, 1);
  });

  test('row 7: null snapshot while backing off → 503 with zero provider reads', async () => {
    const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null, lastRefreshAttemptAt: new Date(Date.now() - 30_000) }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 503);
    assert.equal(reads, 0, 'a recent failed attempt backs off — no provider read');
  });
});

describe('GET /s/:token — security, throttle, single-flight, limiter', () => {
  test('sets Referrer-Policy, Cache-Control and X-Robots-Tag on a served page', async () => {
    const store = makeStore(baseRecord());
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('cache-control') || '', /private/);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  });

  test('revocation takes effect immediately on the next GET', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 5_000) }));
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
    store.record.revokedAt = new Date();
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 410);
  });

  test('stale snapshot with a recent failure serves last-good without a provider read', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000), lastRefreshAttemptAt: new Date(Date.now() - 30_000) }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'));
    assert.equal(reads, 0);
  });

  test('concurrent stale GETs trigger exactly one refresh (single-flight)', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000) }));
    let reads = 0;
    const app = buildApp({
      store,
      readOwnerIssues: async () => {
        reads++;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { reason: 'ok', issues: [] };
      }
    });
    const [a, b] = await Promise.all([request(app, `/s/${TOKEN}`), request(app, `/s/${TOKEN}`)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(reads, 1, 'both concurrent requests share one refresh');
  });

  test('a failure does not hot-loop: the second GET backs off', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000) }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'store_unreachable', issues: null }; } });
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
    assert.equal(reads, 1, 'the 5-minute backoff prevents a second provider read');
  });

  test('429 after the limiter budget, via a test-constructed limiter instance', async () => {
    const store = makeStore(baseRecord());
    const readLimiter = createShareLimiters({ max: 2, skip: () => false }).read;
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }), readLimiter });
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
    assert.equal((await request(app, `/s/${TOKEN}`)).status, 429);
  });
});

// =============================================================================
// Review ledger L1 / L2 / L4 (LIN-3243 corrective).
//
// These pin behaviours the first-round mutation check found were NOT actually
// load-bearing: the 5-minute failure backoff (M5), the injected timeout (M9),
// and a throwing store write inside refresh() (L4).
// =============================================================================
describe('GET /s/:token — backoff, timeout and store-write failure', () => {
  test('L1: a failed attempt 120s old is still inside FAILURE_BACKOFF_MS → zero provider reads', async () => {
    assert.equal(FAILURE_BACKOFF_MS, 300_000, 'the backoff window is 5 minutes');
    const now = Date.now();
    // A failed attempt (attempt newer than the last success) 120s ago: past the
    // 60s minimum, well inside the 300s failure backoff.
    const store = makeStore(baseRecord({
      snapshotAt: new Date(now - 200_000),
      lastRefreshAttemptAt: new Date(now - 120_000)
    }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'), 'last-good is served');
    assert.equal(reads, 0, '120s-old failure must still back off — no provider read');
  });

  test('L1: a failed attempt 301s old is due → exactly one provider read', async () => {
    const now = Date.now();
    const store = makeStore(baseRecord({
      snapshotAt: new Date(now - 400_000),
      lastRefreshAttemptAt: new Date(now - 301_000)
    }));
    let reads = 0;
    const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(reads, 1, 'past the 300s backoff the refresh runs once');
  });

  test('L2: refresh is bounded by the injected withTimeout(…, SHARE_REFRESH_TIMEOUT_MS); row 7 → 503', async () => {
    assert.equal(SHARE_REFRESH_TIMEOUT_MS, 50_000, 'the refresh budget is the proxy multi-request budget');
    const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null }));
    const calls = [];
    const withTimeout = (promise, ms) => { calls.push(ms); return Promise.reject(new Error('timed out')); };
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }), withTimeout });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 503, 'null snapshot + a timed-out refresh → row 7');
    assert.deepEqual(calls, [SHARE_REFRESH_TIMEOUT_MS], 'withTimeout receives the refresh budget');
  });

  test('L2: row 6 holds when the injected timeout rejects — stale snapshot serves last-good', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000) }));
    const calls = [];
    const withTimeout = (promise, ms) => { calls.push(ms); return Promise.reject(new Error('timed out')); };
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }), withTimeout });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'), 'last-good is served on a timed-out refresh');
    assert.deepEqual(calls, [SHARE_REFRESH_TIMEOUT_MS]);
  });

  test('L4: a throwing saveSnapshot with a null snapshot → 503 (row 7), not 500', async () => {
    const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null }));
    store.saveSnapshot = async () => { throw new Error('mongo down'); };
    const issues = [{ identifier: 'LIN-9', title: 'x', state: { type: 'started' }, priority: 0, updatedAt: 'x', labels: [{ name: 'bug' }] }];
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 503);
    assert.equal(res.body, '');
  });

  test('L4: a throwing saveSnapshot with a stale snapshot → 200 last-good (row 6)', async () => {
    const store = makeStore(baseRecord({ snapshotAt: new Date(Date.now() - 120_000) }));
    store.saveSnapshot = async () => { throw new Error('mongo down'); };
    const app = buildApp({ store, readOwnerIssues: async () => ({ reason: 'ok', issues: [] }) });
    const res = await request(app, `/s/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('OLD'));
  });

  test('saveSnapshot throws on a stale snapshot: bounded reads, then a 2nd read after the window', async () => {
    const now = Date.now();
    mock.timers.enable({ apis: ['Date'], now });
    try {
      const store = makeStore(baseRecord({ snapshotAt: new Date(now - 120_000) }));
      store.saveSnapshot = async () => { throw new Error('mongo down'); };
      let reads = 0;
      const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });

      for (let i = 0; i < 10; i++) {
        const res = await request(app, `/s/${TOKEN}`);
        assert.equal(res.status, 200, `GET ${i + 1} serves last-good`);
        assert.ok(res.body.includes('OLD'));
      }
      assert.equal(reads, 1, 'ten sequential write failures perform only one provider read');

      mock.timers.tick(301_000);
      assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
      assert.equal(reads, 2, 'past FAILURE_BACKOFF_MS a retry is allowed');
      assert.equal((await request(app, `/s/${TOKEN}`)).status, 200);
      assert.equal(reads, 2, 'the retry re-arms the backoff');
    } finally {
      mock.timers.reset();
    }
  });

  test('saveSnapshot throws on a null snapshot: 503, 1 read', async () => {
    const now = Date.now();
    mock.timers.enable({ apis: ['Date'], now });
    try {
      const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null }));
      store.saveSnapshot = async () => { throw new Error('mongo down'); };
      let reads = 0;
      const app = buildApp({ store, readOwnerIssues: async () => { reads++; return { reason: 'ok', issues: [] }; } });

      for (let i = 0; i < 10; i++) {
        const res = await request(app, `/s/${TOKEN}`);
        assert.equal(res.status, 503, `GET ${i + 1} has no content to serve`);
        assert.equal(res.body, '');
      }
      assert.equal(reads, 1, 'ten sequential write failures perform only one provider read');
    } finally {
      mock.timers.reset();
    }
  });

  test('buildShareSnapshot throws, on both stale and null snapshots', async () => {
    const now = Date.now();
    mock.timers.enable({ apis: ['Date'], now });
    try {
      const badSubject = { type: 'collection', kind: 'bogus', id: 'x' };

      const staleStore = makeStore(baseRecord({ subject: badSubject, snapshotAt: new Date(now - 120_000) }));
      let staleReads = 0;
      const staleApp = buildApp({ store: staleStore, readOwnerIssues: async () => { staleReads++; return { reason: 'ok', issues: [] }; } });
      for (let i = 0; i < 10; i++) {
        const res = await request(staleApp, `/s/${TOKEN}`);
        assert.equal(res.status, 200);
        assert.ok(res.body.includes('OLD'));
      }
      assert.equal(staleReads, 1, 'a throwing build on a stale snapshot is bounded to one read');

      const nullStore = makeStore(baseRecord({ subject: badSubject, snapshot: null, snapshotAt: null }));
      let nullReads = 0;
      const nullApp = buildApp({ store: nullStore, readOwnerIssues: async () => { nullReads++; return { reason: 'ok', issues: [] }; } });
      for (let i = 0; i < 10; i++) {
        const res = await request(nullApp, `/s/${TOKEN}`);
        assert.equal(res.status, 503);
      }
      assert.equal(nullReads, 1, 'a throwing build on a null snapshot is bounded to one read');
    } finally {
      mock.timers.reset();
    }
  });

  test('concurrent GETs on a null snapshot while the read is in flight: both 200, 1 read', async () => {
    const store = makeStore(baseRecord({ snapshot: null, snapshotAt: null }));
    let reads = 0;
    const app = buildApp({
      store,
      readOwnerIssues: async () => {
        reads++;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { reason: 'ok', issues: [{ identifier: 'LIN-9', title: 'New', state: { type: 'started' }, priority: 0, updatedAt: 'x', labels: [{ name: 'bug' }] }] };
      }
    });
    const [a, b] = await Promise.all([request(app, `/s/${TOKEN}`), request(app, `/s/${TOKEN}`)]);
    assert.equal(a.status, 200, 'the winner serves the refreshed snapshot');
    assert.equal(b.status, 200, 'the joiner joins the in-flight refresh instead of 503');
    assert.equal(reads, 1, 'both concurrent requests share one refresh');
  });
});

