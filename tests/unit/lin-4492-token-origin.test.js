/**
 * LIN-4492 (plan decision 2a): every proxy-token mint carries who minted it (`origin`) and, for a dispatch
 * credential, the run it writes for (`runRecordId`). These tests pin the store side: what a mint stores,
 * what validation returns, what the exchange copies, and what `createToken` refuses to stamp.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { personMint, dispatchMintOptions, TOKEN_ORIGIN } from '../../lib/stage-writes.js';

const URL_KEY = 'acme';
const OWNER = 'acct-owner';
const WORKSPACE_ID = 'ws-acme';

function makeStore() {
  const collection = createMockCollection();
  const store = new ProxyTokenStore({ collection });
  store.setOwnerCheck(async () => ({ status: 'owner' }));
  return { store, collection };
}

describe('LIN-4492: the origin and run a proxy token is minted with', () => {
  test('a dispatch mint for a run stores origin and run, and validation returns both', async () => {
    const { store, collection } = makeStore();
    const minted = await store.createToken(URL_KEY, {
      ...dispatchMintOptions({ runRecordId: 'run-1' }),
      scope: 'readWrite',
      createdBy: OWNER
    });

    const doc = await collection.findOne({ _id: minted.tokenId });
    assert.equal(doc.origin, TOKEN_ORIGIN.DISPATCH);
    assert.equal(doc.runRecordId, 'run-1');

    const validated = await store.validateToken(minted.token, { touch: false });
    assert.equal(validated.origin, 'dispatch');
    assert.equal(validated.runRecordId, 'run-1');
  });

  test('a dispatch mint with no run stores origin and no run key at all (sparse)', async () => {
    const { store, collection } = makeStore();
    const minted = await store.createToken(URL_KEY, {
      ...dispatchMintOptions({ runRecordId: null }),
      scope: 'readWrite',
      createdBy: OWNER
    });

    const doc = await collection.findOne({ _id: minted.tokenId });
    assert.equal(doc.origin, 'dispatch');
    assert.equal('runRecordId' in doc, false, 'a run-less dispatch token keeps no runRecordId key');

    const validated = await store.validateToken(minted.token, { touch: false });
    assert.equal(validated.runRecordId, null);
  });

  test('createToken ignores a caller-supplied origin of person: no person marker, so no origin', async () => {
    const { store, collection } = makeStore();
    const minted = await store.createToken(URL_KEY, { origin: 'person', createdBy: OWNER, scope: 'readWrite' });

    const doc = await collection.findOne({ _id: minted.tokenId });
    assert.equal('origin' in doc, false, 'a bare origin:"person" is not stamped');
    const validated = await store.validateToken(minted.token, { touch: false });
    assert.equal(validated.origin, null);
  });

  test('personMint stamps person and never a run, even when one is named', async () => {
    const { store, collection } = makeStore();
    const minted = await store.createToken(URL_KEY, personMint({
      createdBy: OWNER,
      scope: 'readWrite',
      runRecordId: 'run-x'
    }));

    const doc = await collection.findOne({ _id: minted.tokenId });
    assert.equal(doc.origin, TOKEN_ORIGIN.PERSON);
    assert.equal('runRecordId' in doc, false);
  });

  test('personMint with no owner stamps no origin: a person mint must name who it acts for', async () => {
    const { store, collection } = makeStore();
    const minted = await store.createToken(URL_KEY, personMint({ createdBy: null, scope: 'readWrite' }));

    const doc = await collection.findOne({ _id: minted.tokenId });
    assert.equal('origin' in doc, false);
  });

  test('a token minted with no origin at all validates with origin null (it predates run identity)', async () => {
    const { store } = makeStore();
    const minted = await store.createToken(URL_KEY, { scope: 'readWrite', createdBy: OWNER });

    const validated = await store.validateToken(minted.token, { touch: false });
    assert.equal(validated.origin, null);
    assert.equal(validated.runRecordId, null);
  });

  test('the exchange copies origin and run from the bootstrap to the working token, unchanged', async () => {
    const { store } = makeStore();
    const bootstrap = await store.createToken(URL_KEY, {
      kind: 'bootstrap',
      ...dispatchMintOptions({ runRecordId: 'run-2' }),
      scope: 'readWrite',
      createdBy: OWNER
    });

    const working = await store.exchangeBootstrapToken(bootstrap.token);
    assert.ok(working?.token, 'the exchange succeeds');

    const validated = await store.validateToken(working.token, { touch: false });
    assert.equal(validated.origin, 'dispatch');
    assert.equal(validated.runRecordId, 'run-2');
  });

  test('an owner-issued grant copy (mintGrantBootstrap with personMint) exchanges to a person credential', async () => {
    const { store } = makeStore();
    const bootstrap = await store.mintGrantBootstrap(personMint({
      urlKey: URL_KEY,
      workspaceId: WORKSPACE_ID,
      ownerAccountId: OWNER,
      grants: ['dispatch'],
      label: 'runner'
    }));
    const working = await store.exchangeBootstrapToken(bootstrap.token);
    assert.ok(working?.token, 'the exchange succeeds');

    const validated = await store.validateToken(working.token, { touch: false });
    assert.equal(validated.origin, 'person');
    assert.equal(validated.createdBy, OWNER, 'a record written with this credential is filed as its owner');
    assert.equal(validated.runRecordId, null);
  });

  test('mintGrantBootstrap without personMint and with a dispatch origin keeps the run', async () => {
    const { store, collection } = makeStore();
    const bootstrap = await store.mintGrantBootstrap({
      urlKey: URL_KEY,
      workspaceId: WORKSPACE_ID,
      ownerAccountId: OWNER,
      grants: ['dispatch'],
      label: 'worker',
      profile: 'worker',
      ...dispatchMintOptions({ runRecordId: 'run-3' })
    });

    const doc = await collection.findOne({ _id: bootstrap.tokenId });
    assert.equal(doc.origin, 'dispatch');
    assert.equal(doc.runRecordId, 'run-3');
  });
});
