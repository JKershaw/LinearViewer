/**
 * LIN-3846: the halt store's change hook. Every halt writer is logged at the store, so the
 * log never misses a change; a hook failure never fails a stop; Undo (`quiet`) is not
 * double-logged; a call with no `via` (a test seed) is not logged.
 *
 * Run with: node --test tests/unit/workspace-halt-hook.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { memoryCollection } from './helpers/routing-fakes.js';

let collection, store, calls;
beforeEach(() => {
  collection = memoryCollection();
  store = new WorkspaceHaltStore({ collection });
  calls = [];
  store.setOnChange((c) => { calls.push(c); });
});
const set = (mode, extra = {}) => store.setWorkspaceHalt('ws', { mode, setBy: 'acct', now: new Date(), ...extra });

describe('WorkspaceHaltStore change hook', () => {
  test('fires for a set and a clear that name a writer, with the prior value read before the write', async () => {
    await set('pause', { via: 'page', reason: 'deploy' });
    await set('stop', { via: 'proxy' });
    await store.clearWorkspaceHalt('ws', { via: 'page', setBy: 'acct', reason: 'done' });
    assert.deepEqual(calls.map(c => [c.from, c.to, c.via, c.reason]), [
      ['none', 'pause', 'page', 'deploy'],
      ['pause', 'stop', 'proxy', undefined],
      ['stop', 'none', 'page', 'done']
    ]);
  });

  test('a call with no via (a test seed) and a quiet call (Undo) are not logged, but the halt is written', async () => {
    await set('pause');
    await set('stop', { via: 'page', quiet: true });
    await store.clearWorkspaceHalt('ws', { via: 'page', quiet: true });
    assert.deepEqual(calls, []);
    assert.equal(await collection.findOne({ _id: 'ws' }), null);
  });

  test('records from:"unknown" when the prior read throws, and the stop still goes through', async () => {
    const realFindOne = collection.findOne;
    let first = true;
    collection.findOne = async (q) => { if (first) { first = false; throw new Error('read failed'); } return realFindOne.call(collection, q); };
    await set('stop', { via: 'page', reason: 'r' });
    assert.equal(calls[0].from, 'unknown');
    assert.equal((await realFindOne.call(collection, { _id: 'ws' })).mode, 'stop');
  });

  test('a hook that throws never fails the halt (a stop must not be blocked by its log)', async () => {
    store.setOnChange(() => { throw new Error('log down'); });
    const errors = []; const orig = console.error; console.error = (...a) => errors.push(a);
    try { await set('stop', { via: 'page', reason: 'r' }); } finally { console.error = orig; }
    assert.equal((await collection.findOne({ _id: 'ws' })).mode, 'stop');
    assert.equal(errors.length, 1);
  });

  test('without a hook wired nothing is read or logged', async () => {
    const bare = new WorkspaceHaltStore({ collection });
    await bare.setWorkspaceHalt('ws', { mode: 'pause', setBy: 'a', via: 'page' });
    assert.equal((await collection.findOne({ _id: 'ws' })).mode, 'pause');
  });
});
