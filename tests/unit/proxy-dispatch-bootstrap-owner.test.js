/**
 * LIN-1376 — dispatched/collective bootstrap tokens must carry the dispatching
 * owner's account id, so the working token the exchange mints resolves under
 * LIN-1366's owner-scoped Linear-token selection.
 *
 * Regression: before this fix `attachProxyContext` minted the embedded bootstrap
 * with no `createdBy`, so it (and the token the exchange inherits from it) was
 * `createdBy: null`. LIN-1366's null-owner guard fails that closed, so every
 * dispatched session hit WORKSPACE_NOT_CONNECTED even after wiping stale tokens —
 * the defect was re-minted on each dispatch.
 *
 * A REAL ProxyTokenStore over an in-memory collection backs the store so the mint
 * → exchange → validate chain (the exact path a dispatched agent walks) is
 * exercised end-to-end. `createdBy` is what routes thread into
 * `resolveWorkspaceAccess(urlKey, ownerAccountId)`, so asserting it on the
 * validated working token pins the whole owner-propagation chain.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { attachProxyContext } from '../../lib/proxy-preamble.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

function createMockCollection() {
  let docs = [];
  const match = (d, query) => Object.keys(query).every(k => {
    if (typeof query[k] === 'object' && query[k] !== null) return true; // skip operators
    return d[k] === query[k];
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => match(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => match(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async find() { return { async toArray() { return docs.slice(); } }; },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; }
  };
}

describe('LIN-1376 — dispatched bootstrap carries the owner account id', () => {
  let store;
  beforeEach(() => {
    store = new ProxyTokenStore({ collection: createMockCollection() });
  });

  test('attachProxyContext threads createdBy → exchanged working token resolves under owner scoping', async () => {
    const { bootstrapToken } = await attachProxyContext({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://harbour.example',
      prompt: 'DISPATCHED PROMPT',
      label: 'dispatch-bootstrap',
      harness: 'claude-code', // MCP mode: token is returned as a field, not inlined
      createdBy: 'account-A'
    });

    assert.ok(bootstrapToken, 'claude-code harness returns the minted bootstrap to carry out-of-band');

    // The agent's first real call is the exchange; the working token it gets back
    // must inherit the owner so data endpoints resolve the right Linear identity.
    const working = await store.exchangeBootstrapToken(bootstrapToken);
    assert.ok(working?.token, 'bootstrap exchanges for a working token');

    const validated = await store.validateToken(working.token);
    assert.ok(validated, 'working token validates on data endpoints');
    assert.equal(
      validated.createdBy,
      'account-A',
      'working token carries the dispatching owner — this is the value routes pass to resolveWorkspaceAccess as ownerAccountId'
    );
  });

  test('a null owner still propagates as null (no fabricated owner) — fails closed, as designed', async () => {
    // A dispatcher with no resolvable owner must NOT be papered over with a borrowed
    // identity; it stays null so LIN-1366 fails it closed rather than leaking.
    const { bootstrapToken } = await attachProxyContext({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://harbour.example',
      prompt: 'DISPATCHED PROMPT',
      harness: 'claude-code',
      createdBy: null
    });
    const working = await store.exchangeBootstrapToken(bootstrapToken);
    const validated = await store.validateToken(working.token);
    assert.equal(validated.createdBy, null, 'no owner is fabricated when the dispatcher has none');
  });
});
