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

  test('proxy tokens: default [], strict rethrows', async () => {
    const store = new ProxyTokenStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.listHolderRows('k')), []);
    await assert.rejects(quiet(() => store.listHolderRows('k', { strict: true })), /mongo down/);
  });

  test('dispatch tokens: default [], strict rethrows', async () => {
    const store = new DispatchTokenStore({ collection: broken });
    assert.deepEqual(await quiet(() => store.listHolderRows('k')), []);
    await assert.rejects(quiet(() => store.listHolderRows('k', { strict: true })), /mongo down/);
  });
});
