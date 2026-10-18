import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionRowLive, liveSessionRows } from '../../lib/session-row-live.js';
import { MongoSessionStore } from '../../lib/session-store.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');

describe('isSessionRowLive', () => {
  it('missing/null/undefined expires is live', () => {
    assert.equal(isSessionRowLive({}, NOW), true);
    assert.equal(isSessionRowLive({ expires: null }, NOW), true);
    assert.equal(isSessionRowLive({ expires: undefined }, NOW), true);
  });
  it('null or undefined row is live (nothing to expire)', () => {
    assert.equal(isSessionRowLive(null, NOW), true);
    assert.equal(isSessionRowLive(undefined, NOW), true);
  });
  it('Date: past is expired, future is live', () => {
    assert.equal(isSessionRowLive({ expires: new Date(NOW - 1) }, NOW), false);
    assert.equal(isSessionRowLive({ expires: new Date(NOW + 1) }, NOW), true);
  });
  it('ISO string and epoch number forms', () => {
    assert.equal(isSessionRowLive({ expires: '2026-09-01T00:00:00Z' }, NOW), false);
    assert.equal(isSessionRowLive({ expires: '2026-11-01T00:00:00Z' }, NOW), true);
    assert.equal(isSessionRowLive({ expires: NOW - 1000 }, NOW), false);
    assert.equal(isSessionRowLive({ expires: NOW + 1000 }, NOW), true);
  });
  it('unparseable expires counts as live', () => {
    assert.equal(isSessionRowLive({ expires: 'not-a-date' }, NOW), true);
    assert.equal(isSessionRowLive({ expires: {} }, NOW), true);
  });
  it('expires === now is live (strictly-before is expired)', () => {
    assert.equal(isSessionRowLive({ expires: new Date(NOW) }, NOW), true);
  });
  it('now may be a Date or a number', () => {
    assert.equal(isSessionRowLive({ expires: NOW - 1 }, new Date(NOW)), false);
    assert.equal(isSessionRowLive({ expires: NOW + 1 }, new Date(NOW)), true);
  });
  it('defaults now to the current time', () => {
    assert.equal(isSessionRowLive({ expires: new Date(Date.now() - 60000) }), false);
    assert.equal(isSessionRowLive({ expires: new Date(Date.now() + 60000) }), true);
  });
});

describe('liveSessionRows', () => {
  it('null/undefined/empty give []', () => {
    assert.deepEqual(liveSessionRows(null, NOW), []);
    assert.deepEqual(liveSessionRows(undefined, NOW), []);
    assert.deepEqual(liveSessionRows([], NOW), []);
  });
  it('keeps live and no-expires rows, drops expired, preserving order', () => {
    const a = { id: 'a', expires: NOW + 1 };
    const b = { id: 'b', expires: NOW - 1 };
    const c = { id: 'c' };
    assert.deepEqual(liveSessionRows([a, b, c], NOW), [a, c]);
  });
});

describe('MongoSessionStore.get() delegates to the shared rule', () => {
  function storeWith(doc) {
    const destroyed = [];
    const collection = {
      findOne: async () => doc,
      deleteOne: async q => { destroyed.push(q); return { deletedCount: 1 }; }
    };
    const store = new MongoSessionStore({ collection });
    store.destroy = sid => { destroyed.push(sid); };
    return { store, destroyed };
  }
  const get = store => new Promise((resolve, reject) => store.get('sid', (e, s) => (e ? reject(e) : resolve(s))));

  it('expired Date row: null and destroyed', async () => {
    const { store, destroyed } = storeWith({ session: { a: 1 }, expires: new Date(Date.now() - 1000) });
    assert.equal(await get(store), null);
    assert.deepEqual(destroyed, ['sid']);
  });
  it('expired ISO-string row: null and destroyed', async () => {
    const { store, destroyed } = storeWith({ session: { a: 1 }, expires: new Date(Date.now() - 1000).toISOString() });
    assert.equal(await get(store), null);
    assert.deepEqual(destroyed, ['sid']);
  });
  it('live and no-expires rows return the session', async () => {
    const live = storeWith({ session: { a: 1 }, expires: new Date(Date.now() + 60000) });
    assert.deepEqual(await get(live.store), { a: 1 });
    const none = storeWith({ session: { b: 2 } });
    assert.deepEqual(await get(none.store), { b: 2 });
  });
});
