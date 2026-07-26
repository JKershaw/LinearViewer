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
import { ProxyEventStore } from '../../lib/proxy-events.js';

// Minimal in-memory mock of the collection surface the store uses.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.expiresAt?.$gt !== undefined && !(doc.expiresAt > query.expiresAt.$gt)) return false;
    if (query.expiresAt?.$lt !== undefined && !(doc.expiresAt < query.expiresAt.$lt)) return false;
    if (query.timestamp?.$gt !== undefined && !(new Date(doc.timestamp) > query.timestamp.$gt)) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}) {
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

describe('ProxyEventStore.listCredentialHealth (LIN-1586)', () => {
  let store, collection;
  beforeEach(() => {
    collection = createMockCollection();
    store = new ProxyEventStore({ collection });
  });

  function pushDoc(overrides) {
    collection._docs.push({
      _id: `evt-${collection._docs.length}`,
      urlKey: 'ws1',
      tokenId: 'tok-1',
      tokenLabel: 'agent-prompt',
      method: 'GET',
      endpoint: '/api/proxy/issues',
      status: 200,
      note: null,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      ...overrides
    });
  }

  test('window bounds: only events within windowMs of now are folded', async () => {
    const now = Date.now();
    pushDoc({ timestamp: new Date(now - 5 * 60 * 1000) }); // in window
    pushDoc({ timestamp: new Date(now - 20 * 60 * 1000) }); // outside default 15min window

    const { tokens } = await store.listCredentialHealth('ws1', { windowMs: 15 * 60 * 1000 });
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].okCount, 1);
  });

  test('projection shape: {windowMs, tokens:[{tokenId, tokenLabel, ownerlessCount, okCount, verdict}]}', async () => {
    pushDoc({ timestamp: new Date(), note: 'token_ownerless', status: 503 });
    pushDoc({ timestamp: new Date(), status: 201 });

    const result = await store.listCredentialHealth('ws1', { windowMs: 15 * 60 * 1000 });
    assert.strictEqual(result.windowMs, 15 * 60 * 1000);
    assert.strictEqual(result.tokens.length, 1);
    const token = result.tokens[0];
    assert.deepStrictEqual(Object.keys(token).sort(), ['okCount', 'ownerlessCount', 'tokenId', 'tokenLabel', 'verdict'].sort());
    assert.strictEqual(token.tokenId, 'tok-1');
    assert.strictEqual(token.tokenLabel, 'agent-prompt');
    assert.strictEqual(token.ownerlessCount, 1);
    assert.strictEqual(token.okCount, 1);
    assert.strictEqual(token.verdict, 'credential-dead');
  });

  test('legacy docs with no note field are folded as non-ownerless, not a crash', async () => {
    collection._docs.push({
      _id: 'legacy-1',
      urlKey: 'ws1',
      tokenId: 'tok-1',
      tokenLabel: null,
      status: 200,
      timestamp: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z')
      // no `note` key at all
    });

    const { tokens } = await store.listCredentialHealth('ws1');
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0].ownerlessCount, 0);
    assert.strictEqual(tokens[0].verdict, 'ok');
  });

  test('listEvents behaviour is byte-unchanged by the presence of listCredentialHealth', async () => {
    await store.recordEvent({ urlKey: 'ws1', tokenId: 'tok-1', endpoint: '/api/proxy/issues', status: 200, note: 'token_ownerless' });
    const before = await store.listEvents('ws1');

    await store.listCredentialHealth('ws1');

    const after = await store.listEvents('ws1');
    assert.deepStrictEqual(after, before, 'listEvents output must be unaffected by listCredentialHealth');
    assert.deepStrictEqual(Object.keys(after.items[0]).sort(), ['endpoint', 'id', 'method', 'note', 'status', 'timestamp', 'tokenId', 'tokenLabel'].sort());
  });
});
