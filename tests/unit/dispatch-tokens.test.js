/**
 * LIN-1397 — dispatch tokens now carry `createdBy` (Option A owner-resolution),
 * stamped at creation and returned from validateToken so the new broker-token
 * mint endpoint (routes/dispatch.js) can stamp a non-null owner onto the
 * bootstrap it mints for the stall-failsafe reaper.
 *
 * Additive/backward-compatible: a token created without a createdBy arg (the
 * pre-LIN-1397 shape) validates with `createdBy: null`, never fabricated.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';

function createMockCollection() {
  let docs = [];
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) {
      return docs.find(d => Object.keys(query).every(k => d[k] === query[k])) || null;
    },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => Object.keys(query).every(k => d[k] === query[k]));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async find() { return { async toArray() { return docs.slice(); } }; },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; }
  };
}

describe('LIN-1397 — DispatchTokenStore createdBy plumbing', () => {
  let store;
  beforeEach(() => {
    store = new DispatchTokenStore({ collection: createMockCollection() });
  });

  test('createToken stamps createdBy and validateToken returns it', async () => {
    const { token } = await store.createToken('acme', 'my-label', 'account-A');
    const validated = await store.validateToken(token);
    assert.deepEqual(validated, { urlKey: 'acme', label: 'my-label', createdBy: 'account-A' });
  });

  test('createToken with no createdBy arg -> validateToken returns createdBy: null (never fabricated)', async () => {
    const { token } = await store.createToken('acme', 'my-label');
    const validated = await store.validateToken(token);
    assert.equal(validated.createdBy, null);
  });

  test('label-only two-arg call (the pre-LIN-1397 call shape) still works byte-identically', async () => {
    const { token, label } = await store.createToken('acme', 'legacy-label');
    assert.equal(label, 'legacy-label');
    const validated = await store.validateToken(token);
    assert.equal(validated.urlKey, 'acme');
    assert.equal(validated.label, 'legacy-label');
    assert.equal(validated.createdBy, null);
  });
});
