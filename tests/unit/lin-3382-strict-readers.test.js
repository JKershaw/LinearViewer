/**
 * LIN-3382 (class H2): the holder readers swallowed their own errors, so a store
 * failure read as "no holders" and a bind-time check would have passed. Each
 * takes an opt-in `{strict: true}` that rethrows; the default stays "never
 * throws" so the dry-run and LIN-3381's tests are unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createReferentHolderReader } from '../../lib/connection-credential.js';

const broken = { find() { throw new Error('mongo down'); } };
const quiet = async fn => {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

describe('strict mode on the holder readers', () => {
  test('connection referents: default [], strict rethrows', async () => {
    const store = new ConnectionStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.readConnectionReferents('k')), []);
    await assert.rejects(quiet(() => store.readConnectionReferents('k', { strict: true })), /mongo down/);
  });

  test('referent reader: strict flag reaches the store', async () => {
    const store = new ConnectionStore({ collection: broken });
    assert.deepEqual(await quiet(() => createReferentHolderReader({ connectionStore: store })('k')), []);
    await assert.rejects(quiet(() => createReferentHolderReader({ connectionStore: store, strict: true })('k')), /mongo down/);
  });

  test('owner credentials: default [], strict rethrows', async () => {
    const store = new OwnerCredentialStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.listUrlKeyRecords({ urlKey: 'k' })), []);
    await assert.rejects(quiet(() => store.listUrlKeyRecords({ urlKey: 'k', strict: true })), /mongo down/);
  });

  test('proxy tokens: default [], strict rethrows (listHolderRows and listHolderRowsByWorkspaceId)', async () => {
    const store = new ProxyTokenStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.listHolderRows('k')), []);
    await assert.rejects(quiet(() => store.listHolderRows('k', { strict: true })), /mongo down/);
    assert.deepEqual(await quiet(() => store.listHolderRowsByWorkspaceId('w')), []);
    await assert.rejects(quiet(() => store.listHolderRowsByWorkspaceId('w', { strict: true })), /mongo down/);
  });

  test('dispatch tokens: default [], strict rethrows', async () => {
    const store = new DispatchTokenStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.listHolderRows('k')), []);
    await assert.rejects(quiet(() => store.listHolderRows('k', { strict: true })), /mongo down/);
  });
});

describe('key-set reads ($in) and listHolderRowsByWorkspaceId on a real collection', () => {
  const rows = [
    { _id: 'a', urlKey: 'k1', createdBy: 'x', workspaceId: 'w1', createdAt: new Date() },
    { _id: 'b', urlKey: 'k2', createdBy: 'y', workspaceId: 'w2', createdAt: new Date() },
    { _id: 'c', urlKey: 'k3', createdBy: 'z', createdAt: new Date() }
  ];
  const fake = {
    find(filter) {
      const match = r => Object.entries(filter).every(([field, cond]) => (cond && cond.$in ? cond.$in.includes(r[field]) : r[field] === cond));
      return { toArray: async () => rows.filter(match).map(({ _id, ...rest }) => rest) };
    }
  };
  test('an array of keys is one $in read; an empty array is not a key filter on a bare string', async () => {
    const proxy = new ProxyTokenStore({ collection: fake });
    assert.deepEqual((await proxy.listHolderRows(['k1', 'k3'])).map(r => r.urlKey).sort(), ['k1', 'k3']);
    assert.deepEqual((await proxy.listHolderRowsByWorkspaceId('w2')).map(r => r.urlKey), ['k2']);
    assert.deepEqual(await proxy.listHolderRowsByWorkspaceId(''), []);
  });
});
