/**
 * Unit tests for the credential-death predicate behind
 * ProxyEventStore.listCredentialHealth (LIN-1586, Beat 1 of LIN-1577).
 *
 * A tokenId is `credential-dead` within the lookback window iff it has BOTH:
 *   - >=1 event with `note === 'token_ownerless'` (exact string equality), AND
 *   - >=1 event with `status < 400` (not `=== 200` — 201s from
 *     /agent/status and /dispatch count as success too).
 *
 * Run with: node --test tests/unit/credential-health-predicate.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProxyEventStore } from '../../lib/proxy-events.js';

function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.expiresAt?.$gt !== undefined && !(doc.expiresAt > query.expiresAt.$gt)) return false;
    if (query.timestamp?.$gt !== undefined && !(new Date(doc.timestamp) > query.timestamp.$gt)) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    }
  };
}

describe('credential-death predicate (LIN-1586)', () => {
  let store, collection;
  const WINDOW_MS = 15 * 60 * 1000;

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
      status: 200,
      note: null,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      timestamp: new Date(),
      ...overrides
    });
  }

  async function verdictFor(tokenId = 'tok-1') {
    const { tokens } = await store.listCredentialHealth('ws1', { windowMs: WINDOW_MS });
    const token = tokens.find(t => t.tokenId === tokenId);
    return token ? token.verdict : null;
  }

  test('ownerless-only (no success event) -> not dead', async () => {
    pushDoc({ note: 'token_ownerless', status: 503 });
    assert.strictEqual(await verdictFor(), 'ok');
  });

  test('success-only (no ownerless event) -> not dead', async () => {
    pushDoc({ status: 200 });
    assert.strictEqual(await verdictFor(), 'ok');
  });

  test('both ownerless and success within the window -> dead', async () => {
    pushDoc({ note: 'token_ownerless', status: 503 });
    pushDoc({ status: 200 });
    assert.strictEqual(await verdictFor(), 'credential-dead');
  });

  test('both present but straddling the window edge -> not dead', async () => {
    const now = Date.now();
    // Ownerless event lands inside the window...
    pushDoc({ note: 'token_ownerless', status: 503, timestamp: new Date(now - 5 * 60 * 1000) });
    // ...but the success event falls just outside it.
    pushDoc({ status: 200, timestamp: new Date(now - WINDOW_MS - 60 * 1000) });
    assert.strictEqual(await verdictFor(), 'ok');
  });

  test('LIN-961 English-sentence note is ignored (exact match only, never includes)', async () => {
    pushDoc({ note: 'free-tier fallback: no paid/OAuth key resolved', status: 200 });
    pushDoc({ note: 'free-tier fallback: no paid/OAuth key resolved', status: 200 });
    assert.strictEqual(await verdictFor(), 'ok');
  });

  test('a 201 success (e.g. /agent/status, /dispatch) counts as success', async () => {
    pushDoc({ note: 'token_ownerless', status: 503 });
    pushDoc({ status: 201, note: null });
    assert.strictEqual(await verdictFor(), 'credential-dead');
  });

  test('status: 503 alone (no note) never triggers dead — most 503 sites carry no note', async () => {
    pushDoc({ status: 503, note: null });
    pushDoc({ status: 200 });
    assert.strictEqual(await verdictFor(), 'ok');
  });
});
