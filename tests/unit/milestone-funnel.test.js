/**
 * Unit tests for lib/milestone-funnel.js's canonicalization (LIN-2952, Beat A)
 * and the canonical-map parameter it feeds on TaskModeStore.countByEntryRung.
 *
 * Run with: node --test tests/unit/milestone-funnel.test.js
 *
 * Every test runs against a REAL AccountStore (MangoDB) so merge resolution is
 * exercised end to end, not stubbed: a merged person counted once, a chain
 * merged twice folded to one, and a corrupt/cyclic mergedInto chain falling
 * back per id rather than dropping or crashing.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { AccountStore } from '../../lib/account-store.js';
import { TaskModeStore } from '../../lib/task-mode-store.js';
import { buildCanonicalMap } from '../../lib/milestone-funnel.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const harness = createMangoTmpdir('lin-2952-milestone-');
before(() => harness.connect());
after(() => harness.close());

function freshStores() {
  const db = harness.freshDb();
  return {
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    taskModeStore: new TaskModeStore({ collection: db.collection('task-mode-events') })
  };
}

const entry = (accountId, issueIdentifier) => ({
  accountId, urlKey: 'ws', issueId: 'uuid', issueIdentifier,
  rung: 'copy', ready: true, needs: null, act: 'copy', surface: 'swipe'
});

async function recordInOrder(store, events) {
  for (const event of events) {
    await store.record(event);
    await new Promise(resolve => setTimeout(resolve, 3));
  }
}

describe('buildCanonicalMap', () => {
  test('resolves merged ids to their canonical survivor and leaves others as themselves', async () => {
    const { accountStore } = freshStores();
    const canonical = await accountStore.createAccount();
    const merged = await accountStore.createAccount();
    const bystander = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);

    const map = await buildCanonicalMap([canonical._id, merged._id, bystander._id], accountStore);
    assert.strictEqual(map.get(canonical._id), canonical._id);
    assert.strictEqual(map.get(merged._id), canonical._id);
    assert.strictEqual(map.get(bystander._id), bystander._id);
  });

  test('a corrupt cyclic chain falls back per id — the corrupt id keeps itself, others still resolve', async () => {
    const { accountStore } = freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    const healthy = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    // `mergeAccounts` refuses to build a cycle, so seed the corruption directly.
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    assert.equal((await accountStore.mergeAccounts(survivor._id, healthy._id)).ok, true);

    // The resolution itself throws for the corrupt pair...
    await assert.rejects(accountStore.resolveCanonicalAccountId(a._id), /resolveCanonicalAccountId/);

    // ...but the map builder degrades per id: no throw, no drop.
    const map = await buildCanonicalMap([a._id, b._id, healthy._id], accountStore);
    assert.strictEqual(map.get(a._id), a._id);
    assert.strictEqual(map.get(b._id), b._id);
    assert.strictEqual(map.get(healthy._id), survivor._id, 'the healthy chain still resolves');
  });
});

describe('countByEntryRung — canonical map (LIN-2952)', () => {
  test('a person split across two recorded ids is counted once when the map is supplied', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const canonical = await accountStore.createAccount();
    const merged = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);

    // The SAME person's SAME task, entered first under the merged id and again
    // under the canonical id — the post-merge double-count the map removes.
    await recordInOrder(taskModeStore, [
      entry(merged._id, 'LIN-1'),
      entry(canonical._id, 'LIN-1'),
    ]);
    const map = await buildCanonicalMap([canonical._id, merged._id], accountStore);

    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 1);
    assert.deepStrictEqual(counted.byRung.map(r => r.entries), [1, 0, 0]);
  });

  test('a chain merged twice (X→Y→Z) folds to one person; the default call still counts two', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const x = await accountStore.createAccount();
    const y = await accountStore.createAccount();
    const z = await accountStore.createAccount();
    assert.equal((await accountStore.mergeAccounts(y._id, x._id)).ok, true);
    assert.equal((await accountStore.mergeAccounts(z._id, y._id)).ok, true);

    await recordInOrder(taskModeStore, [
      entry(x._id, 'LIN-1'),
      entry(z._id, 'LIN-1'),
    ]);
    const map = await buildCanonicalMap([x._id, y._id, z._id], accountStore);
    assert.strictEqual(map.get(x._id), z._id);
    assert.strictEqual(map.get(y._id), z._id);

    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 1, 'the chain folds to one canonical person');

    const unchanged = await taskModeStore.countByEntryRung();
    assert.strictEqual(unchanged.total, 2, 'without the map, grouping is by the account as recorded');
  });

  test('a corrupt chain under the map degrades to the recorded id rather than dropping events', async () => {
    const { accountStore, taskModeStore } = freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    await recordInOrder(taskModeStore, [
      entry(a._id, 'LIN-1'),
      entry(b._id, 'LIN-2'),
    ]);

    const map = await buildCanonicalMap([a._id, b._id], accountStore);
    const counted = await taskModeStore.countByEntryRung({ canonicalByAccountId: map });
    assert.strictEqual(counted.total, 2, 'each corrupt id falls back to itself — under-count, never drop');
  });
});
