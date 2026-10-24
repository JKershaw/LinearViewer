/**
 * LIN-3846: the workspace change log store (everyone-changes outside model routing) and the
 * merged view with model-routing-log.
 *
 * Run with: node --test tests/unit/workspace-change-log.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceChangeLogStore, ChangeLogError, mergeChangeLog, summarizeWorkspaceEntry } from '../../lib/workspace-change-log.js';
import { memoryCollection } from './helpers/routing-fakes.js';

const actor = { via: 'page', id: 'acct-1' };
let store, value;
beforeEach(() => {
  store = new WorkspaceChangeLogStore({ collection: memoryCollection(), resolveActorName: async (id) => (id === 'acct-1' ? 'Ada' : null), erasedAccountId: 'erased' });
  value = false;
});
const rec = (extra = {}) => store.record({ urlKey: 'a', setting: 'periodicals', reason: 'why', actor, from: false, to: true, ...extra });
const undoer = (id, reason = 'back') => store.undo(id, { urlKey: 'a', reason, actor, readCurrent: async () => value, apply: async (v) => { value = v; } });

describe('record', () => {
  test('stores ids only and resolves the name at read time; an unknown or erased id reads "former member"', async () => {
    await rec();
    await rec({ actor: { via: 'page', id: 'gone' } });
    await rec({ actor: { via: 'page', id: 'erased' } });
    await rec({ actor: { via: 'system' } });
    const log = await store.getLog('a');
    assert.deepEqual(log.map(r => r.actor.name).sort(), ['Ada', 'Harbour', 'former member', 'former member']);
    assert.ok(!JSON.stringify(await store.collection.find({}).toArray()).includes('Ada'), 'no name is stored');
  });

  test('a reason is required, 1 to 500 characters', async () => {
    for (const reason of ['', '   ', undefined, 'x'.repeat(501)]) {
      await assert.rejects(() => rec({ reason }), (e) => e instanceof ChangeLogError && e.code === 'REASON_REQUIRED');
    }
    await rec({ reason: 'x'.repeat(500) });
  });

  test('an unknown setting and a missing actor are refused', async () => {
    await assert.rejects(() => rec({ setting: 'theme' }), { code: 'INVALID' });
    await assert.rejects(() => rec({ actor: { via: 'bogus' } }), { code: 'INVALID' });
  });
});

describe('undo', () => {
  test('writes the restored value through apply and a new undo entry', async () => {
    const e = await rec(); value = true;
    const u = await undoer(e._id);
    assert.equal(value, false);
    assert.deepEqual([u.kind, u.undoes, u.from, u.to], ['undo', e._id, true, false]);
  });

  test('refuses with CONFLICT, and does not apply, when the value changed since', async () => {
    const e = await rec(); value = 'something else';
    await assert.rejects(() => undoer(e._id), (err) => err.code === 'CONFLICT' && err.current === 'something else');
    assert.equal(value, 'something else');
  });

  test('refuses a second undo, an undo of an undo, an unknown entry, and a halt with an unknown previous value', async () => {
    const e = await rec(); value = true;
    const u = await undoer(e._id);
    value = true;
    await assert.rejects(() => undoer(e._id), { code: 'ALREADY_UNDONE' });
    await assert.rejects(() => undoer(u._id), { code: 'NOT_UNDOABLE' });
    await assert.rejects(() => undoer('nope'), { code: 'NOT_FOUND' });
    const h = await store.record({ urlKey: 'a', setting: 'halt', reason: 'r', actor, from: 'unknown', to: 'stop' });
    await assert.rejects(() => undoer(h._id), { code: 'NOT_UNDOABLE' });
  });

  test('needs a reason, and an entry of another workspace is not found', async () => {
    const e = await rec(); value = true;
    await assert.rejects(() => undoer(e._id, ''), { code: 'REASON_REQUIRED' });
    await assert.rejects(() => store.undo(e._id, { urlKey: 'other', reason: 'r', actor, readCurrent: async () => value, apply: async () => {} }), { code: 'NOT_FOUND' });
  });
});

describe('mergeChangeLog', () => {
  test('one list newest first by time (not seq), flagging undone and undoable entries from both logs', () => {
    const t = (n) => new Date(2026, 9, 24, 12, n);
    const workspaceRows = [
      { _id: 'w1', at: t(5), setting: 'periodicals', kind: 'change', from: false, to: true, reason: 'on', actor: { name: 'Ada' } },
      { _id: 'w2', at: t(9), setting: 'periodicals', kind: 'undo', undoes: 'w1', from: true, to: false, reason: 'off', actor: { name: 'Ada' } },
      { _id: 'w3', at: t(1), setting: 'halt', kind: 'change', from: 'unknown', to: 'stop', reason: 'r', actor: { name: 'Bo' } }
    ];
    const modelRows = [
      // the seeded entry carries a backdated time and a LOW seq; ordering is by `at`
      { _id: 'm1', at: t(7), seq: 1, kind: 'change', changes: [{ field: 'model' }], reason: 'm', actor: { name: 'Cy' } },
      { _id: 'm2', at: t(0), seq: 9, kind: 'preset-save', changes: [], reason: 'p', actor: { name: 'Cy' } }
    ];
    const merged = mergeChangeLog(workspaceRows, modelRows);
    assert.deepEqual(merged.map(r => r.id), ['w2', 'm1', 'w1', 'w3', 'm2']);
    const by = Object.fromEntries(merged.map(r => [r.id, r]));
    assert.equal(by.w1.undone, true); assert.equal(by.w1.undoable, false);
    assert.equal(by.w2.undoable, false, 'an undo is not undoable');
    assert.equal(by.w3.undoable, false, 'unknown previous value: nothing to restore');
    assert.equal(by.m1.undoable, true); assert.equal(by.m1.source, 'model');
    assert.equal(by.m2.undoable, false, 'a preset save changed nothing to restore');
  });

  test('summaries say what changed', () => {
    assert.equal(summarizeWorkspaceEntry({ setting: 'periodicals', to: true }), 'Periodic reviews turned on');
    assert.equal(summarizeWorkspaceEntry({ setting: 'halt', from: 'stop', to: 'none' }), 'Runs resumed (were stopped)');
    assert.equal(summarizeWorkspaceEntry({ setting: 'halt', from: 'none', to: 'pause' }), 'Runs paused');
  });
});
