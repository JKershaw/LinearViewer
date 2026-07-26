/**
 * Unit tests for lib/proxy-events.js (ProxyEventStore)
 *
 * Run with: node --test tests/unit/proxy-events-store.test.js
 *
 * Exercises the real ProxyEventStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface. Focus (LIN-961): the optional `note`
 * breadcrumb round-trips through recordEvent → listEvents while the numeric
 * `status` is left untouched, and legacy events without a note read back as null.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProxyEventStore, CREDENTIAL_HEALTH_WINDOW_MS, OWNERLESS_NOTE } from '../../lib/proxy-events.js';

// Minimal in-memory mock of the collection surface the store uses.
// `_finds` records every (query, options) pair so a test can pin the read shape
// itself — the time bound and the projection are the point of LIN-1586's B4,
// and they are invisible in the returned rows.
function createMockCollection() {
  const docs = [];
  const finds = [];
  function matches(doc, query) {
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.expiresAt?.$gt !== undefined && !(doc.expiresAt > query.expiresAt.$gt)) return false;
    if (query.expiresAt?.$lt !== undefined && !(doc.expiresAt < query.expiresAt.$lt)) return false;
    if (query.timestamp?.$gt !== undefined && !(new Date(doc.timestamp) > query.timestamp.$gt)) return false;
    return true;
  }
  return {
    _docs: docs,
    _finds: finds,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}, options) {
      finds.push({ query, options });
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany(query) {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); n++; }
      }
      return { deletedCount: n };
    }
  };
}

describe('ProxyEventStore note breadcrumb (LIN-961)', () => {
  let store, collection;
  beforeEach(() => {
    collection = createMockCollection();
    store = new ProxyEventStore({ collection });
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
    // Simulate a pre-LIN-961 document with no `note` key at all.
    collection._docs.push({
      _id: 'legacy-1',
      urlKey: 'ws1',
      endpoint: '/api/proxy/recap',
      status: 429,
      timestamp: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z')
    });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items[0].note, null);
    assert.strictEqual(items[0].status, 429);
  });
});

// ===========================================================================
// LIN-1586 — listCredentialHealth, the SEPARATE read
// ===========================================================================

describe('ProxyEventStore.listCredentialHealth (LIN-1586)', () => {
  let store, collection;
  const now = () => Date.now();
  const minsAgo = (n) => new Date(now() - n * 60 * 1000);
  const future = new Date(now() + 24 * 60 * 60 * 1000);

  function seed({ urlKey = 'ws1', tokenId = 'tok-1', tokenLabel = 'worker', status = 200, note = null, at = 1 } = {}) {
    collection._docs.push({
      _id: `e${collection._docs.length}`,
      urlKey,
      tokenId,
      tokenLabel,
      method: 'GET',
      endpoint: '/api/proxy/me',
      status,
      note,
      timestamp: minsAgo(at),
      expiresAt: future
    });
  }

  beforeEach(() => {
    collection = createMockCollection();
    store = new ProxyEventStore({ collection });
  });

  test('reports credential_dead for a token with an ownerless note AND a success in the window', async () => {
    seed({ status: 201, at: 1 });
    seed({ status: 503, note: OWNERLESS_NOTE, at: 2 });

    const result = await store.listCredentialHealth('ws1');
    assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS);
    assert.strictEqual(result.tokens.length, 1);
    assert.deepStrictEqual(result.tokens[0], {
      tokenId: 'tok-1',
      tokenLabel: 'worker',
      ownerlessCount: 1,
      okCount: 1,
      verdict: 'credential_dead'
    });
  });

  test('the read is time-bounded: rows older than the window are excluded', async () => {
    const windowMins = CREDENTIAL_HEALTH_WINDOW_MS / 60000;
    seed({ status: 200, at: 1 });
    seed({ status: 503, note: OWNERLESS_NOTE, at: windowMins + 10 });

    const result = await store.listCredentialHealth('ws1');
    assert.strictEqual(result.tokens[0].ownerlessCount, 0);
    assert.strictEqual(result.tokens[0].verdict, 'ok');

    // The exclusion is pushed into the query, not left to the JS fold alone —
    // this read must never grow into listEvents' whole-workspace scan.
    const { query } = collection._finds.at(-1);
    assert.ok(query.timestamp?.$gt instanceof Date, 'query must carry a timestamp lower bound');
    assert.ok(query.expiresAt?.$gt instanceof Date, 'query must still skip expired rows');
    assert.strictEqual(query.urlKey, 'ws1');
  });

  test('an explicit windowMs widens the read; a junk one falls back to the default', async () => {
    const windowMins = CREDENTIAL_HEALTH_WINDOW_MS / 60000;
    seed({ status: 200, at: 1 });
    seed({ status: 503, note: OWNERLESS_NOTE, at: windowMins + 10 });

    const wide = await store.listCredentialHealth('ws1', { windowMs: 6 * 60 * 60 * 1000 });
    assert.strictEqual(wide.windowMs, 6 * 60 * 60 * 1000);
    assert.strictEqual(wide.tokens[0].verdict, 'credential_dead');

    for (const bad of [0, -1, NaN, 'soon', null]) {
      const result = await store.listCredentialHealth('ws1', { windowMs: bad });
      assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS, `windowMs ${bad} must fall back`);
    }
  });

  test('the read is projected to the five fields the predicate needs', async () => {
    seed({ status: 200, at: 1 });
    await store.listCredentialHealth('ws1');

    const { options } = collection._finds.at(-1);
    assert.deepStrictEqual(options.projection, {
      tokenId: 1, tokenLabel: 1, status: 1, note: 1, timestamp: 1
    });
  });

  test('the returned verdict carries counts only — no endpoints, no method, no urlKey', async () => {
    seed({ status: 200, at: 1 });
    const [entry] = (await store.listCredentialHealth('ws1')).tokens;
    assert.deepStrictEqual(Object.keys(entry).sort(),
      ['okCount', 'ownerlessCount', 'tokenId', 'tokenLabel', 'verdict']);
  });

  test('legacy docs with no note field at all read as ok, not as a fault', async () => {
    collection._docs.push({
      _id: 'legacy-1',
      urlKey: 'ws1',
      tokenId: 'tok-legacy',
      tokenLabel: 'old',
      status: 200,
      timestamp: minsAgo(1),
      expiresAt: future
    });

    const [entry] = (await store.listCredentialHealth('ws1')).tokens;
    assert.strictEqual(entry.ownerlessCount, 0);
    assert.strictEqual(entry.okCount, 1);
    assert.strictEqual(entry.verdict, 'ok');
  });

  test('scopes to the workspace: another workspace\'s dead credential does not leak in', async () => {
    seed({ urlKey: 'ws2', tokenId: 'other', status: 200, at: 1 });
    seed({ urlKey: 'ws2', tokenId: 'other', status: 503, note: OWNERLESS_NOTE, at: 2 });
    seed({ urlKey: 'ws1', tokenId: 'mine', status: 200, at: 1 });

    const result = await store.listCredentialHealth('ws1');
    assert.deepStrictEqual(result.tokens.map(t => t.tokenId), ['mine']);
  });

  test('no urlKey returns an empty verdict list without querying', async () => {
    const result = await store.listCredentialHealth('');
    assert.deepStrictEqual(result.tokens, []);
    assert.strictEqual(result.windowMs, CREDENTIAL_HEALTH_WINDOW_MS);
    assert.strictEqual(collection._finds.length, 0);
  });

  test('a store error degrades to an empty verdict list (the page must still render)', async () => {
    const broken = new ProxyEventStore({
      collection: { find() { throw new Error('collection is down'); } }
    });
    const result = await broken.listCredentialHealth('ws1');
    assert.deepStrictEqual(result, { windowMs: CREDENTIAL_HEALTH_WINDOW_MS, tokens: [] });
  });
});

// ===========================================================================
// LIN-1586 characterization — listEvents is NOT the surface being changed.
// B4 adds a second reader of the same collection; these pin the behaviour the
// Event Log already depends on so "additive" is asserted, not asserted-by-label.
// ===========================================================================

describe('listEvents behaviour is unchanged by the credential-health read (LIN-1586)', () => {
  let store, collection;
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    collection = createMockCollection();
    store = new ProxyEventStore({ collection });
    for (let i = 0; i < 3; i++) {
      collection._docs.push({
        _id: `e${i}`,
        urlKey: 'ws1',
        tokenId: `tok-${i}`,
        tokenLabel: `label-${i}`,
        method: 'GET',
        endpoint: `/api/proxy/e${i}`,
        status: 200,
        note: i === 0 ? OWNERLESS_NOTE : null,
        timestamp: new Date(Date.UTC(2026, 6, 25, 12, i)),
        expiresAt: future
      });
    }
  });

  test('the item shape is exactly the eight documented fields, newest-first', async () => {
    const { items, total } = await store.listEvents('ws1');
    assert.strictEqual(total, 3);
    assert.deepStrictEqual(items.map(i => i.id), ['e2', 'e1', 'e0']);
    assert.deepStrictEqual(Object.keys(items[0]).sort(),
      ['endpoint', 'id', 'method', 'note', 'status', 'timestamp', 'tokenId', 'tokenLabel'].sort());
    assert.strictEqual(items[0].timestamp, '2026-07-25T12:02:00.000Z');
  });

  test('the query is still the unprojected, un-time-bounded workspace read', async () => {
    await store.listEvents('ws1');
    const { query, options } = collection._finds.at(-1);
    // Deliberately NOT time-bounded and NOT projected: widening or narrowing
    // this read is S-2's job, not Beat 1's. If this fails, listEvents changed.
    assert.deepStrictEqual(Object.keys(query).sort(), ['expiresAt', 'urlKey']);
    assert.strictEqual(options, undefined);
  });

  test('limit/offset paging is untouched', async () => {
    const page = await store.listEvents('ws1', { limit: 2, offset: 1 });
    assert.strictEqual(page.total, 3);
    assert.deepStrictEqual(page.items.map(i => i.id), ['e1', 'e0']);
  });

  test('running the credential-health read first does not perturb listEvents', async () => {
    const before = await store.listEvents('ws1');
    await store.listCredentialHealth('ws1');
    const after = await store.listEvents('ws1');
    assert.deepStrictEqual(after, before);
  });
});
