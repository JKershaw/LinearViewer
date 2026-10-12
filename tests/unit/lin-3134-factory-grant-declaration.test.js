/**
 * LIN-3138 S4 (LIN-3134 T2-i) — factory declared-record threading + injection.
 *
 * Witnesses:
 *   - F2 (7) factory half (NB6): through the REAL factory + REAL store, a
 *     test-only `finalizePrompt` returning a marker-valued `grantDeclaration`
 *     is persisted on the queue and history documents and readable via
 *     `getGrantDeclaration` (history fallback), while NEITHER key and NO marker
 *     value appears in the factory's returned item (the `addItem` return strip,
 *     Decision 9);
 *   - N6 injection (Decision 11): a caller's `fields` carrying both keys, and an
 *     anchor row carrying both, persist NEITHER.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const harness = createMangoTmpdir('lin-3528-factory-grant-');
before(() => harness.connect());
after(() => harness.close());

const MARKER = {
  grants: ['dispatch'],
  ownerAccountId: 'owner-MARKER',
  workspaceId: 'ws-MARKER',
  profile: 'worker',
  site: 'site-MARKER',
  declaredAt: '2026-09-29T00:00:00.000Z'
};
const MARKER_VALUES = ['owner-MARKER', 'ws-MARKER', 'site-MARKER', '2026-09-29T00:00:00.000Z'];

function makeStore() {
  return new DispatchQueueStore({ collection: harness.freshDb().collection('dispatch-queue'), historyCollection: harness.freshDb().collection('dispatch-history') });
}

describe('S4 — F2(7) factory half (real factory + real store)', () => {
  test('the declared record is persisted + readable, and never leaks through the factory item', async () => {
    const store = makeStore();
    const returned = await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'base',
      finalizePrompt: async () => ({ prompt: 'final prompt', bootstrapToken: null, grantDeclaration: MARKER }),
      fields: { promptName: 'Prompt', issueIdentifier: 'LIN-1' }
    });

    // The factory returns addItem's stripped return: no key, no marker value.
    assert.equal('grantDeclaration' in returned, false);
    assert.equal('grantRefusal' in returned, false);
    const serialized = JSON.stringify(returned);
    for (const value of MARKER_VALUES) assert.ok(!serialized.includes(value), `factory item leaked ${value}`);
    assert.ok(!serialized.includes('"grants"'));

    // Persisted on the queue document.
    assert.deepEqual((await store.collection.find({}).toArray())[0].grantDeclaration, MARKER);

    // Persisted through take → archive, and readable from history.
    await store.takeItem(returned._id, 'acme');
    assert.equal((await store.collection.find({}).toArray()).length, 0);
    assert.deepEqual((await store.historyCollection.find({}).toArray())[0].grantDeclaration, MARKER);
    const decl = await store.getGrantDeclaration('acme', returned._id);
    assert.deepEqual(decl, { state: 'record', record: MARKER });
  });

  test('an undeclared finalize result persists neither key', async () => {
    const store = makeStore();
    const returned = await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'base',
      finalizePrompt: async () => ({ prompt: 'final', bootstrapToken: null }),
      fields: { promptName: 'Prompt', issueIdentifier: 'LIN-1' }
    });
    assert.equal('grantDeclaration' in (await store.collection.find({}).toArray())[0], false);
    assert.equal('grantRefusal' in (await store.collection.find({}).toArray())[0], false);
    assert.equal('grantDeclaration' in returned, false);
  });
});

describe('S4 — D11 the finalized record is pinned after every spread', () => {
  test('an injected fields record loses to the finalize record, which is the LAST key of the addItem argument', async () => {
    const store = makeStore();
    const addItem = store.addItem.bind(store);
    const args = [];
    store.addItem = async (urlKey, item) => { args.push(item); return addItem(urlKey, item); };
    await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'base',
      finalizePrompt: async () => ({ prompt: 'final', bootstrapToken: null, grantDeclaration: MARKER }),
      fields: {
        promptName: 'Prompt',
        issueIdentifier: 'LIN-1',
        grantDeclaration: { ownerAccountId: 'HACK', grants: ['dispatch'], workspaceId: 'hack', site: 'hack', profile: 'worker', declaredAt: 't' }
      }
    });
    assert.equal(args.length, 1);
    assert.deepEqual(args[0].grantDeclaration, MARKER, 'the factory\'s own finalize record wins');
    assert.equal(Object.keys(args[0]).at(-1), 'grantDeclaration', 'the record is re-added after every spread (Decision 11)');
    assert.deepEqual((await store.collection.find({}).toArray())[0].grantDeclaration, MARKER);
    assert.ok(!JSON.stringify((await store.collection.find({}).toArray())[0]).includes('HACK'));
  });
});

describe('S4 — N6 injection persists neither key', () => {
  test('a caller\'s fields carrying both keys persists neither', async () => {
    const store = makeStore();
    await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'base',
      finalizePrompt: async () => ({ prompt: 'final', bootstrapToken: null }),
      fields: {
        promptName: 'Prompt',
        issueIdentifier: 'LIN-1',
        grantDeclaration: { ownerAccountId: 'HACK', grants: ['dispatch'], workspaceId: 'hack', site: 'hack', profile: 'worker', declaredAt: 't' },
        grantRefusal: 'HACK_REFUSAL'
      }
    });
    const doc = (await store.collection.find({}).toArray())[0];
    assert.equal('grantDeclaration' in doc, false, 'caller-injected record must not persist');
    assert.equal('grantRefusal' in doc, false, 'caller-injected refusal must not persist');
    assert.ok(!JSON.stringify(doc).includes('HACK'));
  });

  test('an anchor row carrying both persists neither', async () => {
    const store = makeStore();
    const anchor = await store.addItem('acme', {
      prompt: 'anchor', issueIdentifier: 'LIN-9',
      grantDeclaration: { ownerAccountId: 'ANCHOR_HACK', grants: ['dispatch'], workspaceId: 'hack', site: 'hack', profile: 'worker', declaredAt: 't' },
      grantRefusal: 'ANCHOR_REFUSAL'
    });
    await createDispatchItem({
      store,
      urlKey: 'acme',
      prompt: 'follow',
      finalizePrompt: async () => ({ prompt: 'follow', bootstrapToken: null }),
      fields: { promptName: 'Prompt', followUpTo: anchor._id }
    });
    const doc = (await store.collection.find({}).toArray())[1];
    assert.equal('grantDeclaration' in doc, false);
    assert.equal('grantRefusal' in doc, false);
    assert.ok(!JSON.stringify(doc).includes('ANCHOR_HACK'));
  });
});
