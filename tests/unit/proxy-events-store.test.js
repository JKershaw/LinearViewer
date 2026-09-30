/**
 * Unit tests for lib/proxy-events.js (ProxyEventStore)
 *
 * Run with: node --test tests/unit/proxy-events-store.test.js
 *
 * Exercises the real ProxyEventStore. Focus (LIN-961): the optional `note`
 * breadcrumb round-trips through recordEvent → listEvents while the numeric
 * `status` is left untouched, and legacy events without a note read back as null.
 *
 * LIN-3162 (LIN-3157 A2): listEvents became a database-side paged read keyed on
 * the shared read horizon, and the credential-health reads dropped their
 * redundant expiry predicate. Those query tests run on a REAL MangoDB tmpdir
 * (tests/fixtures/mango-tmpdir.js) — the old inline double ignored unknown
 * operators, had a `toArray()`-only cursor and no `countDocuments`.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProxyEventStore, CREDENTIAL_HEALTH_WINDOW_MS, OWNERLESS_NOTE, STAGE_PROVIDER_LANE } from '../../lib/proxy-events.js';
import { createMangoTmpdir, recordingCollection } from '../fixtures/mango-tmpdir.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Note breadcrumb (LIN-961) ────────────────────────────────────────────────

describe('ProxyEventStore note breadcrumb (LIN-961, real MangoDB tmpdir)', () => {
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-events-note-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('proxy-events');
    store = new ProxyEventStore({ collection: raw });
  });

  test('records and reads back a free-tier breadcrumb note without touching status', async () => {
    await store.recordEvent({
      urlKey: 'ws1',
      endpoint: '/api/proxy/recommend',
      status: 200,
      note: 'free-tier fallback: no paid/OAuth key resolved'
    });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].status, 200);
    assert.strictEqual(items[0].note, 'free-tier fallback: no paid/OAuth key resolved');
  });

  test('an event without a note reads back note:null (backward compatible)', async () => {
    await store.recordEvent({ urlKey: 'ws1', endpoint: '/api/proxy/issues', status: 200 });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items[0].note, null);
  });

  test('a legacy doc missing the note field entirely still lists as note:null', async () => {
    await raw.insertOne({
      _id: 'legacy-1',
      urlKey: 'ws1',
      tokenId: null,
      tokenLabel: null,
      method: 'GET',
      endpoint: '/api/proxy/recap',
      status: 429,
      timestamp: new Date(Date.now() - 60 * 1000),
      expiresAt: new Date(Date.now() + DAY_MS)
    });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items[0].note, null);
    assert.strictEqual(items[0].status, 429);
  });
});

// ── listEvents (C4 #6, treatment P) ──────────────────────────────────────────

describe('ProxyEventStore.listEvents (real MangoDB tmpdir, LIN-3162 A2)', () => {
  let harness;
  let raw;
  let collection;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-events-list-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('proxy-events');
    collection = recordingCollection(raw);
    store = new ProxyEventStore({ collection });
  });

  async function seed({ expiresAt, ...doc }) {
    const timestamp = doc.timestamp || new Date();
    const out = {
      urlKey: 'ws1', tokenId: 'tok-1', tokenLabel: 'worker', method: 'GET',
      endpoint: '/api/proxy/me', status: 200, note: null, ...doc, timestamp
    };
    out.expiresAt = expiresAt !== undefined ? expiresAt : new Date(timestamp.getTime() + 30 * DAY_MS);
    await raw.insertOne(out);
  }

  test('the item shape is exactly the eight documented fields, newest-first', async () => {
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await seed({ _id: `e${i}`, tokenId: `tok-${i}`, tokenLabel: `label-${i}`, endpoint: `/api/proxy/e${i}`, note: i === 0 ? OWNERLESS_NOTE : null, timestamp: new Date(base + i * 1000) });
    }
    const { items, total } = await store.listEvents('ws1');
    assert.strictEqual(total, 3);
    assert.deepStrictEqual(items.map(i => i.id), ['e2', 'e1', 'e0']);
    assert.deepStrictEqual(Object.keys(items[0]).sort(),
      ['endpoint', 'id', 'method', 'note', 'status', 'timestamp', 'tokenId', 'tokenLabel'].sort());
  });

  test('the query is urlKey-only: no default horizon bound, no expiry predicate (LIN-3163 B)', async () => {
    await seed({ _id: 'e0' });
    await store.listEvents('ws1');
    const { query, options } = collection.__record.finds.at(-1);
    assert.deepStrictEqual(Object.keys(query).sort(), ['urlKey'], 'the default 30-day `since` bound is gone; the expiry predicate is gone');
    assert.strictEqual(options, undefined, 'listEvents is still unprojected');
  });

  test('pages over the full retained history: a >30d row is listed and counted (LIN-3163 B)', async () => {
    const now = Date.now();
    await seed({ _id: 'no-stamp', timestamp: new Date(now - 5 * DAY_MS), expiresAt: undefined });
    await seed({ _id: 'old-live', timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });

    const { items, total } = await store.listEvents('ws1');
    assert.strictEqual(total, 2);
    assert.deepStrictEqual(items.map(i => i.id), ['no-stamp', 'old-live']);
  });

  test('limit/offset paging works', async () => {
    const base = Date.now();
    for (let i = 0; i < 3; i++) await seed({ _id: `e${i}`, timestamp: new Date(base - i * 1000) });
    const page = await store.listEvents('ws1', { limit: 2, offset: 1 });
    assert.strictEqual(page.total, 3);
    assert.deepStrictEqual(page.items.map(i => i.id), ['e1', 'e2']);
  });

  test('pages in the database: sort().skip().limit() plus countDocuments, no full materialisation (A2)', async () => {
    const base = Date.now();
    for (let i = 0; i < 25; i++) await seed({ _id: `e${i}`, timestamp: new Date(base - i * 1000) });

    const { items, total } = await store.listEvents('ws1', { limit: 5, offset: 10 });
    const cursor = collection.__record.cursors.at(-1);
    assert.deepStrictEqual(cursor.sorts, [{ timestamp: -1, _id: -1 }]);
    assert.deepStrictEqual(cursor.skips, [10]);
    assert.deepStrictEqual(cursor.limits, [5]);
    assert.strictEqual(cursor.materialized, 5, 'only the page may be materialised');
    assert.strictEqual(collection.__record.countDocuments.length, 1, 'total must come from countDocuments');
    assert.strictEqual(total, 25);
    assert.strictEqual(items.length, 5);
  });

  test('same-millisecond rows order by _id descending and page without duplicates or gaps (A2)', async () => {
    const now = Date.now();
    const ts = new Date(now - 1000);
    for (const id of ['c', 'a', 'b']) {
      await seed({ _id: id, timestamp: ts, expiresAt: new Date(now + DAY_MS) });
    }
    const p0 = await store.listEvents('ws1', { limit: 1, offset: 0 });
    const p1 = await store.listEvents('ws1', { limit: 1, offset: 1 });
    const p2 = await store.listEvents('ws1', { limit: 1, offset: 2 });
    assert.deepStrictEqual([p0.items[0].id, p1.items[0].id, p2.items[0].id], ['c', 'b', 'a']);
    assert.strictEqual(new Set([p0.items[0].id, p1.items[0].id, p2.items[0].id]).size, 3);
  });

  test('running the credential-health read first does not perturb listEvents', async () => {
    const base = Date.now();
    await seed({ _id: 'e0', timestamp: new Date(base) });
    const before = await store.listEvents('ws1');
    await store.listCredentialHealth('ws1');
    const after = await store.listEvents('ws1');
    assert.deepStrictEqual(after, before);
  });
});

// ── Credential health (C4 #8): the redundant expiry predicate is dropped ──────

describe('ProxyEventStore.listCredentialHealth (LIN-1586, real MangoDB tmpdir)', () => {
  let harness;
  let raw;
  let collection;
  let store;
  const minsAgo = (n) => new Date(Date.now() - n * 60 * 1000);

  before(async () => {
    harness = createMangoTmpdir('lin-3162-cred-health-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('proxy-events');
    collection = recordingCollection(raw);
    store = new ProxyEventStore({ collection });
  });

  async function seed({ expiresAt, ...doc }) {
    const timestamp = doc.timestamp || minsAgo(1);
    const out = {
      urlKey: 'ws1', tokenId: 'tok-1', tokenLabel: 'worker', method: 'GET',
      endpoint: '/api/proxy/me', status: 200, note: null, ...doc, timestamp
    };
    out.expiresAt = expiresAt !== undefined ? expiresAt : new Date(timestamp.getTime() + 30 * DAY_MS);
    await raw.insertOne(out);
  }

  test('reports credential_dead for a token with an ownerless note AND a success in the window', async () => {
    await seed({ _id: 'a', status: 201, timestamp: minsAgo(1) });
    await seed({ _id: 'b', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(2) });

    const result = await store.listCredentialHealth('ws1');
    assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS);
    assert.deepStrictEqual(result.tokens[0], {
      tokenId: 'tok-1',
      tokenLabel: 'worker',
      ownerlessCount: 1,
      okCount: 1,
      verdict: 'credential_dead'
    });
  });

  test('the read is time-bounded and no longer carries the expiry predicate (A2)', async () => {
    const windowMins = CREDENTIAL_HEALTH_WINDOW_MS / 60000;
    await seed({ _id: 'a', status: 200, timestamp: minsAgo(1) });
    await seed({ _id: 'b', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(windowMins + 10) });

    const result = await store.listCredentialHealth('ws1');
    assert.strictEqual(result.tokens[0].ownerlessCount, 0);
    assert.strictEqual(result.tokens[0].verdict, 'ok');

    const { query } = collection.__record.finds.at(-1);
    assert.ok(query.timestamp?.$gt instanceof Date, 'query must carry a timestamp lower bound');
    assert.strictEqual(query.expiresAt, undefined, 'the redundant expiry predicate is gone');
    assert.strictEqual(query.urlKey, 'ws1');
  });

  test('reads a row with no expiresAt field inside the window (A2)', async () => {
    await seed({ _id: 'no-stamp', status: 200, timestamp: minsAgo(1), expiresAt: undefined });
    const result = await store.listCredentialHealth('ws1');
    assert.strictEqual(result.tokens.length, 1);
    assert.strictEqual(result.tokens[0].okCount, 1);
  });

  test('an explicit windowMs widens the read; a junk one falls back to the default', async () => {
    const windowMins = CREDENTIAL_HEALTH_WINDOW_MS / 60000;
    await seed({ _id: 'a', status: 200, timestamp: minsAgo(1) });
    await seed({ _id: 'b', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(windowMins + 10) });

    const wide = await store.listCredentialHealth('ws1', { windowMs: 6 * 60 * 60 * 1000 });
    assert.strictEqual(wide.windowMs, 6 * 60 * 60 * 1000);
    assert.strictEqual(wide.tokens[0].verdict, 'credential_dead');

    for (const bad of [0, -1, NaN, 'soon', null]) {
      const result = await store.listCredentialHealth('ws1', { windowMs: bad });
      assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS, `windowMs ${bad} must fall back`);
    }
  });

  test('the returned verdict carries counts only — no endpoints, no method, no urlKey', async () => {
    await seed({ _id: 'a', status: 200, timestamp: minsAgo(1) });
    const [entry] = (await store.listCredentialHealth('ws1')).tokens;
    assert.deepStrictEqual(Object.keys(entry).sort(),
      ['okCount', 'ownerlessCount', 'tokenId', 'tokenLabel', 'verdict']);
  });

  test('legacy docs with no note field at all read as ok, not as a fault', async () => {
    await raw.insertOne({
      _id: 'legacy-1', urlKey: 'ws1', tokenId: 'tok-legacy', tokenLabel: 'old',
      status: 200, timestamp: minsAgo(1), expiresAt: new Date(Date.now() + DAY_MS)
    });
    const [entry] = (await store.listCredentialHealth('ws1')).tokens;
    assert.strictEqual(entry.ownerlessCount, 0);
    assert.strictEqual(entry.okCount, 1);
    assert.strictEqual(entry.verdict, 'ok');
  });

  test('scopes to the workspace: another workspace\'s dead credential does not leak in', async () => {
    await seed({ _id: 'a', urlKey: 'ws2', tokenId: 'other', status: 200, timestamp: minsAgo(1) });
    await seed({ _id: 'b', urlKey: 'ws2', tokenId: 'other', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(2) });
    await seed({ _id: 'c', urlKey: 'ws1', tokenId: 'mine', status: 200, timestamp: minsAgo(1) });

    const result = await store.listCredentialHealth('ws1');
    assert.deepStrictEqual(result.tokens.map(t => t.tokenId), ['mine']);
  });

  test('no urlKey returns an empty verdict list without querying', async () => {
    const result = await store.listCredentialHealth('');
    assert.deepStrictEqual(result.tokens, []);
    assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS);
    assert.strictEqual(collection.__record.finds.length, 0);
  });

  test('a store error degrades to an empty verdict list (the page must still render)', async () => {
    const broken = new ProxyEventStore({
      collection: { find() { throw new Error('collection is down'); } }
    });
    const result = await broken.listCredentialHealth('ws1');
    assert.deepStrictEqual(result, { windowMs: CREDENTIAL_HEALTH_WINDOW_MS, tokens: [] });
  });
});

describe('ProxyEventStore.listSelfCredentialHealth (LIN-2076, real MangoDB tmpdir)', () => {
  let harness;
  let raw;
  let collection;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-self-health-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('proxy-events');
    collection = recordingCollection(raw);
    store = new ProxyEventStore({ collection });
  });

  test('reads a provider-lane row with no expiresAt and drops the expiry predicate (A2)', async () => {
    await raw.insertOne({
      _id: 'no-stamp', urlKey: 'ws', tokenId: 'tok', stage: STAGE_PROVIDER_LANE,
      status: 201, note: null, timestamp: new Date(Date.now() - 1000)
    });

    const { occupancy } = await store.listSelfCredentialHealth('ws', 'tok');
    const { query } = collection.__record.finds.at(-1);
    assert.ok(Array.isArray(query.$or), 'the stage/status union filter is preserved');
    assert.strictEqual(query.expiresAt, undefined, 'the redundant expiry predicate is gone');
    assert.strictEqual(occupancy.totalCalls, 1, 'the no-expiresAt provider-lane row is read');
  });
});

// ---------------------------------------------------------------------------
// LIN-3163 (B): lifetime retention — no expiry stamp, no evictor.
// ---------------------------------------------------------------------------

describe('ProxyEventStore lifetime retention (LIN-3163 B)', () => {
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3163-proxy-events-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('proxy-events');
    store = new ProxyEventStore({ collection: raw });
  });

  test('recordEvent writes no expiresAt stamp', async () => {
    const doc = await store.recordEvent({ urlKey: 'ws1', endpoint: '/x', status: 200 });
    assert.ok(!('expiresAt' in doc), 'a lifetime-retained event carries no expiresAt stamp');
    const stored = await raw.findOne({ _id: doc._id });
    assert.ok(!('expiresAt' in stored), 'the persisted row carries no expiresAt stamp');
  });

  test('the cleanup evictor is gone', () => {
    assert.strictEqual(typeof ProxyEventStore.prototype.cleanup, 'undefined', 'cleanup must be deleted from the store');
    assert.strictEqual(typeof store.cleanup, 'undefined');
  });
});
