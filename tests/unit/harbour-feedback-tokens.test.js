/**
 * LIN-3795: feedback tokens are minted with the hbf_ prefix so a bare one is
 * masked on public /t/ pages (lib/secret-scan.js harbour-bootstrap-token).
 *
 * Run with: node --test tests/unit/harbour-feedback-tokens.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { HarbourFeedbackTokenStore } from '../../lib/harbour-feedback-tokens.js';

// Minimal in-memory collection: only the calls mintToken / validateAndConsume make.
function createCollection() {
  const docs = [];
  return {
    docs,
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOneAndUpdate(query, update) {
      const doc = docs.find(d => d.tokenHash === query.tokenHash && d.used === query.used
        && d.expiresAt > query.expiresAt.$gt && (!query.itemId || d.itemId === query.itemId));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      return doc;
    }
  };
}

describe('LIN-3795 — HarbourFeedbackTokenStore', () => {
  test('mintToken returns hbf_ + 43 base64url chars, and it validates once', async () => {
    const store = new HarbourFeedbackTokenStore({ collection: createCollection() });
    const { token } = await store.mintToken('item-1', 'acme');
    assert.match(token, /^hbf_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await store.validateAndConsume(token, 'item-1'), { urlKey: 'acme', itemId: 'item-1' });
    assert.equal(await store.validateAndConsume(token, 'item-1'), null, 'single use');
  });

  test('a pre-LIN-3795 unprefixed row still validates', async () => {
    const collection = createCollection();
    const store = new HarbourFeedbackTokenStore({ collection });
    await store.mintToken('item-1', 'acme');
    const legacy = randomBytes(32).toString('base64url');
    collection.docs.push({ ...collection.docs[0], _id: 'legacy-row', tokenHash: store._hashToken(legacy) });
    assert.deepEqual(await store.validateAndConsume(legacy, 'item-1'), { urlKey: 'acme', itemId: 'item-1' });
  });
});
